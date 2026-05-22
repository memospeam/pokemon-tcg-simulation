import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { beginGame, gameReducer, getLegalActions, startActiveGame } from "./reducer";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { getOpponentId, getPlayer, type EngineState } from "./types";
import { createCardInstance } from "../models/instance";

function findBasicInHand(state: EngineState, playerId: PlayerId) {
  return getPlayer(state, playerId).hand.find((card) => {
    const def = state.definitions[card.definitionId];
    return def?.supertype === "Pokémon" && def.subtypes.includes("Basic");
  });
}

function mockBasic(name: string, hp = "70"): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types: ["Fire"],
    attacks: [{ name: "Ember", cost: ["Fire"], convertedEnergyCost: 1, damage: "30", text: "" }],
    set: { id: "test", name: "Test", ptcgoCode: "TST" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function buildDeck(): CardDefinition[] {
  const cards: CardDefinition[] = [];
  for (let i = 0; i < 20; i += 1) cards.push(mockBasic(`MonA${i}`, "60"));
  for (let i = 0; i < 20; i += 1) {
    cards.push({
      apiId: `energy-${i}`,
      name: `Fire Energy ${i}`,
      supertype: "Energy",
      subtypes: ["Basic"],
      set: { id: "test", name: "Test" },
      number: `${100 + i}`,
      images: { small: "", large: "" },
    });
  }
  for (let i = 0; i < 20; i += 1) {
    cards.push({
      apiId: `trainer-${i}`,
      name: `Trainer ${i}`,
      supertype: "Trainer",
      subtypes: ["Item"],
      set: { id: "test", name: "Test" },
      number: `${200 + i}`,
      images: { small: "", large: "" },
    });
  }
  return cards;
}

describe("engine", () => {
  it("creates a game and deals opening hands", () => {
    const state = beginGame({
      player1Name: "Alice",
      player2Name: "Bob",
      player1Cards: buildDeck(),
      player2Cards: buildDeck(),
      seed: 42,
    });
    expect(getPlayer(state, PlayerId.P1).hand.length).toBe(7);
    expect(getPlayer(state, PlayerId.P2).hand.length).toBe(7);
  });

  it("allows placing active pokemon for both players", () => {
    let state = beginGame({
      player1Name: "Alice",
      player2Name: "Bob",
      player1Cards: buildDeck(),
      player2Cards: buildDeck(),
      seed: 1,
    });

    while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
      state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
    }

    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const player = getPlayer(state, playerId);
      if (player.active) continue;
      const basic = findBasicInHand(state, playerId);
      expect(basic).toBeTruthy();
      state = gameReducer(state, {
        type: "PLACE_ACTIVE",
        playerId,
        instanceId: basic!.instanceId,
      });
    }

    expect(getPlayer(state, PlayerId.P1).active).toBeTruthy();
    expect(getPlayer(state, PlayerId.P2).active).toBeTruthy();
    expect(state.phase).toBe(GamePhase.PlaceBench);
    state = startActiveGame(state);
    expect(state.phase).toBe(GamePhase.Active);
    expect(getPlayer(state, PlayerId.P1).prizes).toHaveLength(6);
  });

  it("blocks Supporter cards for the first player on Turn 1", () => {
    const deck = buildDeck();
    deck[0] = {
      apiId: "lillie",
      name: "Lillie's Determination",
      supertype: "Trainer",
      subtypes: ["Supporter"],
      set: { id: "test", name: "Test" },
      number: "119",
      images: { small: "", large: "" },
    };

    let state = beginGame({
      player1Name: "Alice",
      player2Name: "Bob",
      player1Cards: deck,
      player2Cards: buildDeck(),
      seed: 2,
    });

    while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
      state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
    }

    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      const basic = findBasicInHand(state, playerId);
      state = gameReducer(state, {
        type: "PLACE_ACTIVE",
        playerId,
        instanceId: basic!.instanceId,
      });
    }

    state = startActiveGame(state);
    expect(state.turnNumber).toBe(1);
    expect(state.currentPlayerId).toBe(state.firstPlayerId);

    const firstPlayer = getPlayer(state, state.firstPlayerId);
    const supporter = createCardInstance("lillie", state.firstPlayerId, Zone.Hand);
    firstPlayer.hand.push(supporter);

    const playSupporter = getLegalActions(state).find(
      (action) => action.type === "PLAY_TRAINER" && action.instanceId === supporter.instanceId,
    );
    expect(playSupporter).toBeUndefined();

    const item = firstPlayer.hand.find((card) => {
      const def = state.definitions[card.definitionId];
      return def?.supertype === "Trainer" && def.subtypes.includes("Item");
    });
    if (item) {
      const playItem = getLegalActions(state).find(
        (action) => action.type === "PLAY_TRAINER" && action.instanceId === item.instanceId,
      );
      expect(playItem).toBeDefined();
    }
  });

  it("ends the turn automatically after attacking", () => {
    const p2Mon = mockBasic("P2Mon", "200");
    const p1Mon = mockBasic("P1Mon", "200");
    const cards: CardDefinition[] = [];
    for (let i = 0; i < 58; i += 1) {
      cards.push({
        apiId: `energy-${i}`,
        name: `Fire Energy ${i}`,
        supertype: "Energy",
        subtypes: ["Basic"],
        types: ["Fire"],
        set: { id: "test", name: "Test" },
        number: `${100 + i}`,
        images: { small: "", large: "" },
      });
    }
    cards.push(p1Mon, p2Mon);

    let state = beginGame({
      player1Name: "Alice",
      player2Name: "Bob",
      player1Cards: cards,
      player2Cards: cards,
      seed: 3,
    });

    while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
      state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
    }

    const p1Basic = findBasicInHand(state, PlayerId.P1);
    const p2Basic = findBasicInHand(state, PlayerId.P2);
    state = gameReducer(state, { type: "PLACE_ACTIVE", playerId: PlayerId.P1, instanceId: p1Basic!.instanceId });
    state = gameReducer(state, { type: "PLACE_ACTIVE", playerId: PlayerId.P2, instanceId: p2Basic!.instanceId });
    state = startActiveGame(state);

    state = gameReducer(state, { type: "END_TURN" });
    expect(state.currentPlayerId).toBe(PlayerId.P2);

    const p2 = getPlayer(state, PlayerId.P2);
    const energy = p2.hand.find((card) => state.definitions[card.definitionId]?.supertype === "Energy");
    expect(energy).toBeTruthy();
    expect(p2.active).toBeTruthy();

    state = gameReducer(state, {
      type: "ATTACH_ENERGY",
      playerId: PlayerId.P2,
      energyId: energy!.instanceId,
      targetId: p2.active!.instanceId,
    });

    const attackerBefore = state.currentPlayerId;
    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P2, attackName: "Ember" });
    expect(state.turnFlags.attacked).toBe(false);
    expect(state.currentPlayerId).toBe(getOpponentId(attackerBefore));
    expect(state.log.some((entry) => entry.includes("ended their turn"))).toBe(true);
  });

  it("blocks Item cards on the opponent's next turn after Budew Itchy Pollen", () => {
    const budew: CardDefinition = {
      apiId: "budew",
      name: "Budew",
      supertype: "Pokémon",
      subtypes: ["Basic"],
      hp: "30",
      types: ["Grass"],
      attacks: [
        {
          name: "Itchy Pollen",
          cost: [],
          convertedEnergyCost: 0,
          damage: "10",
          text: "During your opponent's next turn, they can't play any Item cards from their hand.",
        },
      ],
      set: { id: "test", name: "Test" },
      number: "16",
      images: { small: "", large: "" },
    };
    const target = mockBasic("TargetMon", "200");
    const pokePad: CardDefinition = {
      apiId: "poke-pad",
      name: "Poké Pad",
      supertype: "Trainer",
      subtypes: ["Item"],
      set: { id: "test", name: "Test" },
      number: "81",
      images: { small: "", large: "" },
    };
    const cards: CardDefinition[] = [budew, target, pokePad];
    for (let i = 0; i < 57; i += 1) {
      cards.push({
        apiId: `filler-${i}`,
        name: `Filler ${i}`,
        supertype: "Energy",
        subtypes: ["Basic"],
        set: { id: "test", name: "Test" },
        number: `${i}`,
        images: { small: "", large: "" },
      });
    }

    let state = beginGame({
      player1Name: "Alice",
      player2Name: "Bob",
      player1Cards: cards,
      player2Cards: cards,
      seed: 9,
    });

    while (state.phase === GamePhase.Mulligan && state.pendingMulliganPlayerId) {
      state = gameReducer(state, { type: "MULLIGAN", playerId: state.pendingMulliganPlayerId });
    }

    const p1Basic = findBasicInHand(state, PlayerId.P1);
    state = gameReducer(state, { type: "PLACE_ACTIVE", playerId: PlayerId.P1, instanceId: p1Basic!.instanceId });

    const p2 = getPlayer(state, PlayerId.P2);
    let budewInstance = p2.hand.find((card) => card.definitionId === "budew");
    if (!budewInstance) {
      budewInstance = p2.deck.find((card) => card.definitionId === "budew");
      if (budewInstance) {
        p2.deck = p2.deck.filter((card) => card.instanceId !== budewInstance!.instanceId);
        budewInstance.zone = Zone.Hand;
        p2.hand.push(budewInstance);
      }
    }
    expect(budewInstance).toBeTruthy();
    state = gameReducer(state, {
      type: "PLACE_ACTIVE",
      playerId: PlayerId.P2,
      instanceId: budewInstance!.instanceId,
    });

    state = startActiveGame(state);
    state = gameReducer(state, { type: "END_TURN" });

    expect(state.currentPlayerId).toBe(PlayerId.P2);
    state = gameReducer(state, { type: "ATTACK", playerId: PlayerId.P2, attackName: "Itchy Pollen" });

    expect(state.itemPlayBlockedForPlayerId).toBe(PlayerId.P1);
    expect(state.currentPlayerId).toBe(PlayerId.P1);

    const p1 = getPlayer(state, PlayerId.P1);
    const itemInHand = createCardInstance("poke-pad", PlayerId.P1, Zone.Hand);
    p1.hand.push(itemInHand);

    const playItem = getLegalActions(state).find(
      (action) => action.type === "PLAY_TRAINER" && action.instanceId === itemInHand.instanceId,
    );
    expect(playItem).toBeUndefined();

    state = gameReducer(state, { type: "END_TURN" });
    expect(state.itemPlayBlockedForPlayerId).toBeNull();
  });
});
