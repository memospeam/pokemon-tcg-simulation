import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { checkWinCondition } from "./rules";
import { emptyTurnFlags, type EngineState } from "./types";

/**
 * Regression: checkWinCondition previously declared the opponent the winner
 * whenever a player's deck reached 0 mid-game. Per TCG rules, a player only
 * loses to deck-out when they FAIL TO DRAW at the start of their turn — not
 * the moment their deck count hits zero. (That is correctly handled in
 * handleDraw.)
 *
 * Example case: it's P2's turn. The end-of-turn draw can leave P1 with deck=0
 * even though P1 hasn't lost yet — they still have prizes, an Active Pokémon,
 * and a hand. checkWinCondition must not declare P2 the winner here.
 */

function mockBasic(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "60",
    types: ["Colorless"],
    abilities: [],
    attacks: [],
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function makeBaseState(): EngineState {
  const p1Active = createCardInstance("Mon", PlayerId.P1, Zone.Active);
  const p2Active = createCardInstance("Mon", PlayerId.P2, Zone.Active);
  const prize = (owner: PlayerId) => {
    const c = createCardInstance("Mon", owner, Zone.Prizes);
    return c;
  };
  return {
    phase: GamePhase.Active,
    turnNumber: 5,
    currentPlayerId: PlayerId.P2,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [],
        hand: [createCardInstance("Mon", PlayerId.P1, Zone.Hand)],
        active: p1Active,
        bench: [],
        prizes: [prize(PlayerId.P1), prize(PlayerId.P1), prize(PlayerId.P1)],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: [createCardInstance("Mon", PlayerId.P2, Zone.Deck)],
        hand: [],
        active: p2Active,
        bench: [],
        prizes: [prize(PlayerId.P2), prize(PlayerId.P2), prize(PlayerId.P2)],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: { Mon: mockBasic("Mon") },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 1,
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

describe("checkWinCondition: empty deck is not an immediate loss", () => {
  it("returns null when a player has 0 deck cards but still has an Active and prizes", () => {
    const state = makeBaseState();
    // P1 has 0 deck, but they still have an Active, hand, and prizes.
    // No loss should be declared.
    expect(checkWinCondition(state)).toBe(null);
  });

  it("returns null even when both players have 0 deck", () => {
    const state = makeBaseState();
    state.players[PlayerId.P2].deck = [];
    expect(checkWinCondition(state)).toBe(null);
  });

  it("still declares winner by prizes (prize count 0)", () => {
    const state = makeBaseState();
    state.players[PlayerId.P1].prizes = [];
    expect(checkWinCondition(state)).toBe(PlayerId.P1);
  });

  it("still declares loss when active is null and bench is empty", () => {
    const state = makeBaseState();
    state.players[PlayerId.P1].active = null;
    state.players[PlayerId.P1].bench = [];
    expect(checkWinCondition(state)).toBe(PlayerId.P2);
  });
});
