import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import type { CardInstance } from "../../models/instance";
import { createCardInstance } from "../../models/instance";
import { applyMiracleHeadset, applyRotoStick } from "./trainerBatch5Effects";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

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

function stateWithDeckAndDiscard(
  deck: CardInstance[],
  discard: CardInstance[] = [],
): EngineState {
  return {
    phase: GamePhase.Active,
    turnNumber: 2,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck,
        hand: [],
        active: null,
        bench: [],
        prizes: [],
        discard,
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
    definitions: {
      boss: mockSupporter("Boss's Orders"),
      judge: mockSupporter("Judge"),
      energy: {
        apiId: "fire",
        name: "Fire Energy",
        supertype: "Energy",
        subtypes: ["Basic"],
        set: { id: "test", name: "Test" },
        number: "1",
        images: { small: "", large: "" },
      },
    },
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

describe("trainerBatch5Effects", () => {
  it("Roto-Stick puts a lone supporter from top 4 into hand", () => {
    const boss = createCardInstance("boss", PlayerId.P1, Zone.Deck);
    const energy = createCardInstance("energy", PlayerId.P1, Zone.Deck);
    const state = stateWithDeckAndDiscard([boss, energy]);

    applyRotoStick(state, PlayerId.P1);
    const player = getPlayer(state, PlayerId.P1);
    expect(player.hand).toHaveLength(1);
    expect(state.pendingAction).toBeNull();
  });

  it("Roto-Stick offers multiple supporters as a pending choice", () => {
    const boss = createCardInstance("boss", PlayerId.P1, Zone.Deck);
    const judge = createCardInstance("judge", PlayerId.P1, Zone.Deck);
    const energy = createCardInstance("energy", PlayerId.P1, Zone.Deck);
    const state = stateWithDeckAndDiscard([boss, judge, energy]);

    applyRotoStick(state, PlayerId.P1);
    expect(state.pendingAction?.type).toBe("ROTO_STICK");
  });

  it("Miracle Headset recovers supporters from discard", () => {
    const boss = createCardInstance("boss", PlayerId.P1, Zone.Discard);
    const judge = createCardInstance("judge", PlayerId.P1, Zone.Discard);
    const state = stateWithDeckAndDiscard([], [boss, judge]);

    applyMiracleHeadset(state, PlayerId.P1, 2);
    expect(state.pendingAction?.type).toBe("MIRACLE_HEADSET");
  });
});
