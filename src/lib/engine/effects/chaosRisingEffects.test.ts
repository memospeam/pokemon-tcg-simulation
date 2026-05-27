import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { getExecutableAbilityEffects, parseAbilityText, parseAttackText, startAttackIfDiscardPending } from "./index";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";
import { countPrizeCards } from "../rules";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  abilities: CardDefinition["abilities"] = [],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    abilities,
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Water"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    types,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function battleState(overrides: Partial<EngineState> = {}): EngineState {
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [],
        hand: [],
        active: null,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [],
        hand: [],
        active: p2Active,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      "p2-active": mockBasic("Defender", "200", ["Water"]),
    },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ...overrides,
  };
}

describe("Chaos Rising — Mega Greninja ex", () => {
  const abilityText =
    "Once during your turn, if this Pokémon is in the Active Spot, you may discard a Basic Water Energy card from your hand in order to use this Ability. Place 6 damage counters on 1 of your opponent's Pokémon.";

  it("parses Mortal Shuriken with active-only cost and opponent target damage", () => {
    const parsed = parseAbilityText({ name: "Mortal Shuriken", type: "Ability", text: abilityText });
    expect(parsed.effects).toEqual(
      expect.arrayContaining([
        { kind: "ability_only_while_active" },
        { kind: "require_hand_energy_in_active", energyType: "Water" },
      ]),
    );
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      {
        kind: "damage",
        amount: 60,
        target: "opponent_pokemon_choose",
        applyWeaknessRes: false,
      },
    ]);
  });

  it("Mortal Shuriken discards Water Energy then damages chosen opponent Pokémon", () => {
    const greninjaDef = mockBasic("Mega Greninja ex", "330", ["Water"], [
      { name: "Mortal Shuriken", type: "Ability", text: abilityText },
    ]);
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const water = createCardInstance("water", PlayerId.P1, Zone.Hand);
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        "p2-bench": mockBasic("Opponent Bench", "90", ["Colorless"]),
        water: mockEnergy("Basic Water Energy", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
          hand: [water],
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
          bench: [p2Bench],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: greninja.instanceId,
      abilityName: "Mortal Shuriken",
    });
    expect(state.pendingAction?.type).toBe("ABILITY_DISCARD_HAND_ENERGY");

    state = gameReducer(state, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: water.instanceId,
    });
    expect(state.pendingAction?.type).toBe("CHOOSE_OPPONENT_POKEMON_DAMAGE");
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(0);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(1);

    state = gameReducer(state, {
      type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
      playerId: PlayerId.P1,
      targetId: p2Bench.instanceId,
    });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P2).bench[0]!.damageCounters).toBe(60);
  });

  it("blocks Mortal Shuriken from the bench", () => {
    const greninjaDef = mockBasic("Mega Greninja ex", "330", ["Water"], [
      { name: "Mortal Shuriken", type: "Ability", text: abilityText },
    ]);
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Bench);
    const water = createCardInstance("water", PlayerId.P1, Zone.Hand);
    const p1Active = createCardInstance("p1-active", PlayerId.P1, Zone.Active);
    const base = battleState();

    const state = battleState({
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        "p1-active": mockBasic("Other Active", "70", ["Colorless"]),
        water: mockEnergy("Basic Water Energy", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: p1Active,
          bench: [greninja],
          hand: [water],
        },
      },
    });

    const next = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: greninja.instanceId,
      abilityName: "Mortal Shuriken",
    });
    expect(next.pendingAction).toBeNull();
    expect(getPlayer(next, PlayerId.P1).hand).toHaveLength(1);
  });
});

describe("Chaos Rising — Ninja Spinner", () => {
  const attackText =
    "You may put a Water Energy attached to this Pokémon into your hand and have this attack do 80 more damage.";

  it("parses Ninja Spinner optional return-to-hand bonus damage", () => {
    expect(parseAttackText(attackText)).toEqual([
      { kind: "return_typed_energy_to_hand", energyType: "Water" },
      { kind: "damage_per_discarded_basic_energy", perCard: 80 },
    ]);
  });

  it("returns Water Energy to hand for +80 damage on Ninja Spinner", () => {
    const greninjaDef = mockBasic(
      "Mega Greninja ex",
      "330",
      ["Water"],
      [],
      [
        {
          name: "Ninja Spinner",
          cost: ["Colorless"],
          convertedEnergyCost: 1,
          damage: "120+",
          text: attackText,
        },
      ],
    );
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const water1 = createCardInstance("water-1", PlayerId.P1, Zone.Active);
    const water2 = createCardInstance("water-2", PlayerId.P1, Zone.Active);
    greninja.attachedEnergy = [water1, water2];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        active: greninjaDef,
        "p2-active": mockBasic("Defender", "330", ["Water"]),
        "water-1": mockEnergy("Basic Water Energy", ["Water"]),
        "water-2": mockEnergy("Basic Water Energy", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Ninja Spinner" });
    expect(state.pendingAction?.type).toBe("DISCARD_BASIC_ENERGY_FOR_DAMAGE");
    expect(state.pendingAction).toMatchObject({ returnToHand: true, energyType: "Water" });

    state = gameReducer(state, {
      type: "DISCARD_OWN_ENERGY_FOR_ATTACK",
      playerId: PlayerId.P1,
      pokemonId: greninja.instanceId,
      energyId: water1.instanceId,
    });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).active!.attachedEnergy).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(200);
  });

  it("Ninja Spinner deals base damage when optional return is skipped", () => {
    const greninjaDef = mockBasic(
      "Mega Greninja ex",
      "330",
      ["Water"],
      [],
      [
        {
          name: "Ninja Spinner",
          cost: ["Colorless"],
          convertedEnergyCost: 1,
          damage: "120+",
          text: attackText,
        },
      ],
    );
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const water = createCardInstance("water", PlayerId.P1, Zone.Active);
    greninja.attachedEnergy = [water];
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        active: greninjaDef,
        water: mockEnergy("Basic Water Energy", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
        },
      },
    });

    expect(startAttackIfDiscardPending(state, PlayerId.P1, "Ninja Spinner")).toBe(true);
    state = gameReducer(state, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(120);
    expect(getPlayer(state, PlayerId.P1).active!.attachedEnergy).toHaveLength(1);
  });
});

describe("countPrizeCards — Mega Evolution ex", () => {
  function makeDef(subtypes: string[]): CardDefinition {
    return {
      apiId: "test",
      name: "Test Pokémon",
      supertype: "Pokémon",
      subtypes,
      set: { id: "test", name: "Test" },
      number: "1",
      images: { small: "", large: "" },
    };
  }

  it("regular Pokémon gives 1 prize", () => {
    expect(countPrizeCards(makeDef(["Basic"]))).toBe(1);
  });

  it("Pokémon ex gives 2 prizes", () => {
    expect(countPrizeCards(makeDef(["Basic", "ex"]))).toBe(2);
  });

  it("Mega Evolution Pokémon ex (MEGA + ex) gives 3 prizes", () => {
    expect(countPrizeCards(makeDef(["Stage 2", "MEGA", "ex"]))).toBe(3);
    expect(countPrizeCards(makeDef(["Basic", "MEGA", "ex"]))).toBe(3);
  });

  it("VMAX gives 2 prizes", () => {
    expect(countPrizeCards(makeDef(["VMAX"]))).toBe(2);
  });
});
