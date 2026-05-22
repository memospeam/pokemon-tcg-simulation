import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { createInitialGame } from "../rules";
import { gameReducer } from "../reducer";
import { getPlayer } from "../types";
import { executeEffects, resolveReconDirectivePick } from "./execute";

function mockBasic(name: string, apiId = name): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "70",
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockDrakloak(): CardDefinition {
  return {
    apiId: "drakloak",
    name: "Drakloak",
    supertype: "Pokémon",
    subtypes: ["Stage 1"],
    hp: "90",
    abilities: [
      {
        name: "Recon Directive",
        type: "Ability",
        text: "Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck.",
      },
    ],
    set: { id: "test", name: "Test" },
    number: "129",
    images: { small: "", large: "" },
  };
}

describe("Recon Directive", () => {
  it("puts the only deck card into hand when deck has 1 card", () => {
    const drakloak = mockDrakloak();
    const top = mockBasic("TopCard", "top");
    const filler = mockBasic("Filler", "filler");
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: [drakloak, top, filler],
      player2Cards: [mockBasic("Rival")],
    });
    state.phase = GamePhase.Active;
    state.currentPlayerId = PlayerId.P1;

    const player = getPlayer(state, PlayerId.P1);
    const active = createCardInstance("drakloak", PlayerId.P1, Zone.Active);
    player.active = active;
    player.deck = [createCardInstance("top", PlayerId.P1, Zone.Deck)];

    const result = executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: active, opponentId: PlayerId.P2 },
      [{ kind: "recon_directive" }],
    );

    expect(result).toBe("complete");
    expect(player.hand).toHaveLength(1);
    expect(player.deck).toHaveLength(0);
    expect(state.definitions[player.hand[0]!.definitionId]?.name).toBe("TopCard");
  });

  it("lets you pick 1 of the top 2 cards and puts the other on the bottom", () => {
    const drakloak = mockDrakloak();
    const cardA = mockBasic("CardA", "a");
    const cardB = mockBasic("CardB", "b");
    const cardC = mockBasic("CardC", "c");
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: [drakloak, cardA, cardB, cardC],
      player2Cards: [mockBasic("Rival")],
    });
    state.phase = GamePhase.Active;
    state.currentPlayerId = PlayerId.P1;

    const player = getPlayer(state, PlayerId.P1);
    const active = createCardInstance("drakloak", PlayerId.P1, Zone.Active);
    player.active = active;
    const instA = createCardInstance("a", PlayerId.P1, Zone.Deck);
    const instB = createCardInstance("b", PlayerId.P1, Zone.Deck);
    const instC = createCardInstance("c", PlayerId.P1, Zone.Deck);
    player.deck = [instA, instB, instC];

    executeEffects(
      state,
      { playerId: PlayerId.P1, sourcePokemon: active, opponentId: PlayerId.P2 },
      [{ kind: "recon_directive" }],
    );

    expect(state.pendingAction?.type).toBe("RECON_DIRECTIVE");

    resolveReconDirectivePick(state, PlayerId.P1, instA.instanceId);

    expect(player.hand.map((card) => card.definitionId)).toEqual(["a"]);
    expect(player.deck.map((card) => card.definitionId)).toEqual(["c", "b"]);
    expect(state.pendingAction).toBeNull();
  });

  it("works through USE_ABILITY on Drakloak", () => {
    const drakloak = mockDrakloak();
    const cardA = mockBasic("CardA", "a");
    const cardB = mockBasic("CardB", "b");
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: [drakloak, cardA, cardB],
      player2Cards: [mockBasic("Rival")],
    });
    state.phase = GamePhase.Active;
    state.currentPlayerId = PlayerId.P1;

    const player = getPlayer(state, PlayerId.P1);
    const active = createCardInstance("drakloak", PlayerId.P1, Zone.Active);
    player.active = active;
    player.deck = [
      createCardInstance("a", PlayerId.P1, Zone.Deck),
      createCardInstance("b", PlayerId.P1, Zone.Deck),
    ];

    const afterUse = gameReducer(state, {
      type: "USE_ABILITY",
      playerId: PlayerId.P1,
      pokemonId: active.instanceId,
      abilityName: "Recon Directive",
    });

    expect(afterUse.pendingAction?.type).toBe("RECON_DIRECTIVE");

    const pickedId = afterUse.pendingAction?.type === "RECON_DIRECTIVE"
      ? afterUse.pendingAction.options[0]!
      : "";
    const finalState = gameReducer(afterUse, {
      type: "PICK_DECK_CARD",
      playerId: PlayerId.P1,
      instanceId: pickedId,
    });

    const finalPlayer = getPlayer(finalState, PlayerId.P1);
    expect(finalPlayer.hand).toHaveLength(1);
    expect(finalPlayer.deck).toHaveLength(1);
    expect(finalState.pendingAction).toBeNull();
  });
});
