import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { onKnockOut } from "./abilityHooks";
import { executeEffects } from "./execute";
import { parseAbilityText, parseAttackText } from "./parseText";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

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

describe("CRI Phase 3 — Flygon Sandy Flapping", () => {
  const sandyText =
    "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck.";

  it("parses Sandy Flapping KO trigger and mill effect", () => {
    const parsed = parseAbilityText({ name: "Sandy Flapping", type: "Ability", text: sandyText });
    expect(parsed.effects).toEqual(
      expect.arrayContaining([
        { kind: "evolve_trigger_ability" },
        { kind: "active_ko_by_attack_trigger" },
        { kind: "mill_opponent_deck", count: 2 },
      ]),
    );
    expect(parsed.effects.some((effect) => effect.kind === "generic_effect_stub")).toBe(false);
  });

  it("mills 2 cards from the attacker's deck when Flygon Active is KO'd by attack", () => {
    const flygonDef = mockBasic("Flygon", "150", ["Fighting"], [
      { name: "Sandy Flapping", type: "Ability", text: sandyText },
    ]);
    const flygon = createCardInstance("flygon", PlayerId.P2, Zone.Active);
    const deckCards = ["deck-1", "deck-2", "deck-3"].map((id) =>
      createCardInstance(id, PlayerId.P1, Zone.Deck),
    );
    const base = battleState();

    const state = battleState({
      currentPlayerId: PlayerId.P1,
      turnFlags: { ...emptyTurnFlags(), attacked: true },
      definitions: {
        ...base.definitions,
        flygon: flygonDef,
        "deck-1": mockBasic("Deck Card 1"),
        "deck-2": mockBasic("Deck Card 2"),
        "deck-3": mockBasic("Deck Card 3"),
      },
      players: {
        ...base.players,
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: flygon,
        },
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          deck: deckCards,
        },
      },
    });

    onKnockOut(state, flygon, PlayerId.P1);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(2);
  });

  it("does not mill when Flygon is KO'd outside of an attack", () => {
    const flygonDef = mockBasic("Flygon", "150", ["Fighting"], [
      { name: "Sandy Flapping", type: "Ability", text: sandyText },
    ]);
    const flygon = createCardInstance("flygon", PlayerId.P2, Zone.Active);
    const deckCards = ["deck-1", "deck-2"].map((id) =>
      createCardInstance(id, PlayerId.P1, Zone.Deck),
    );
    const base = battleState();

    const state = battleState({
      currentPlayerId: PlayerId.P1,
      turnFlags: { ...emptyTurnFlags(), attacked: false },
      definitions: {
        ...base.definitions,
        flygon: flygonDef,
        "deck-1": mockBasic("Deck Card 1"),
        "deck-2": mockBasic("Deck Card 2"),
      },
      players: {
        ...base.players,
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: flygon,
        },
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          deck: deckCards,
        },
      },
    });

    onKnockOut(state, flygon, PlayerId.P1);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(0);
  });
});

describe("CRI Phase 3 — Mega Floette ex Eternity Bloom", () => {
  const attackText =
    "Search your deck for up to 4 Basic Psychic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.";

  it("parses Eternity Bloom search-and-attach Psychic Energy", () => {
    expect(parseAttackText(attackText)).toEqual([
      {
        kind: "search_attach_energy_typed",
        count: 4,
        energyType: "Psychic",
        target: "benched",
      },
    ]);
  });

  it("attaches Psychic Energy from deck to benched Pokémon", () => {
    const floette = createCardInstance("floette", PlayerId.P1, Zone.Active);
    const benchMon = createCardInstance("bench", PlayerId.P1, Zone.Bench);
    const psychic1 = createCardInstance("psy1", PlayerId.P1, Zone.Deck);
    const psychic2 = createCardInstance("psy2", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("filler", PlayerId.P1, Zone.Deck);
    const base = battleState();

    const state = battleState({
      definitions: {
        ...base.definitions,
        floette: mockBasic("Mega Floette ex", "380", ["Psychic"]),
        bench: mockBasic("Bench Mon", "70", ["Psychic"]),
        psy1: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        psy2: mockEnergy("Basic Psychic Energy", ["Psychic"]),
        filler: mockBasic("Filler", "50"),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: floette,
          bench: [benchMon],
          deck: [psychic1, psychic2, filler],
        },
      },
    });

    executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: floette, opponentId: PlayerId.P2 },
      parseAttackText(attackText),
    );

    expect(getPlayer(state, PlayerId.P1).bench[0]!.attachedEnergy).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).deck).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).deck[0]!.definitionId).toBe("filler");
  });
});

describe("CRI Phase 3 — Sudowoodo Rock Hurl", () => {
  const attackText = "This attack's damage isn't affected by Resistance.";

  it("parses Rock Hurl ignore-resistance modifier", () => {
    expect(parseAttackText(attackText)).toEqual([{ kind: "ignore_resistance" }]);
  });

  it("Rock Hurl deals full damage through Fighting Resistance", () => {
    const sudowoodoDef = mockBasic("Sudowoodo", "110", ["Fighting"], [], [
      {
        name: "Rock Hurl",
        cost: ["Colorless"],
        convertedEnergyCost: 1,
        damage: "30",
        text: attackText,
      },
    ]);
    const defenderDef: CardDefinition = {
      ...mockBasic("Metal Defender", "200", ["Metal"]),
      resistances: [{ type: "Fighting", value: "-30" }],
    };
    const sudowoodo = createCardInstance("sudowoodo", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("energy", PlayerId.P1, Zone.Active);
    sudowoodo.attachedEnergy = [energy];
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const base = battleState();

    let state = battleState({
      definitions: {
        ...base.definitions,
        sudowoodo: sudowoodoDef,
        energy: mockEnergy("Basic Colorless Energy", ["Colorless"]),
        "p2-active": defenderDef,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: sudowoodo,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Rock Hurl" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(30);
  });
});
