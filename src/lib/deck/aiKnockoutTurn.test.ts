import { describe, expect, it } from "vitest";
import { createCardInstance } from "../models/instance";
import type { CardDefinition } from "../models/definition";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";
import { buildStrategyContext } from "./deckStrategy";
import { aiContinuesAfterStep, runAIOneStep } from "./metaGameRunner";

function basic(name: string): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "60",
    types: ["Colorless"],
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

/** Human just Knocked Out the AI's Active. The AI must promote, which ends the attack and starts the AI's turn. */
function koPromoteState(): EngineState {
  const bench = createCardInstance("bench", PlayerId.P2, Zone.Bench);
  const draw = createCardInstance("draw", PlayerId.P2, Zone.Deck);
  const flags = emptyTurnFlags();
  flags.attacked = true;
  return {
    phase: GamePhase.Active,
    turnNumber: 4,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "You",
        deck: [createCardInstance("p1deck", PlayerId.P1, Zone.Deck)],
        hand: [],
        active: createCardInstance("p1active", PlayerId.P1, Zone.Active),
        bench: [],
        prizes: [createCardInstance("p1prize", PlayerId.P1, Zone.Prizes)],
        discard: [],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "AI",
        deck: [draw],
        hand: [],
        active: null,
        bench: [bench],
        prizes: [createCardInstance("p2prize", PlayerId.P2, Zone.Prizes)],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      bench: basic("Benched"),
      draw: { ...basic("Draw"), supertype: "Energy", subtypes: ["Basic"], hp: undefined },
      p1deck: { ...basic("P1"), supertype: "Energy", subtypes: ["Basic"], hp: undefined },
      p1active: basic("Attacker"),
      p1prize: { ...basic("Prize"), supertype: "Energy", subtypes: ["Basic"], hp: undefined },
      p2prize: { ...basic("Prize 2"), supertype: "Energy", subtypes: ["Basic"], hp: undefined },
    },
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 1,
    turnFlags: flags,
    pendingMulliganPlayerId: null,
    pendingAction: { type: "PROMOTE", playerId: PlayerId.P2 },
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("AI after its Pokémon is Knocked Out", () => {
  it("promotes and keeps the turn that just started", () => {
    const state = koPromoteState();
    const ctx = buildStrategyContext(["Benched"]);
    const promoted = runAIOneStep(state, ctx, PlayerId.P2);

    expect(getPlayer(promoted.state, PlayerId.P2).active).toBeTruthy();
    expect(promoted.state.currentPlayerId).toBe(PlayerId.P2);
    expect(promoted.state.pendingAction).toBeNull();
    expect(promoted.done).toBe(true);
    expect(aiContinuesAfterStep(state, promoted.state, PlayerId.P2)).toBe(true);

    const played = runAIOneStep(promoted.state, ctx, PlayerId.P2);
    expect(played.state).not.toBe(promoted.state);
    expect(played.state.currentPlayerId).toBe(PlayerId.P1);
  });
});
