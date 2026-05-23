import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import type { CardInstance } from "../models/instance";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "../engine/reducer";
import { applyWeaknessAndResistanceForPokemon } from "../engine/effects/passiveRules";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { UTRECHT_535_TOP16 } from "./tournamentPresets";
import {
  analyzeAllUtrechtTop16,
  analyzeTournamentDeck,
  ARCHETYPE_SIGNATURES,
  ENGINE_READY_SIGNATURES,
  formatTop16AnalysisReport,
  summarizeTop16Analysis,
} from "./utrechtTop16Analyzer";

function mockBasic(
  name: string,
  hp = "70",
  types: string[] = ["Colorless"],
  attacks: CardDefinition["attacks"] = [],
  weaknesses?: CardDefinition["weaknesses"],
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks,
    weaknesses,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name: string, types: string[] = ["Psychic"]): CardDefinition {
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

function deckCard(playerId: PlayerId, id: string): CardInstance {
  return createCardInstance(id, playerId, Zone.Deck);
}

const deckFillerDef = mockEnergy("Deck Filler", ["Colorless"]);

function buildDeck(playerId: PlayerId, count: number, prefix: string) {
  const cards = Array.from({ length: count }, (_, index) =>
    deckCard(playerId, `${prefix}-deck-${index}`),
  );
  const definitions = Object.fromEntries(
    cards.map((card) => [card.definitionId, deckFillerDef]),
  );
  return { cards, definitions };
}

function activeBattleState(overrides: Partial<EngineState> = {}): EngineState {
  const active = createCardInstance("active", PlayerId.P1, Zone.Active);
  const p1Deck = buildDeck(PlayerId.P1, 10, "p1");
  const p2Deck = buildDeck(PlayerId.P2, 10, "p2");
  const baseDefinitions = {
    active: mockBasic("Active"),
    "p2-active": mockBasic("Target", "200", ["Water"], [], [{ type: "Psychic", value: "×2" }]),
    ...p1Deck.definitions,
    ...p2Deck.definitions,
  };

  const base: EngineState = {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: p1Deck.cards,
        hand: [],
        active,
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: p2Deck.cards,
        hand: [],
        active: createCardInstance("p2-active", PlayerId.P2, Zone.Active),
        bench: [],
        prizes: Array.from({ length: 6 }, (_, i) => createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes)),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: baseDefinitions,
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
  };

  return {
    ...base,
    ...overrides,
    definitions: {
      ...base.definitions,
      ...overrides.definitions,
    },
    players: overrides.players ?? base.players,
  };
}

describe("Utrecht Top 16 deck analysis", () => {
  const analyses = analyzeAllUtrechtTop16();
  const summary = summarizeTop16Analysis(analyses);

  it("covers all 16 tournament decks", () => {
    expect(analyses).toHaveLength(16);
    expect(summary.deckCount).toBe(16);
  });

  it("maps every unique archetype to signature effects", () => {
    for (const archetype of summary.uniqueArchetypes) {
      expect(ARCHETYPE_SIGNATURES[archetype], archetype).toBeDefined();
    }
  });

  it("parses every deck list without format errors", () => {
    for (const analysis of analyses) {
      expect(analysis.parseErrors, analysis.label).toEqual([]);
    }
  });

  it("resolves every Pokémon line in corpus", () => {
    for (const analysis of analyses) {
      expect(
        analysis.corpus.pokemonMissing,
        `${analysis.label}: ${analysis.corpus.pokemonMissing.join("; ")}`,
      ).toEqual([]);
      expect(analysis.corpus.pokemonResolved).toBe(analysis.sections.Pokémon);
    }
    expect(summary.pokemonCardsMissing).toBe(0);
  });

  it("collects signature effect coverage per deck", () => {
    for (const analysis of analyses) {
      expect(analysis.signatureEffects.length, analysis.deckName).toBeGreaterThan(0);
    }
  });

  it("prints analysis report for manual review", () => {
    const report = formatTop16AnalysisReport(summary, analyses);
    expect(report).toContain("Utrecht Top 16 Playtest Analysis");
    expect(report).toContain("Signature effects:");
    // eslint-disable-next-line no-console
    console.log("\n" + report);
  });
});

describe("Utrecht Top 16 engine smoke playtests", () => {
  it("Lopunny Gale Thrust finishes the turn after retreating into Active", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.placement === 1)!;
    expect(analyzeTournamentDeck(deck).signatureEffects.some((e) => e.effectName === "Gale Thrust")).toBe(true);

    const lopunnyDef = mockBasic("Mega Lopunny ex", "260", ["Colorless"], [
      {
        name: "Gale Thrust",
        cost: ["Colorless", "Colorless"],
        convertedEnergyCost: 2,
        damage: "60+",
        text: "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 170 more damage.",
      },
    ]);
    const benchMon = createCardInstance("bench-lopunny", PlayerId.P1, Zone.Bench);
    const activeMon = createCardInstance("active-lopunny", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    const mistEnergy = mockEnergy("Mist Energy", ["Colorless"]);
    const base = activeBattleState();

    const state = activeBattleState({
      definitions: {
        ...base.definitions,
        "active-lopunny": lopunnyDef,
        "bench-lopunny": lopunnyDef,
        "p2-active": mockBasic("Defender", "300", ["Water"]),
        "energy-1": mistEnergy,
        "energy-2": mistEnergy,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: activeMon,
          bench: [benchMon],
        },
      },
    });
    benchMon.attachedEnergy = [energy1, energy2];

    let next = gameReducer(state, {
      type: "RETREAT",
      playerId: PlayerId.P1,
      benchInstanceId: benchMon.instanceId,
    });
    next = gameReducer(next, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Gale Thrust" });

    expect(next.turnFlags.attacked).toBe(false);
    expect(next.currentPlayerId).toBe(PlayerId.P2);
    expect(getPlayer(next, PlayerId.P2).active!.damageCounters).toBeGreaterThanOrEqual(230);
  });

  it("Dragapult Phantom Dive distributes bench damage and completes the attack", () => {
    const dragapultDecks = UTRECHT_535_TOP16.decks.filter((entry) => entry.deckName.startsWith("Dragapult"));
    expect(dragapultDecks.length).toBeGreaterThanOrEqual(8);

    const dragapultDef = mockBasic("Dragapult ex", "330", ["Psychic"], [
      {
        name: "Phantom Dive",
        cost: ["Psychic", "Psychic"],
        convertedEnergyCost: 2,
        damage: "200",
        text: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.",
      },
    ]);
    const psychic = mockEnergy("Psychic Energy", ["Psychic"]);
    const dragapult = createCardInstance("dragapult", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    const bench1 = createCardInstance("p2-bench-1", PlayerId.P2, Zone.Bench);
    const bench2 = createCardInstance("p2-bench-2", PlayerId.P2, Zone.Bench);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        dragapult: dragapultDef,
        "p2-active": mockBasic("Defender", "330", ["Colorless"]),
        "p2-bench-1": mockBasic("Bench One", "70", ["Colorless"]),
        "p2-bench-2": mockBasic("Bench Two", "70", ["Colorless"]),
        "energy-1": psychic,
        "energy-2": psychic,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: dragapult,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          bench: [bench1, bench2],
        },
      },
    });
    dragapult.attachedEnergy = [energy1, energy2];

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Phantom Dive" });
    expect(state.pendingAction?.type).toBe("DISTRIBUTE_BENCH_DAMAGE");

    for (let i = 0; i < 6; i += 1) {
      state = gameReducer(state, {
        type: "ASSIGN_BENCH_DAMAGE",
        playerId: PlayerId.P1,
        targetId: bench1.instanceId,
      });
    }

    expect(state.pendingAction).toBeNull();
    expect(state.currentPlayerId).toBe(PlayerId.P2);
    expect(getPlayer(state, PlayerId.P2).bench[0]?.damageCounters).toBe(60);
  });

  it("Hydrapple Ripening Charge heals after attaching Grass Energy", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.placement === 16)!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Ripening Charge", "Syrup Storm"]),
    );

    const hydrappleDef = mockBasic("Hydrapple ex", "330", ["Grass"]);
    hydrappleDef.abilities = [
      {
        name: "Ripening Charge",
        type: "Ability",
        text: "Once during your turn, you may attach a Basic Grass Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30 damage from that Pokémon.",
      },
    ];
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const hydrapple = createCardInstance("hydrapple", PlayerId.P1, Zone.Active);
    const energyCard = createCardInstance("grass-hand", PlayerId.P1, Zone.Hand);
    const attached1 = createCardInstance("grass-attached-1", PlayerId.P1, Zone.Active);
    const attached2 = createCardInstance("grass-attached-2", PlayerId.P1, Zone.Active);
    const attached3 = createCardInstance("grass-attached-3", PlayerId.P1, Zone.Active);
    hydrapple.damageCounters = 40;
    hydrapple.attachedEnergy = [attached1, attached2, attached3];
    const base = activeBattleState();

    const state = activeBattleState({
      definitions: {
        ...base.definitions,
        hydrapple: hydrappleDef,
        "grass-hand": grassEnergy,
        "grass-attached-1": grassEnergy,
        "grass-attached-2": grassEnergy,
        "grass-attached-3": grassEnergy,
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

    const next = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: hydrapple.instanceId,
      abilityName: "Ripening Charge",
    });

    expect(getPlayer(next, PlayerId.P1).active?.attachedEnergy).toHaveLength(4);
    expect(getPlayer(next, PlayerId.P1).active?.damageCounters).toBe(10);
  });

  it("tracks engine-ready signature count across meta archetypes", () => {
    const analyses = analyzeAllUtrechtTop16();
    const summary = summarizeTop16Analysis(analyses);
    const readyNames = [...ENGINE_READY_SIGNATURES];
    expect(summary.signatureEffects.engineReady).toBeGreaterThanOrEqual(readyNames.length);
    expect(summary.signatureEffects.engineReady).toBeLessThanOrEqual(summary.signatureEffects.total);
  });

  it("no Weakness modifier suppresses weakness during the opponent's next turn (Dragapult support)", () => {
    const attacker = createCardInstance("attacker", PlayerId.P1, Zone.Active);
    attacker.noWeaknessNextOpponentTurn = "pending";
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        attacker: mockBasic("Attacker", "200", ["Water"], [], [{ type: "Psychic", value: "×2" }]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: attacker,
        },
      },
    });

    state = gameReducer(state, { type: "END_TURN" });
    const activeAfterTurn = getPlayer(state, PlayerId.P1).active!;
    expect(activeAfterTurn.noWeaknessNextOpponentTurn).toBe("active");

    const withWeakness = applyWeaknessAndResistanceForPokemon(state, 100, ["Psychic"], activeAfterTurn);
    expect(withWeakness).toBe(100);
  });

  it("Hydra Breath KOs the opponent Active and advances the turn", () => {
    const hydrappleDef = mockBasic("Hydrapple ex", "330", ["Grass"], [
      {
        name: "Hydra Breath",
        cost: ["Grass", "Grass", "Grass"],
        convertedEnergyCost: 3,
        damage: "",
        text: "Discard 6 Basic Grass Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.",
      },
    ]);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const hydrapple = createCardInstance("hydrapple", PlayerId.P1, Zone.Active);
    const attackEnergy = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(`attack-energy-${index}`, PlayerId.P1, Zone.Active),
    );
    hydrapple.attachedEnergy = attackEnergy;
    const handCards = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(`grass-${index}`, PlayerId.P1, Zone.Hand),
    );
    const grassDefs = Object.fromEntries(handCards.map((card) => [card.definitionId, grassEnergy]));
    const attackEnergyDefs = Object.fromEntries(attackEnergy.map((card) => [card.definitionId, grassEnergy]));
    const benchDefender = createCardInstance("p2-bench-backup", PlayerId.P2, Zone.Bench);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        hydrapple: hydrappleDef,
        "p2-active": mockBasic("Defender", "330", ["Fire"]),
        "p2-bench-backup": mockBasic("Backup", "70", ["Colorless"]),
        ...grassDefs,
        ...attackEnergyDefs,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: hydrapple,
          hand: handCards,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          bench: [benchDefender],
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Hydra Breath" });
    expect(state.pendingAction?.type).toBe("PROMOTE");
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(6);
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
  });
});
