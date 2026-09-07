import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { createCardInstance } from "../../models/instance";
import { gameReducer } from "../reducer";
import { emptyTurnFlags, type EngineState } from "../types";
import { getGrandTreeStage2Options, resolveGrandTreeStage1 } from "./grandTreeEffects";

function mockPokemon(name: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "70",
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    ...opts,
  };
}

function mockStadium(): CardDefinition {
  return {
    apiId: "Grand Tree",
    name: "Grand Tree",
    supertype: "Trainer",
    subtypes: ["Stadium"],
    rules: [],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

describe("Grand Tree effects", () => {
  it("finishes immediately after Stage 1 when deck has no Stage 2", () => {
    const dreepy = mockPokemon("Dreepy");
    const drakloak = mockPokemon("Drakloak", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Dreepy",
    });
    const basic = createCardInstance("dreepy", PlayerId.P1, Zone.Active);
    const stage1 = createCardInstance("drakloak", PlayerId.P1, Zone.Deck);
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);

    const state: EngineState = {
      phase: GamePhase.Active,
      turnNumber: 3,
      currentPlayerId: PlayerId.P1,
      viewingPlayerId: PlayerId.P1,
      firstPlayerId: PlayerId.P1,
      players: {
        [PlayerId.P1]: {
          id: PlayerId.P1,
          name: "P1",
          deck: [stage1],
          hand: [],
          active: basic,
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
      stadium,
      stadiumOwnerId: PlayerId.P1,
      definitions: {
        stadium: mockStadium(),
        dreepy,
        drakloak,
      },
      log: [],
      actionLog: [],
      winnerId: null,
      rngSeed: 1,
      turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null,
      pendingAction: {
        type: "GRAND_TREE",
        playerId: PlayerId.P1,
        step: "STAGE1",
        basicTargetId: basic.instanceId,
        options: [stage1.instanceId],
      },
      heldCard: null,
      itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    resolveGrandTreeStage1(state, PlayerId.P1, stage1.instanceId);
    expect(state.pendingAction).toBeNull();
    expect(state.turnFlags.stadiumOncePerTurnUsed).toBe(true);
    expect(getGrandTreeStage2Options(state, PlayerId.P1, state.players[PlayerId.P1].active!)).toHaveLength(0);
  });

  it("reducer skips Stage 2 pending when no Stage 2 is in deck", () => {
    const dreepy = mockPokemon("Dreepy");
    const drakloak = mockPokemon("Drakloak", {
      subtypes: ["Stage 1"],
      evolvesFrom: "Dreepy",
    });
    const basic = createCardInstance("dreepy", PlayerId.P1, Zone.Active);
    const stage1 = createCardInstance("drakloak", PlayerId.P1, Zone.Deck);
    const stadium = createCardInstance("stadium", PlayerId.P1, Zone.Stadium);

    const state: EngineState = {
      phase: GamePhase.Active,
      turnNumber: 3,
      currentPlayerId: PlayerId.P1,
      viewingPlayerId: PlayerId.P1,
      firstPlayerId: PlayerId.P1,
      players: {
        [PlayerId.P1]: {
          id: PlayerId.P1,
          name: "P1",
          deck: [stage1],
          hand: [],
          active: basic,
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
      stadium,
      stadiumOwnerId: PlayerId.P1,
      definitions: {
        stadium: mockStadium(),
        dreepy,
        drakloak,
      },
      log: [],
      actionLog: [],
      winnerId: null,
      rngSeed: 1,
      turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null,
      pendingAction: {
        type: "GRAND_TREE",
        playerId: PlayerId.P1,
        step: "STAGE1",
        basicTargetId: basic.instanceId,
        options: [stage1.instanceId],
      },
      heldCard: null,
      itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    const next = gameReducer(state, {
      type: "SELECT_GRAND_TREE_STAGE1",
      playerId: PlayerId.P1,
      instanceId: stage1.instanceId,
    });
    expect(next.pendingAction).toBeNull();
    expect(next.turnFlags.stadiumOncePerTurnUsed).toBe(true);
  });
});
