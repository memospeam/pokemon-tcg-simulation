import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { parseAbilityText, parseAttackText } from "./parseText";
import {
  canUseAbilityNow,
  getExecutableAbilityEffects,
  markAbilityUsed,
} from "./abilities";
import { computePreDamageBonus } from "./damageBonus";
import { applyAttackDamagePhase } from "./attackFlow";
import { executeEffects } from "./execute";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Grass"]): CardDefinition {
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
  const active = createCardInstance("active", PlayerId.P1, Zone.Active);
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
        active,
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
        active: createCardInstance("p2-active", PlayerId.P2, Zone.Active),
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      active: mockBasic("Active"),
      "p2-active": mockBasic("Target", "100", ["Fire"]),
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

describe("batch 13 effects", () => {
  it("Strange Hacking parses Confused status and optional counter redistribution", () => {
    const parsed = parseAttackText(
      "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
    );
    expect(parsed).toEqual([
      { kind: "status", status: "Confused", target: "opponent_active" },
      { kind: "redistribute_opponent_counters", optional: true },
    ]);
  });

  it("Strange Hacking redistributes damage counters between opponent Pokémon", () => {
    const alakazam = mockBasic("Alakazam", "140", ["Psychic"], [
      {
        name: "Strange Hacking",
        cost: ["Psychic", "Psychic"],
        convertedEnergyCost: 2,
        damage: "",
        text: "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
      },
    ]);
    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: alakazam,
        "p2-active": mockBasic("Opponent Active", "120", ["Fire"]),
        "p2-bench": mockBasic("Opponent Bench", "70", ["Water"]),
      },
      players: {
        ...base.players,
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          active: p2Active,
          bench: [p2Bench],
        },
      },
    });
    p2Active.damageCounters = 30;
    getPlayer(state, PlayerId.P2).active!.statusConditions = [];

    const result = applyAttackDamagePhase(state, PlayerId.P1, "Strange Hacking");
    expect(result).toBe("pending");
    expect(state.pendingAction?.type).toBe("REDISTRIBUTE_OPPONENT_COUNTERS");
    expect(getPlayer(state, PlayerId.P2).active?.statusConditions).toContain("Confused");

    let next = gameReducer(state, {
      type: "SELECT_REDISTRIBUTE_SOURCE",
      playerId: PlayerId.P1,
      sourceId: p2Active.instanceId,
    });
    expect(next.pendingAction?.type).toBe("REDISTRIBUTE_OPPONENT_COUNTERS");
    if (next.pendingAction?.type === "REDISTRIBUTE_OPPONENT_COUNTERS") {
      expect(next.pendingAction.step).toBe("TARGET");
    }

    next = gameReducer(next, {
      type: "SELECT_REDISTRIBUTE_TARGET",
      playerId: PlayerId.P1,
      targetId: p2Bench.instanceId,
    });
    if (next.pendingAction?.type === "REDISTRIBUTE_OPPONENT_COUNTERS") {
      next = gameReducer(next, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    }
    expect(next.pendingAction).toBeNull();
    expect(next.turnFlags.attacked).toBe(true);
    expect(getPlayer(next, PlayerId.P2).active?.damageCounters).toBe(0);
    expect(getPlayer(next, PlayerId.P2).bench[0]?.damageCounters).toBe(30);
  });

  it("Kadabra Psychic parses bonus damage per Energy on opponent Active", () => {
    const parsed = parseAttackText(
      "This attack does 50 more damage for each Energy attached to your opponent's Active Pokémon.",
    );
    expect(parsed).toEqual([
      { kind: "damage_per_energy_opponent_active", perEnergy: 50 },
    ]);
  });

  it("Hydra Breath KOs opponent Active when 6 Basic Grass Energy are discarded", () => {
    const hydrapple = mockBasic("Hydrapple ex", "330", ["Grass"], [
      {
        name: "Hydra Breath",
        cost: ["Grass", "Grass", "Grass"],
        convertedEnergyCost: 3,
        damage: "",
        text: "Discard 6 Basic Grass Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.",
      },
    ]);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const handCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(`grass-${index}`, PlayerId.P1, Zone.Hand),
    );
    const grassDefs = Object.fromEntries(handCards.map((card) => [card.definitionId, grassEnergy]));
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: hydrapple,
        "p2-active": mockBasic("Defender", "330", ["Fire"]),
        ...grassDefs,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          hand: handCards,
        },
      },
    });

    const result = applyAttackDamagePhase(state, PlayerId.P1, "Hydra Breath");
    expect(result).toBe("knockout");
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(0);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(6);
    expect(getPlayer(state, PlayerId.P2).active?.damageCounters).toBeGreaterThan(0);
  });

  it("Hydra Breath does nothing without 6 Basic Grass Energy in hand", () => {
    const hydrapple = mockBasic("Hydrapple ex", "330", ["Grass"], [
      {
        name: "Hydra Breath",
        cost: ["Grass", "Grass", "Grass"],
        convertedEnergyCost: 3,
        damage: "",
        text: "Discard 6 Basic Grass Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.",
      },
    ]);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const handCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(`grass-${index}`, PlayerId.P1, Zone.Hand),
    );
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: hydrapple,
        ...Object.fromEntries(handCards.map((card) => [card.definitionId, grassEnergy])),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          hand: handCards,
        },
      },
    });

    const hpBefore = getPlayer(state, PlayerId.P2).active!.damageCounters;
    const result = applyAttackDamagePhase(state, PlayerId.P1, "Hydra Breath");
    expect(result).toBe("complete");
    expect(getPlayer(state, PlayerId.P2).active?.damageCounters).toBe(hpBefore);
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(5);
  });

  it("Champion's Call searches Cynthia's Pokémon from deck", () => {
    const abilityText =
      "Once during your turn, you may search your deck for a Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
    const parsed = parseAbilityText({
      name: "Champion's Call",
      type: "Ability",
      text: abilityText,
    });
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      { kind: "search_named_pokemon_to_hand", nameFilter: "Cynthia's" },
    ]);

    const gabite = mockBasic("Cynthia's Gabite", "110", ["Fighting"]);
    gabite.abilities = [{ name: "Champion's Call", type: "Ability", text: abilityText }];
    const gibleCard = createCardInstance("deck-gible", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("deck-filler", PlayerId.P1, Zone.Deck);
    const gabiteMon = createCardInstance("gabite", PlayerId.P1, Zone.Active);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: gabite,
        gabite,
        "deck-gible": mockBasic("Cynthia's Gible", "70", ["Fighting"]),
        "deck-filler": mockBasic("Filler", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: gabiteMon,
          deck: [filler, gibleCard],
        },
      },
    });

    expect(canUseAbilityNow(state, gabiteMon, parsed)).toBe(true);
    markAbilityUsed(state, gabiteMon, "Champion's Call", parsed);

    const ctx = {
      playerId: PlayerId.P1,
      sourcePokemon: gabiteMon,
      opponentId: PlayerId.P2,
    };
    const result = executeEffects(state, ctx, getExecutableAbilityEffects(parsed.effects));
    expect(result).toBe("complete");
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === gibleCard.instanceId)).toBe(
      true,
    );
  });

  it("Syrup Storm parses Grass Energy bonus across all your Pokémon", () => {
    const parsed = parseAttackText(
      "This attack does 30 more damage for each Grass Energy attached to all of your Pokémon.",
    );
    expect(parsed).toEqual([
      {
        kind: "damage_per_typed_energy",
        energyType: "Grass",
        perEnergy: 30,
        scope: "all_yours",
        bonusOnly: true,
      },
    ]);
  });

  it("Syrup Storm adds bonus damage for attached Energy", () => {
    const parsed = parseAttackText(
      "This attack does 30 more damage for each Grass Energy attached to all of your Pokémon.",
    );
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: mockBasic("Hydrapple ex", "330", ["Grass"]),
        "energy-1": grassEnergy,
        "energy-2": grassEnergy,
      },
    });
    const active = getPlayer(state, PlayerId.P1).active!;
    active.attachedEnergy = [energy1, energy2];

    const bonus = computePreDamageBonus(
      state,
      parsed[0]!,
      PlayerId.P1,
      active,
      PlayerId.P2,
    );
    expect(bonus).toBe(60);
  });

  it("Ripening Charge attaches Grass Energy and heals 30 damage", () => {
    const abilityText =
      "Once during your turn, you may attach a Basic Grass Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30 damage from that Pokémon.";
    const parsed = parseAbilityText({
      name: "Ripening Charge",
      type: "Ability",
      text: abilityText,
    });
    expect(getExecutableAbilityEffects(parsed.effects)).toEqual([
      {
        kind: "attach_basic_energy_from_hand",
        energyType: "Grass",
        target: "your_pokemon",
        healOnAttach: 30,
      },
    ]);

    const hydrappleDef = mockBasic("Hydrapple ex", "330", ["Grass"]);
    hydrappleDef.abilities = [{ name: "Ripening Charge", type: "Ability", text: abilityText }];
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const energyCard = createCardInstance("grass-hand", PlayerId.P1, Zone.Hand);
    const hydrapple = createCardInstance("hydrapple", PlayerId.P1, Zone.Active);
    hydrapple.damageCounters = 40;
    const base = battleState();
    const state = battleState({
      definitions: {
        ...base.definitions,
        active: hydrappleDef,
        hydrapple: hydrappleDef,
        "grass-hand": grassEnergy,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: hydrapple,
          hand: [energyCard],
        },
      },
    });

    const ctx = {
      playerId: PlayerId.P1,
      sourcePokemon: hydrapple,
      opponentId: PlayerId.P2,
    };
    const result = executeEffects(state, ctx, getExecutableAbilityEffects(parsed.effects));
    expect(result).toBe("complete");
    expect(hydrapple.attachedEnergy).toHaveLength(1);
    expect(hydrapple.damageCounters).toBe(10);
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(0);
  });
});
