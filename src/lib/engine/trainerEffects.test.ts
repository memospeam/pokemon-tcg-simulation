import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { applyRareCandy, applyTrainerEffect } from "./trainerEffects";
import { createInitialGame } from "./rules";
import { getPlayer } from "./types";

function mockTrainer(name: string, subtypes: string[] = ["Item"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockBasic(name: string, hp = "70"): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(name = "Fire Energy"): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Energy",
    subtypes: ["Basic"],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

describe("trainerEffects", () => {
  it("Lillie's Determination shuffles hand into deck and draws 6", () => {
    const lillie = mockTrainer("Lillie's Determination", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("B").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("C").apiId, PlayerId.P1, Zone.Hand),
    ];
    player.deck = Array.from({ length: 10 }, (_, i) =>
      createCardInstance(mockEnergy(`Deck${i}`).apiId, PlayerId.P1, Zone.Deck),
    );

    applyTrainerEffect(state, PlayerId.P1, lillie);
    expect(player.hand.length).toBe(6);
  });

  it("Lillie's Determination draws 8 with exactly 6 Prize cards remaining", () => {
    const lillie = mockTrainer("Lillie's Determination", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.prizes = Array.from({ length: 6 }, (_, i) =>
      createCardInstance(mockEnergy(`P${i}`).apiId, PlayerId.P1, Zone.Prizes),
    );
    player.deck = Array.from({ length: 12 }, (_, i) =>
      createCardInstance(mockEnergy(`Deck${i}`).apiId, PlayerId.P1, Zone.Deck),
    );

    applyTrainerEffect(state, PlayerId.P1, lillie);
    expect(player.hand.length).toBe(8);
  });

  it("Poké Pad searches Pokémon without Rule Box", () => {
    const pokePad = mockTrainer("Poké Pad");
    const dreepy = mockBasic("Dreepy");
    const dragapult = {
      ...mockBasic("Dragapult ex", "320"),
      name: "Dragapult ex",
      subtypes: ["Stage 2", "ex"],
    };
    const cards = [
      dreepy,
      dragapult,
      ...Array.from({ length: 58 }, (_, i) => mockEnergy(`E${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.deck = [
      createCardInstance(dragapult.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Deck),
    ];

    applyTrainerEffect(state, PlayerId.P1, pokePad);
    expect(state.pendingAction?.type).toBe("SEARCH_DECK");
    if (state.pendingAction?.type === "SEARCH_DECK") {
      expect(state.pendingAction.filter).toBe("POKEMON_NO_RULE_BOX");
      expect(state.pendingAction.options).toHaveLength(2);
    }
  });

  it("Ultra Ball requires discarding 2 cards first", () => {
    const ultraBall = mockTrainer("Ultra Ball");
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    const player = getPlayer(state, PlayerId.P1);
    player.hand = [
      createCardInstance(mockBasic("A").apiId, PlayerId.P1, Zone.Hand),
      createCardInstance(mockBasic("B").apiId, PlayerId.P1, Zone.Hand),
    ];

    applyTrainerEffect(state, PlayerId.P1, ultraBall);
    expect(state.pendingAction?.type).toBe("ULTRA_BALL_DISCARD");
  });

  it("Judge shuffles both hands and draws 4", () => {
    const judge = mockTrainer("Judge", ["Supporter"]);
    const cards = [mockBasic("Dreepy"), ...Array.from({ length: 59 }, (_, i) => mockEnergy(`E${i}`))];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
    });
    state.phase = GamePhase.Active;
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const player = getPlayer(state, playerId);
      player.hand = Array.from({ length: 5 }, (_, i) =>
        createCardInstance(mockEnergy(`H${playerId}${i}`).apiId, playerId, Zone.Hand),
      );
      player.deck = Array.from({ length: 20 }, (_, i) =>
        createCardInstance(mockEnergy(`D${playerId}${i}`).apiId, playerId, Zone.Deck),
      );
    }

    applyTrainerEffect(state, PlayerId.P1, judge);
    expect(getPlayer(state, PlayerId.P1).hand.length).toBe(4);
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(4);
  });

  it("Rare Candy evolves Basic to Stage 2 via evolution line (Dreepy → Dragapult ex)", () => {
    const dreepy = mockBasic("Dreepy");
    const drakloak = {
      ...mockBasic("Drakloak", "90"),
      subtypes: ["Stage 1"],
      evolvesFrom: "Dreepy",
    };
    const dragapult = {
      ...mockBasic("Dragapult ex", "320"),
      subtypes: ["Stage 2", "ex"],
      evolvesFrom: "Drakloak",
    };
    const rareCandy = mockTrainer("Rare Candy");
    const cards = [
      dreepy,
      drakloak,
      dragapult,
      rareCandy,
      ...Array.from({ length: 55 }, (_, i) => mockEnergy(`E${i}`)),
    ];
    const state = createInitialGame({
      player1Name: "A",
      player2Name: "B",
      player1Cards: cards,
      player2Cards: cards,
      extraDefinitions: [drakloak],
    });
    state.phase = GamePhase.Active;
    state.turnNumber = 2;
    const player = getPlayer(state, PlayerId.P1);
    player.active = createCardInstance(dreepy.apiId, PlayerId.P1, Zone.Active);
    player.active!.enteredPlayTurn = 1;
    player.hand = [createCardInstance(dragapult.apiId, PlayerId.P1, Zone.Hand)];

    applyRareCandy(state, PlayerId.P1, player.active!.instanceId);
    expect(player.active?.definitionId).toBe(dragapult.apiId);
    expect(player.hand).toHaveLength(0);
  });
});
