import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "../engine/reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { BuiltDeck } from "./builder";
import { getTournamentDeckById } from "./tournamentPresets";

const DRAGAPULT_DECK_ID = "utrecht-2-hasan-kunukcu";

function loadTournamentDeck(deckId: string): BuiltDeck {
  const preset = getTournamentDeckById(deckId)!;
  return buildPlaytestDeckFromCorpusText(preset.label, preset.text);
}

function findDefinition(deck: BuiltDeck, name: string): CardDefinition {
  const def = [...deck.definitions.values()].find((entry) => entry.name === name);
  expect(def, name).toBeDefined();
  return def!;
}

function trainerScenarioState(
  deck: BuiltDeck,
  setup: {
    p1HandTrainer: CardDefinition;
    p1DiscardPokemon?: CardDefinition;
    p1DeckPokemon?: CardDefinition;
    p2BenchPokemon?: CardDefinition;
    p1Prizes?: number;
    p2Prizes?: number;
    p2HandCount?: number;
  },
): EngineState {
  const definitions: Record<string, CardDefinition> = {};
  for (const def of deck.definitions.values()) {
    definitions[def.apiId] = def;
  }

  const p1ActiveDef = findDefinition(deck, "Dreepy");
  const p2ActiveDef = findDefinition(deck, "Dreepy");
  const p1Active = createCardInstance(p1ActiveDef.apiId, PlayerId.P1, Zone.Active);
  const p2Active = createCardInstance(p2ActiveDef.apiId, PlayerId.P2, Zone.Active);
  const trainerCard = createCardInstance(setup.p1HandTrainer.apiId, PlayerId.P1, Zone.Hand);

  const p1Discard = setup.p1DiscardPokemon
    ? [createCardInstance(setup.p1DiscardPokemon.apiId, PlayerId.P1, Zone.Discard)]
    : [];
  const p1Deck = setup.p1DeckPokemon
    ? [createCardInstance(setup.p1DeckPokemon.apiId, PlayerId.P1, Zone.Deck)]
    : [];
  const p2Bench = setup.p2BenchPokemon
    ? [createCardInstance(setup.p2BenchPokemon.apiId, PlayerId.P2, Zone.Bench)]
    : [];
  const fillerDef = findDefinition(deck, "Psychic Energy");
  const p2Hand = Array.from({ length: setup.p2HandCount ?? 0 }, () =>
    createCardInstance(fillerDef.apiId, PlayerId.P2, Zone.Hand),
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
        hand: [trainerCard],
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

describe("Tournament trainer scenarios from real decklists", () => {
  const dragapultDeck = loadTournamentDeck(DRAGAPULT_DECK_ID);

  it("plays Boss's Orders from Tournament Dragapult list and switches opponent Active", () => {
    const boss = findDefinition(dragapultDeck, "Boss's Orders");
    const benchMon = findDefinition(dragapultDeck, "Munkidori");
    let state = trainerScenarioState(dragapultDeck, {
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

    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P2).active?.instanceId).toBe(benchCard.instanceId);
  });

  it("plays Buddy-Buddy Poffin from Tournament Dragapult list and benches Budew", () => {
    const poffin = findDefinition(dragapultDeck, "Buddy-Buddy Poffin");
    const budew = findDefinition(dragapultDeck, "Budew");
    let state = trainerScenarioState(dragapultDeck, {
      p1HandTrainer: poffin,
      p1DeckPokemon: budew,
    });
    const poffinCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const budewDeck = getPlayer(state, PlayerId.P1).deck[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: poffinCard.instanceId });
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    if (state.pendingAction?.type === "SEARCH_DECK") {
      expect(state.pendingAction.filter).toBe("POFFIN");
      expect(state.pendingAction.options).toContain(budewDeck.instanceId);
    }

    state = gameReducer(state, { type: "PICK_DECK_CARD", playerId: PlayerId.P1, instanceId: budewDeck.instanceId });
    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).bench).toHaveLength(1);
    expect(state.definitions[getPlayer(state, PlayerId.P1).bench[0]!.definitionId].name).toBe("Budew");
  });

  it("plays Night Stretcher from Tournament Dragapult list and recovers discard", () => {
    const stretcher = findDefinition(dragapultDeck, "Night Stretcher");
    const dreepy = findDefinition(dragapultDeck, "Dreepy");
    let state = trainerScenarioState(dragapultDeck, {
      p1HandTrainer: stretcher,
      p1DiscardPokemon: dreepy,
    });
    const stretcherCard = getPlayer(state, PlayerId.P1).hand[0]!;
    const discarded = getPlayer(state, PlayerId.P1).discard[0]!;

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: stretcherCard.instanceId });
    expect(getPlayer(state, PlayerId.P1).hand.some((card) => card.instanceId === discarded.instanceId)).toBe(true);
    expect(state.pendingAction).toBeNull();
  });

  it("plays Iono and draws 3 when ahead on Prizes", () => {
    const iono: CardDefinition = {
      ...findDefinition(dragapultDeck, "Boss's Orders"),
      apiId: "iono-test",
      name: "Iono",
      subtypes: ["Supporter"],
    };
    const fillerDef = findDefinition(dragapultDeck, "Psychic Energy");
    let state = trainerScenarioState(dragapultDeck, {
      p1HandTrainer: iono,
      p1Prizes: 6,
      p2Prizes: 4,
      p2HandCount: 1,
    });
    state.definitions[iono.apiId] = iono;
    const ionoCard = getPlayer(state, PlayerId.P1).hand[0]!;
    getPlayer(state, PlayerId.P1).hand.push(createCardInstance(fillerDef.apiId, PlayerId.P1, Zone.Hand));
    getPlayer(state, PlayerId.P1).deck = Array.from({ length: 10 }, () =>
      createCardInstance(fillerDef.apiId, PlayerId.P1, Zone.Deck),
    );

    state = gameReducer(state, { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: ionoCard.instanceId });

    expect(state.pendingAction).toBeNull();
    expect(getPlayer(state, PlayerId.P1).hand.length).toBe(3);
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(1);
  });
});
