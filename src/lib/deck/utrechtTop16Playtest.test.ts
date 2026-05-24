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

function mockSupporter(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes: ["Supporter"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockStage(
  name: string,
  evolvesFrom: string,
  hp = "80",
  types: string[] = ["Psychic"],
  subtypes: string[] = ["Stage 1"],
): CardDefinition {
  return {
    ...mockBasic(name, hp, types),
    subtypes,
    evolvesFrom,
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

  it("marks every signature effect as engine-ready with no gaps", () => {
    expect(summary.signatureEffects.engineReady).toBe(summary.signatureEffects.total);
    expect(summary.signatureEffects.gaps).toEqual([]);
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

  it("Munkidori Adrena-Brain moves damage through gameReducer", () => {
    const dragapultDeck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Dragapult")!;
    expect(analyzeTournamentDeck(dragapultDeck).signatureEffects.some((e) => e.effectName === "Adrena-Brain")).toBe(
      true,
    );

    const abilityText =
      "Once during your turn, if this Pokémon has any Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
    const munkidoriDef = mockBasic("Munkidori", "110", ["Psychic"]);
    munkidoriDef.abilities = [{ name: "Adrena-Brain", type: "Ability", text: abilityText }];
    const darkEnergy = mockEnergy("Darkness Energy", ["Darkness"]);
    const munkidori = createCardInstance("munkidori", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("dark-energy", PlayerId.P1, Zone.Bench);
    munkidori.attachedEnergy = [energy];
    munkidori.damageCounters = 30;
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        munkidori: munkidoriDef,
        "dark-energy": darkEnergy,
        "p2-active": mockBasic("Opponent Active", "120", ["Psychic"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          bench: [munkidori],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: munkidori.instanceId,
      abilityName: "Adrena-Brain",
    });
    expect(state.pendingAction?.type).toBe("MOVE_DAMAGE");

    state = gameReducer(state, {
      type: "MOVE_DAMAGE_SOURCE",
      playerId: PlayerId.P1,
      sourceId: munkidori.instanceId,
    });
    state = gameReducer(state, {
      type: "MOVE_DAMAGE_TARGET",
      playerId: PlayerId.P1,
      targetId: getPlayer(state, PlayerId.P2).active!.instanceId,
    });
    const movedMunkidori = getPlayer(state, PlayerId.P1).bench.find(
      (entry) => entry.instanceId === munkidori.instanceId,
    )!;
    expect(movedMunkidori.damageCounters).toBe(0);
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(30);
  });

  it("Dragapult Dusknoir Cursed Blast damages opponent then KOs self", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Dragapult Dusknoir")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.some((e) => e.effectName === "Cursed Blast")).toBe(true);

    const abilityText =
      "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.";
    const dusknoirDef = mockBasic("Dusknoir", "160", ["Psychic"]);
    dusknoirDef.abilities = [{ name: "Cursed Blast", type: "Ability", text: abilityText }];
    const dusknoir = createCardInstance("dusknoir", PlayerId.P1, Zone.Active);
    const p2Bench = createCardInstance("p2-bench", PlayerId.P2, Zone.Bench);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        dusknoir: dusknoirDef,
        "p2-bench": mockBasic("Bench Target", "90", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: dusknoir,
        },
        [PlayerId.P2]: {
          ...base.players[PlayerId.P2],
          bench: [p2Bench],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: dusknoir.instanceId,
      abilityName: "Cursed Blast",
    });
    expect(state.pendingAction?.type).toBe("CHOOSE_OPPONENT_POKEMON_DAMAGE");

    state = gameReducer(state, {
      type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
      playerId: PlayerId.P1,
      targetId: getPlayer(state, PlayerId.P2).active!.instanceId,
    });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(130);
    expect(getPlayer(state, PlayerId.P1).active).toBeNull();
  });

  it("Rocket Honchkrow Rocket Feathers discards Team Rocket Supporters for bonus damage", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Rocket's Honchkrow")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.some((e) => e.effectName === "Rocket Feathers")).toBe(true);

    const attackText =
      'You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.';
    const honchkrowDef = mockBasic("Team Rocket's Honchkrow", "140", ["Darkness"], [
      { name: "Rocket Feathers", cost: ["Darkness"], convertedEnergyCost: 1, damage: "60×", text: attackText },
    ]);
    const darkEnergy = mockEnergy("Darkness Energy", ["Darkness"]);
    const honchkrow = createCardInstance("honchkrow", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("dark-energy", PlayerId.P1, Zone.Active);
    honchkrow.attachedEnergy = [energy];
    const ariana = createCardInstance("ariana", PlayerId.P1, Zone.Hand);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        honchkrow: honchkrowDef,
        "dark-energy": darkEnergy,
        ariana: mockSupporter("Team Rocket's Ariana"),
        "p2-active": mockBasic("Defender", "200", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: honchkrow,
          hand: [ariana],
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Rocket Feathers" });
    expect(state.pendingAction?.type).toBe("DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE");

    state = gameReducer(state, {
      type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK",
      playerId: PlayerId.P1,
      instanceId: ariana.instanceId,
    });
    state = gameReducer(state, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBeGreaterThanOrEqual(120);
  });

  it("Ogerpon Teal Dance attaches Grass Energy and draws a card", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Ogerpon Box")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Teal Dance", "Myriad Leaf Shower"]),
    );

    const abilityText =
      "Once during your turn, you may attach a Basic Grass Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, draw a card.";
    const ogerponDef = mockBasic("Teal Mask Ogerpon ex", "210", ["Grass"]);
    ogerponDef.abilities = [{ name: "Teal Dance", type: "Ability", text: abilityText }];
    const ogerpon = createCardInstance("ogerpon", PlayerId.P1, Zone.Active);
    const benchMon = createCardInstance("bench-mon", PlayerId.P1, Zone.Bench);
    const grass = createCardInstance("grass", PlayerId.P1, Zone.Hand);
    const deckCard = createCardInstance("deck-draw", PlayerId.P1, Zone.Deck);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        ogerpon: ogerponDef,
        "bench-mon": mockBasic("Bench Mon", "70", ["Grass"]),
        grass: grassEnergy,
        "deck-draw": mockBasic("Drawn Card", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: ogerpon,
          bench: [benchMon],
          hand: [grass],
          deck: [deckCard],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: ogerpon.instanceId,
      abilityName: "Teal Dance",
    });
    expect(state.pendingAction?.type).toBe("ATTACH_HAND_ENERGY");

    state = gameReducer(state, {
      type: "ATTACH_HAND_ENERGY_TO_POKEMON",
      playerId: PlayerId.P1,
      pokemonId: benchMon.instanceId,
      energyId: grass.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).bench[0]?.attachedEnergy).toHaveLength(1);
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === deckCard.instanceId)).toBe(true);
  });

  it("Ogerpon Myriad Leaf Shower scales with Energy on both Actives", () => {
    const attackText = "This attack does 30 more damage for each Energy attached to both Active Pokémon.";
    const ogerponDef = mockBasic("Teal Mask Ogerpon ex", "210", ["Grass"], [
      { name: "Myriad Leaf Shower", cost: ["Grass"], convertedEnergyCost: 1, damage: "30+", text: attackText },
    ]);
    const grassEnergy = mockEnergy("Basic Grass Energy", ["Grass"]);
    const ogerpon = createCardInstance("ogerpon", PlayerId.P1, Zone.Active);
    const e1 = createCardInstance("e1", PlayerId.P1, Zone.Active);
    const e2 = createCardInstance("e2", PlayerId.P1, Zone.Active);
    ogerpon.attachedEnergy = [e1, e2];
    const p2Energy = createCardInstance("p2-e", PlayerId.P2, Zone.Active);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        ogerpon: ogerponDef,
        "p2-active": mockBasic("Defender", "300", ["Water"]),
        e1: grassEnergy,
        e2: grassEnergy,
        "p2-e": grassEnergy,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: ogerpon,
        },
      },
    });
    getPlayer(state, PlayerId.P2).active!.attachedEnergy = [p2Energy];

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Myriad Leaf Shower" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBeGreaterThanOrEqual(120);
  });

  it("N's Zoroark Trade draws after discarding from hand", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "N's Zoroark")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Trade", "Night Joker"]),
    );

    const abilityText =
      "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.";
    const zoroarkDef = mockBasic("N's Zoroark ex", "280", ["Darkness"]);
    zoroarkDef.abilities = [{ name: "Trade", type: "Ability", text: abilityText }];
    const zoroark = createCardInstance("zoroark", PlayerId.P1, Zone.Active);
    const discardCard = createCardInstance("discard-me", PlayerId.P1, Zone.Hand);
    const draw1 = createCardInstance("draw-1", PlayerId.P1, Zone.Deck);
    const draw2 = createCardInstance("draw-2", PlayerId.P1, Zone.Deck);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        zoroark: zoroarkDef,
        "discard-me": mockBasic("Discard Me", "60", ["Colorless"]),
        "draw-1": mockBasic("Draw One", "60", ["Colorless"]),
        "draw-2": mockBasic("Draw Two", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: zoroark,
          hand: [discardCard],
          deck: [draw1, draw2],
        },
      },
    });

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: zoroark.instanceId,
      abilityName: "Trade",
    });
    expect(state.pendingAction?.type).toBe("ABILITY_DISCARD_HAND");

    state = gameReducer(state, {
      type: "SELECT_HAND_DISCARD",
      playerId: PlayerId.P1,
      instanceId: discardCard.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(2);
  });

  it("N's Zoroark Night Joker copies a benched N's Pokémon attack", () => {
    const attackText = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
    const zoroarkDef = mockBasic("N's Zoroark ex", "280", ["Darkness"], [
      { name: "Night Joker", cost: ["Darkness"], convertedEnergyCost: 1, damage: "", text: attackText },
    ]);
    const zoruaDef = mockBasic("N's Zorua", "70", ["Darkness"], [
      { name: "Scratch", cost: ["Darkness"], convertedEnergyCost: 1, damage: "30", text: "" },
    ]);
    const darkEnergy = mockEnergy("Darkness Energy", ["Darkness"]);
    const zoroark = createCardInstance("zoroark", PlayerId.P1, Zone.Active);
    const zorua = createCardInstance("zorua", PlayerId.P1, Zone.Bench);
    const energy = createCardInstance("dark-energy", PlayerId.P1, Zone.Active);
    zoroark.attachedEnergy = [energy];
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        zoroark: zoroarkDef,
        zorua: zoruaDef,
        "dark-energy": darkEnergy,
        "p2-active": mockBasic("Defender", "200", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: zoroark,
          bench: [zorua],
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Night Joker" });
    expect(state.pendingAction?.type).toBe("COPY_BENCH_ATTACK");

    state = gameReducer(state, {
      type: "CHOOSE_BENCH_ATTACK",
      playerId: PlayerId.P1,
      benchPokemonId: zorua.instanceId,
      attackName: "Scratch",
    });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBeGreaterThan(0);
  });

  it("Alakazam Powerful Hand scales damage with hand size", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Alakazam Dudunsparce")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Powerful Hand", "Psychic Draw"]),
    );

    const attackText =
      "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.";
    const alakazamDef = mockBasic("Alakazam", "120", ["Psychic"], [
      { name: "Powerful Hand", cost: ["Psychic"], convertedEnergyCost: 1, damage: "", text: attackText },
    ]);
    const psychic = mockEnergy("Psychic Energy", ["Psychic"]);
    const alakazam = createCardInstance("alakazam", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("psychic-energy", PlayerId.P1, Zone.Active);
    alakazam.attachedEnergy = [energy];
    const handCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(`hand-${index}`, PlayerId.P1, Zone.Hand),
    );
    const handDefs = Object.fromEntries(handCards.map((card) => [card.definitionId, mockBasic("Hand Card")]));
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        alakazam: alakazamDef,
        "psychic-energy": psychic,
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
        ...handDefs,
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: alakazam,
          hand: handCards,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Powerful Hand" });
    expect(getPlayer(state, PlayerId.P2).active!.damageCounters).toBe(80);
  });

  it("Alakazam Psychic Draw triggers on evolution from hand", () => {
    const abilityText =
      "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 2 cards.";
    const kadabraDef = mockStage("Kadabra", "Abra", "80", ["Psychic"]);
    const alakazamDef = mockStage("Alakazam", "Kadabra", "120", ["Psychic"], ["Stage 2"]);
    alakazamDef.abilities = [{ name: "Psychic Draw", type: "Ability", text: abilityText }];
    const kadabra = createCardInstance("kadabra", PlayerId.P1, Zone.Active);
    kadabra.enteredPlayTurn = 1;
    const alakazamCard = createCardInstance("alakazam-evo", PlayerId.P1, Zone.Hand);
    const draw1 = createCardInstance("draw-1", PlayerId.P1, Zone.Deck);
    const draw2 = createCardInstance("draw-2", PlayerId.P1, Zone.Deck);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        kadabra: kadabraDef,
        "alakazam-evo": alakazamDef,
        "draw-1": mockBasic("Draw One", "60", ["Colorless"]),
        "draw-2": mockBasic("Draw Two", "60", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: kadabra,
          hand: [alakazamCard],
          deck: [draw1, draw2],
        },
      },
    });

    state = gameReducer(state, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: alakazamCard.instanceId,
      targetId: kadabra.instanceId,
    });
    const hand = getPlayer(state, PlayerId.P1).hand;
    expect(hand.some((card) => card.instanceId === draw1.instanceId)).toBe(true);
    expect(hand.some((card) => card.instanceId === draw2.instanceId)).toBe(true);
  });

  it("Cynthia's Garchomp Champion's Call searches Cynthia's Pokémon from deck", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Cynthia's Garchomp")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Champion's Call", "Corkscrew Dive"]),
    );

    const abilityText =
      "Once during your turn, you may search your deck for a Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.";
    const gabiteDef = mockStage("Cynthia's Gabite", "Cynthia's Gible", "110", ["Fighting"]);
    gabiteDef.abilities = [{ name: "Champion's Call", type: "Ability", text: abilityText }];
    const gibleCard = createCardInstance("deck-gible", PlayerId.P1, Zone.Deck);
    const filler = createCardInstance("deck-filler", PlayerId.P1, Zone.Deck);
    const gabiteMon = createCardInstance("gabite", PlayerId.P1, Zone.Active);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        gabite: gabiteDef,
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

    state = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: gabiteMon.instanceId,
      abilityName: "Champion's Call",
    });
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === gibleCard.instanceId)).toBe(true);
  });

  it("Cynthia's Garchomp Corkscrew Dive offers optional draw until 6 cards", () => {
    const garchompDef = mockBasic("Cynthia's Garchomp ex", "320", ["Fighting"], [
      {
        name: "Corkscrew Dive",
        cost: ["Fighting", "Fighting"],
        convertedEnergyCost: 2,
        damage: "100",
        text: "You may draw cards until you have 6 cards in your hand.",
      },
    ]);
    const fighting = mockEnergy("Fighting Energy", ["Fighting"]);
    const garchomp = createCardInstance("garchomp", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    garchomp.attachedEnergy = [energy1, energy2];
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        garchomp: garchompDef,
        "energy-1": fighting,
        "energy-2": fighting,
        "p2-active": mockBasic("Defender", "300", ["Colorless"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: garchomp,
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Corkscrew Dive" });
    expect(state.pendingAction?.type).toBe("DRAW_UNTIL_HAND");

    state = gameReducer(state, { type: "CONFIRM_DRAW_UNTIL_HAND", playerId: PlayerId.P1 });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(6);
  });

  it("Greninja Shinobi Blade searches the deck after attacking", () => {
    const deck = UTRECHT_535_TOP16.decks.find((entry) => entry.deckName === "Greninja")!;
    expect(analyzeTournamentDeck(deck).signatureEffects.map((e) => e.effectName)).toEqual(
      expect.arrayContaining(["Shinobi Blade", "Mirage Barrage"]),
    );

    const greninjaDef = mockBasic("Greninja ex", "330", ["Water"], [
      {
        name: "Shinobi Blade",
        cost: ["Water", "Water"],
        convertedEnergyCost: 2,
        damage: "170",
        text: "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
      },
    ]);
    const water = mockEnergy("Water Energy", ["Water"]);
    const greninja = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const energy1 = createCardInstance("energy-1", PlayerId.P1, Zone.Active);
    const energy2 = createCardInstance("energy-2", PlayerId.P1, Zone.Active);
    greninja.attachedEnergy = [energy1, energy2];
    const deckPick = createCardInstance("deck-pick", PlayerId.P1, Zone.Deck);
    const base = activeBattleState();

    let state = activeBattleState({
      definitions: {
        ...base.definitions,
        greninja: greninjaDef,
        "energy-1": water,
        "energy-2": water,
        "deck-pick": mockBasic("Deck Pick", "60", ["Colorless"]),
        "p2-active": mockBasic("Defender", "330", ["Lightning"]),
      },
      players: {
        ...base.players,
        [PlayerId.P1]: {
          ...base.players[PlayerId.P1],
          active: greninja,
          deck: [deckPick],
        },
      },
    });

    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P1, attackName: "Shinobi Blade" });
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");

    state = gameReducer(state, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: deckPick.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === deckPick.instanceId)).toBe(true);
  });

  it("tracks engine-ready signature count across meta archetypes", () => {
    const analyses = analyzeAllUtrechtTop16();
    const summary = summarizeTop16Analysis(analyses);
    expect(summary.signatureEffects.engineReady).toBe(summary.signatureEffects.total);
    expect(summary.signatureEffects.gaps).toEqual([]);
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
