import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { parseTrainerText } from "../engine/effects/trainerText";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { BuiltDeck } from "./builder";
import {
  analyzeCriTrainerStaplesForPreset,
  CRI_ENGINE_READY_TRAINERS,
  CRI_TRAINER_STAPLES,
  summarizeCriTrainerCoverage,
} from "./criDeckAnalyzer";
import { getCriDeckById } from "./criDeckPresets";

function loadCriDeck(id: string): BuiltDeck {
  const preset = getCriDeckById(id)!;
  return buildPlaytestDeckFromCorpusText(preset.label, preset.text);
}

function findDefinition(deck: BuiltDeck, name: string): CardDefinition {
  const def = [...deck.definitions.values()].find((entry) => entry.name === name);
  expect(def, name).toBeDefined();
  return def!;
}

function findEnergyDefinition(deck: BuiltDeck): CardDefinition {
  const def = [...deck.definitions.values()].find((entry) => entry.supertype === "Energy");
  expect(def, "Energy").toBeDefined();
  return def!;
}

function criTrainerScenarioState(
  deck: BuiltDeck,
  setup: {
    p1HandTrainer: CardDefinition;
    p1ExtraHand?: CardDefinition[];
    p1DiscardPokemon?: CardDefinition;
    p1DeckPokemon?: CardDefinition;
    p2BenchPokemon?: CardDefinition;
    p1Prizes?: number;
    p2Prizes?: number;
    p2HandCount?: number;
    activeName?: string;
  },
): EngineState {
  const definitions: Record<string, CardDefinition> = {};
  for (const def of deck.definitions.values()) {
    definitions[def.apiId] = def;
  }

  const activeName = setup.activeName ?? "Froakie";
  const p1ActiveDef = findDefinition(deck, activeName);
  const p2ActiveDef = findDefinition(deck, activeName);
  const p1Active = createCardInstance(p1ActiveDef.apiId, PlayerId.P1, Zone.Active);
  const p2Active = createCardInstance(p2ActiveDef.apiId, PlayerId.P2, Zone.Active);
  const trainerCard = createCardInstance(setup.p1HandTrainer.apiId, PlayerId.P1, Zone.Hand);
  const fillerDef = findEnergyDefinition(deck);

  const p1Discard = setup.p1DiscardPokemon
    ? [createCardInstance(setup.p1DiscardPokemon.apiId, PlayerId.P1, Zone.Discard)]
    : [];
  const p1Deck = setup.p1DeckPokemon
    ? [createCardInstance(setup.p1DeckPokemon.apiId, PlayerId.P1, Zone.Deck)]
    : [];
  const p2Bench = setup.p2BenchPokemon
    ? [createCardInstance(setup.p2BenchPokemon.apiId, PlayerId.P2, Zone.Bench)]
    : [];
  const p2Hand = Array.from({ length: setup.p2HandCount ?? 0 }, () =>
    createCardInstance(fillerDef.apiId, PlayerId.P2, Zone.Hand),
  );
  const extraHand = (setup.p1ExtraHand ?? []).map((def) =>
    createCardInstance(def.apiId, PlayerId.P1, Zone.Hand),
  );

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
        deck: p1Deck,
        hand: [trainerCard, ...extraHand],
        active: p1Active,
        bench: [],
        prizes: Array.from({ length: setup.p1Prizes ?? 6 }, () =>
          createCardInstance(fillerDef.apiId, PlayerId.P1, Zone.Prizes),
        ),
        discard: p1Discard,
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: Array.from({ length: 10 }, () => createCardInstance(fillerDef.apiId, PlayerId.P2, Zone.Deck)),
        hand: p2Hand,
        active: p2Active,
        bench: p2Bench,
        prizes: Array.from({ length: setup.p2Prizes ?? 6 }, () =>
          createCardInstance(fillerDef.apiId, PlayerId.P2, Zone.Prizes),
        ),
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions,
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
}

describe("CRI trainer staples (Phase 2)", () => {
  const greninjaDeck = loadCriDeck("cri-greninja-water");

  it("attaches corpus rules text to CRI trainer stubs", () => {
    for (const staple of CRI_TRAINER_STAPLES) {
      const def = [...greninjaDeck.definitions.values()].find((entry) => entry.name === staple);
      if (!def) continue;
      expect(def.rules?.length, staple).toBeGreaterThan(0);
      const parsed = parseTrainerText(def);
      expect(parsed.parseCoverage, staple).not.toBe("empty");
    }
  });

  it("marks all CRI deck trainer staples as engine-ready", () => {
    const summary = summarizeCriTrainerCoverage();
    expect(summary.stapleCount).toBeGreaterThan(0);
    expect(summary.engineReady).toBe(summary.stapleCount);
    expect(summary.gaps).toEqual([]);
  });

  it("tracks parsed effect kinds for Greninja deck staples", () => {
    const preset = getCriDeckById("cri-greninja-water")!;
    const staples = analyzeCriTrainerStaplesForPreset(preset);
    expect(staples.every((entry) => entry.engineReady)).toBe(true);
    expect(staples.find((entry) => entry.cardName === "Lillie's Determination")?.effectKinds).toContain(
      "trainer_shuffle_hand_draw",
    );
    expect(staples.find((entry) => entry.cardName === "Ultra Ball")?.effectKinds).toContain(
      "trainer_ultra_ball",
    );
    for (const entry of staples) {
      expect(CRI_ENGINE_READY_TRAINERS.has(entry.cardName)).toBe(true);
    }
  });

  it("plays Lillie's Determination and draws 6", () => {
    const lillie = findDefinition(greninjaDeck, "Lillie's Determination");
    const filler = findDefinition(greninjaDeck, "Water Energy");
    let state = criTrainerScenarioState(greninjaDeck, { p1HandTrainer: lillie, p1Prizes: 4 });
    getPlayer(state, PlayerId.P1).hand.push(
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Hand),
    );
    getPlayer(state, PlayerId.P1).deck = Array.from({ length: 10 }, () =>
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
    );
    const card = getPlayer(state, PlayerId.P1).hand[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: card.instanceId });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(6);
    expect(state.pendingAction).toBeNull();
  });

  it("plays Judge and both players draw 4", () => {
    const judgeDeck = buildPlaytestDeckFromCorpusText(
      "Judge smoke",
      `Pokémon : 1
1 Froakie CRI 20

Trainer : 1
1 Judge POR 76

Energy : 1
1 Water Energy MEE 3`,
    );
    const judge = findDefinition(judgeDeck, "Judge");
    const filler = findDefinition(judgeDeck, "Water Energy");
    let state = criTrainerScenarioState(judgeDeck, { p1HandTrainer: judge });
    getPlayer(state, PlayerId.P1).deck = Array.from({ length: 8 }, () =>
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
    );
    getPlayer(state, PlayerId.P2).deck = Array.from({ length: 8 }, () =>
      createCardInstance(filler.apiId, PlayerId.P2, Zone.Deck),
    );
    const card = getPlayer(state, PlayerId.P1).hand[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: card.instanceId });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(4);
    expect(getPlayer(state, PlayerId.P2).hand).toHaveLength(4);
  });

  it("plays Boss's Orders and switches opponent Active", () => {
    const boss = findDefinition(greninjaDeck, "Boss's Orders");
    const benchMon = findDefinition(greninjaDeck, "Budew");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: boss,
      p2BenchPokemon: benchMon,
    });
    const bossCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const benchCard = getPlayer(state, PlayerId.P2).bench[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: bossCard.instanceId });
    expect(state.pendingAction?.type).toBe("BOSS_ORDERS");
    state = gameReducer(state, {
      type: "SWITCH_OPPONENT_ACTIVE",
      playerId: PlayerId.P1,
      benchInstanceId: benchCard.instanceId,
    });
    expect(getPlayer(state, PlayerId.P2).active?.instanceId).toBe(benchCard.instanceId);
  });

  it("plays Buddy-Buddy Poffin and benches a Basic from deck", () => {
    const poffin = findDefinition(greninjaDeck, "Buddy-Buddy Poffin");
    const froakie = findDefinition(greninjaDeck, "Froakie");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: poffin,
      p1DeckPokemon: froakie,
      activeName: "Frogadier",
    });
    const poffinCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const deckCard = getPlayer(state, PlayerId.P1).deck[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: poffinCard.instanceId });
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    state = gameReducer(state, { type: "PICK_DECK_CARD", playerId: PlayerId.P1, instanceId: deckCard.instanceId });
    expect(getPlayer(state, PlayerId.P1).bench).toHaveLength(1);
  });

  it("plays Night Stretcher and recovers a Pokémon from discard", () => {
    const stretcher = findDefinition(greninjaDeck, "Night Stretcher");
    const froakie = findDefinition(greninjaDeck, "Froakie");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: stretcher,
      p1DiscardPokemon: froakie,
    });
    const stretcherCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const discarded = getPlayer(state, PlayerId.P1).discard[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: stretcherCard.instanceId });
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === discarded.instanceId)).toBe(true);
  });

  it("plays Poké Pad and adds a no-Rule-Box Pokémon to hand", () => {
    const pad = findDefinition(greninjaDeck, "Poké Pad");
    const froakie = findDefinition(greninjaDeck, "Froakie");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: pad,
      p1DeckPokemon: froakie,
    });
    const padCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const deckCard = getPlayer(state, PlayerId.P1).deck[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: padCard.instanceId });
    if (state.pendingAction?.type === "SEARCH_DECK") {
      state = gameReducer(state, { type: "PICK_DECK_CARD", playerId: PlayerId.P1, instanceId: deckCard.instanceId });
    }
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.definitionId === froakie.apiId)).toBe(true);
  });

  it("plays Ultra Ball after discarding two hand cards", () => {
    const ultraBall = findDefinition(greninjaDeck, "Ultra Ball");
    const froakie = findDefinition(greninjaDeck, "Froakie");
    const filler = findDefinition(greninjaDeck, "Water Energy");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: ultraBall,
      p1DeckPokemon: froakie,
      p1ExtraHand: [filler, filler],
    });
    const ultraCard = getPlayer(state, PlayerId.P1).hand.find(
      (card) => state.definitions[card.definitionId]?.name === "Ultra Ball",
    )!;
    const discardTargets = getPlayer(state, PlayerId.P1).hand.filter((card) => card.instanceId !== ultraCard.instanceId);

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: ultraCard.instanceId });
    if (state.pendingAction?.type === "ULTRA_BALL_DISCARD") {
      state = gameReducer(state, {
        type: "SELECT_HAND_DISCARD",
        playerId: PlayerId.P1,
        instanceId: discardTargets[0]!.instanceId,
      });
      state = gameReducer(state, {
        type: "SELECT_HAND_DISCARD",
        playerId: PlayerId.P1,
        instanceId: discardTargets[1]!.instanceId,
      });
    }
    if (state.pendingAction?.type === "SEARCH_DECK") {
      state = gameReducer(state, {
        type: "PICK_DECK_CARD",
        playerId: PlayerId.P1,
        instanceId: state.pendingAction.options[0]!,
      });
    }
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.definitionId === froakie.apiId)).toBe(true);
  });

  it("plays Crispin and attaches Basic Energy from deck", () => {
    const crispin = findDefinition(greninjaDeck, "Crispin");
    const water = findDefinition(greninjaDeck, "Water Energy");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: crispin,
      activeName: "Froakie",
    });
    getPlayer(state, PlayerId.P1).deck.unshift(
      createCardInstance(water.apiId, PlayerId.P1, Zone.Deck),
    );
    const crispinCard = getPlayer(state, PlayerId.P1).hand[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: crispinCard.instanceId });
    if (state.pendingAction?.type === "CRISPIN_ATTACH") {
      state = gameReducer(state, {
        type: "SELECT_CRISPIN_TARGET",
        playerId: PlayerId.P1,
        pokemonId: getPlayer(state, PlayerId.P1).active!.instanceId,
      });
    }
    if (state.pendingAction?.type === "CRISPIN_DISCARD") {
      state = gameReducer(state, { type: "SKIP_OPTIONAL", playerId: PlayerId.P1 });
    }
    expect(getPlayer(state, PlayerId.P1).active!.attachedEnergy).toHaveLength(1);
  });

  it("plays Rare Candy and evolves a Basic Pokémon", () => {
    const candy = findDefinition(greninjaDeck, "Rare Candy");
    const greninjaEx = findDefinition(greninjaDeck, "Mega Greninja ex");
    const frogadier = findDefinition(greninjaDeck, "Frogadier");
    expect(frogadier.evolvesFrom).toBe("Froakie");
    let state = criTrainerScenarioState(greninjaDeck, {
      p1HandTrainer: candy,
      p1ExtraHand: [greninjaEx],
      activeName: "Froakie",
    });
    getPlayer(state, PlayerId.P1).active!.enteredPlayTurn = 1;
    const candyCard = getPlayer(state, PlayerId.P1).hand.find(
      (card) => state.definitions[card.definitionId]?.name === "Rare Candy",
    )!;
    const active = getPlayer(state, PlayerId.P1).active!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: candyCard.instanceId });
    expect(state.pendingAction?.type).toBe("RARE_CANDY");
    state = gameReducer(state, {
      type: "SELECT_RARE_CANDY_BASIC",
      playerId: PlayerId.P1,
      targetId: active.instanceId,
    });
    expect(getDefinitionSafe(state, getPlayer(state, PlayerId.P1).active!.definitionId).name).toBe(
      "Mega Greninja ex",
    );
  });

  it("plays Professor's Research and draws 7", () => {
    const pyroarDeck = loadCriDeck("cri-pyroar-fire");
    const professor = findDefinition(pyroarDeck, "Professor's Research");
    const filler = findEnergyDefinition(pyroarDeck);
    let state = criTrainerScenarioState(pyroarDeck, {
      p1HandTrainer: professor,
      activeName: "Litleo",
    });
    getPlayer(state, PlayerId.P1).hand.push(
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Hand),
    );
    getPlayer(state, PlayerId.P1).deck = Array.from({ length: 12 }, () =>
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
    );
    const professorCard = getPlayer(state, PlayerId.P1).hand.find(
      (card) => state.definitions[card.definitionId]?.name === "Professor's Research",
    )!;

    state = gameReducer(state, {
      type: "PLAY_TRAINER",
      playerId: PlayerId.P1,
      instanceId: professorCard.instanceId,
    });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(7);
    expect(state.pendingAction).toBeNull();
  });
});
