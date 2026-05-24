import { describe, expect, it } from "vitest";
import { parseTrainerFullText } from "./parseTextTrainer";
import { parseTrainerText } from "./trainerText";
import { gameReducer } from "../reducer";
import { getDefinitionSafe } from "../rules";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";
import { PlayerId } from "../../models/enums";
import { createCardInstance } from "../../models/instance";
import { GamePhase, Zone } from "../../models/enums";
import { buildPlaytestDeckFromCorpusText } from "../../deck/corpusDeckBuilder";
import type { CardDefinition } from "../../models/definition";

describe("parseTextTrainer Proton", () => {
  it("parses Team Rocket's Proton rules text from the corpus", () => {
    const text =
      "If you go first, you may use this card during your first turn.  Search your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
    expect(parseTrainerFullText(text)).toEqual([{ kind: "trainer_proton", count: 3 }]);
  });

  it("plays Proton on turn 1 when going first and searches Basic Team Rocket Pokémon", () => {
    const deck = buildPlaytestDeckFromCorpusText(
      "Proton smoke",
      `Pokémon : 8
4 Team Rocket's Murkrow DRI 127
2 Team Rocket's Porygon DRI 153
2 Team Rocket's Honchkrow ASC 127

Trainer : 4
4 Team Rocket's Proton DRI 177

Energy : 48
48 Team Rocket's Energy DRI 182`,
    );
    const proton = [...deck.definitions.values()].find((d) => d.name === "Team Rocket's Proton")!;
    const murkrow = [...deck.definitions.values()].find((d) => d.name === "Team Rocket's Murkrow")!;
    expect(parseTrainerText(proton).effects.some((e) => e.kind === "trainer_proton")).toBe(true);

    const definitions: Record<string, CardDefinition> = Object.fromEntries(
      [...deck.definitions.values()].map((def) => [def.apiId, def]),
    );
    const deckCards = deck.cards
      .filter((card) => card.definitionId !== proton.apiId)
      .map((card) => createCardInstance(card.definitionId, PlayerId.P1, Zone.Deck));
    const protonCard = createCardInstance(proton.apiId, PlayerId.P1, Zone.Hand);
    const active = createCardInstance(murkrow.apiId, PlayerId.P1, Zone.Active);

    let state = gameReducer(
      {
        phase: GamePhase.Active,
        turnNumber: 1,
        currentPlayerId: PlayerId.P1,
        viewingPlayerId: PlayerId.P1,
        firstPlayerId: PlayerId.P1,
        players: {
          [PlayerId.P1]: {
            id: PlayerId.P1,
            name: "P1",
            deck: deckCards,
            hand: [protonCard],
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
      { type: "PLAY_TRAINER", playerId: PlayerId.P1, instanceId: protonCard.instanceId },
    );

    while (state.pendingAction?.type === "SEARCH_DECK") {
      state = gameReducer(state, {
        type: "PICK_DECK_CARD",
        playerId: PlayerId.P1,
        instanceId: state.pendingAction.options[0]!,
      });
    }

    const handNames = getPlayer(state, PlayerId.P1).hand.map(
      (card) => getDefinitionSafe(state, card.definitionId).name,
    );
    expect(handNames.some((name) => name.includes("Team Rocket's"))).toBe(true);
    expect(state.pendingAction).toBeNull();
  });
});
