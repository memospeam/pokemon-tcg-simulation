import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { PlayerId, Zone, GamePhase } from "../../models/enums";
import { createCardInstance } from "../../models/instance";
import {
  applyTrainerBatch10Kind,
  canPlayTrainerBatch10Kind,
  continueExplorersGuidancePick,
  continueEriDiscardPick,
} from "./trainerBatch10Effects";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";

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

function mockPokemon(
  name: string,
  opts: { subtypes?: string[]; types?: string[]; hp?: string; evolvesFrom?: string } = {},
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: opts.subtypes ?? ["Basic"],
    hp: opts.hp ?? "70",
    types: opts.types ?? ["Water"],
    evolvesFrom: opts.evolvesFrom,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function baseState(overrides: Partial<EngineState> = {}): EngineState {
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
        deck: [],
        hand: [],
        active: null,
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
    definitions: {},
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
    ...overrides,
  };
}

describe("trainerBatch10Effects", () => {
  it("Mega Signal searches a lone Mega Evolution ex from deck", () => {
    const greninja = mockPokemon("Mega Greninja ex", {
      subtypes: ["Stage 2", "MEGA", "ex"],
      types: ["Water"],
      hp: "330",
    });
    const filler = mockPokemon("Froakie");
    const deck = [
      createCardInstance(filler.apiId, PlayerId.P1, Zone.Deck),
      createCardInstance(greninja.apiId, PlayerId.P1, Zone.Deck),
    ];
    const state = baseState({
      definitions: { [greninja.apiId]: greninja, [filler.apiId]: filler },
      players: {
        ...baseState().players,
        [PlayerId.P1]: { ...baseState().players[PlayerId.P1], deck },
      },
    });

    applyTrainerBatch10Kind(state, PlayerId.P1, { kind: "trainer_mega_signal" });
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(1);
    expect(state.pendingAction).toBeNull();
  });

  it("Eri discards opponent Item cards and supports optional picks", () => {
    const item = mockTrainer("Switch", ["Item"]);
    const supporter = mockTrainer("Judge", ["Supporter"]);
    const p2Hand = [
      createCardInstance(item.apiId, PlayerId.P2, Zone.Hand),
      createCardInstance(item.apiId, PlayerId.P2, Zone.Hand),
      createCardInstance(supporter.apiId, PlayerId.P2, Zone.Hand),
      createCardInstance(item.apiId, PlayerId.P2, Zone.Hand),
    ];
    const state = baseState({
      definitions: { [item.apiId]: item, [supporter.apiId]: supporter },
      players: {
        ...baseState().players,
        [PlayerId.P2]: { ...baseState().players[PlayerId.P2], hand: p2Hand },
      },
    });

    applyTrainerBatch10Kind(state, PlayerId.P1, { kind: "trainer_eri" });
    expect(state.pendingAction?.type).toBe("ERI_DISCARD");
    continueEriDiscardPick(state, PlayerId.P1, p2Hand[0]!.instanceId);
    expect(getPlayer(state, PlayerId.P2).discard).toHaveLength(1);
  });

  it("Explorer's Guidance keeps two revealed cards and discards the rest", () => {
    const cards = ["a", "b", "c", "d"].map((id) => {
      const def = mockPokemon(id);
      return { def, card: createCardInstance(def.apiId, PlayerId.P1, Zone.Deck) };
    });
    const state = baseState({
      definitions: Object.fromEntries(cards.map(({ def }) => [def.apiId, def])),
      pendingAction: {
        type: "EXPLORERS_GUIDANCE",
        playerId: PlayerId.P1,
        options: cards.map(({ card }) => card.instanceId),
        slotsRemaining: 2,
        pickedIds: [],
        revealPool: cards.map(({ card }) => card.instanceId),
      },
      players: {
        ...baseState().players,
        [PlayerId.P1]: {
          ...baseState().players[PlayerId.P1],
          deck: cards.map(({ card }) => card),
        },
      },
    });

    continueExplorersGuidancePick(state, PlayerId.P1, cards[0]!.card.instanceId);
    continueExplorersGuidancePick(state, PlayerId.P1, cards[1]!.card.instanceId);
    expect(getPlayer(state, PlayerId.P1).hand).toHaveLength(2);
    expect(getPlayer(state, PlayerId.P1).discard).toHaveLength(2);
    expect(state.pendingAction).toBeNull();
  });

  it("blocks Eri when opponent has no Item cards", () => {
    const supporter = mockTrainer("Judge", ["Supporter"]);
    const state = baseState({
      definitions: { [supporter.apiId]: supporter },
      players: {
        ...baseState().players,
        [PlayerId.P2]: {
          ...baseState().players[PlayerId.P2],
          hand: [createCardInstance(supporter.apiId, PlayerId.P2, Zone.Hand)],
        },
      },
    });
    expect(canPlayTrainerBatch10Kind(state, PlayerId.P1, "trainer_eri").ok).toBe(false);
  });
});
