import { describe, expect, it } from "vitest";
import { gameReducer } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { PlayerId } from "../models/enums";
import { createCardInstance } from "../models/instance";
import { GamePhase, Zone } from "../models/enums";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import { getCriDeckById } from "./criDeckPresets";

function loadDeck(id: string) {
  const preset = getCriDeckById(id)!;
  return buildPlaytestDeckFromCorpusText(preset.label, preset.text);
}

describe("CRI T3/T4 trainer scenarios", () => {
  it("plays Mega Signal and adds Mega Greninja ex to hand", () => {
    const deck = loadDeck("cri-greninja-water");
    const megaSignal = [...deck.definitions.values()].find((entry) => entry.name === "Mega Signal")!;
    const greninjaEx = [...deck.definitions.values()].find((entry) => entry.name === "Mega Greninja ex")!;
    const filler = [...deck.definitions.values()].find((entry) => entry.supertype === "Energy")!;

    const deckCards = [
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(greninjaEx.apiId, PlayerId.P1, Zone.Deck),
    ];
    const signalCard = createCardInstance(megaSignal.apiId, PlayerId.P1, Zone.Hand);
    const activeDef = [...deck.definitions.values()].find((entry) => entry.name === "Froakie")!;
    const active = createCardInstance(activeDef.apiId, PlayerId.P1, Zone.Active);

    const definitions = Object.fromEntries([...deck.definitions.values()].map((def) => [def.apiId, def]));
    let state = gameReducer(
      {
        phase: GamePhase.Active,
        turnNumber: 3,
        currentPlayerId: PlayerId.P1,
        viewingPlayerId: PlayerId.P1,
        firstPlayerId: PlayerId.P1,
        players: {
          [PlayerId.P1]: {
            id: PlayerId.P1,
            name: "P1",
            deck: deckCards,
            hand: [signalCard],
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
            active: null,
            bench: [],
            prizes: [],
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
      },
      { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: signalCard.instanceId },
    );

    if (state.pendingAction?.type === "SEARCH_DECK") {
      state = gameReducer(state, {
        type: "PICK_DECK_CARD",
        playerId: PlayerId.P1,
        instanceId: state.pendingAction.options[0]!,
      });
    }

    expect(
      getPlayer(state, PlayerId.P1).hand.some(
        (card) => getDefinitionSafe(state, card.definitionId).name === "Mega Greninja ex",
      ),
    ).toBe(true);
    expect(state.pendingAction).toBeNull();
  });
});
