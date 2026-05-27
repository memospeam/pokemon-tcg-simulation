import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "./reducer";
import { getPlayer, type EngineState } from "./types";
import { emptyTurnFlags } from "./types";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockPokemon(
  name: string,
  subtypes: string[],
  evolvesFrom?: string,
  hp = "70",
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes,
    hp,
    types: ["Dragon"],
    abilities: [],
    attacks: [],
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
    evolvesFrom,
  };
}

function makeState(
  defs: Record<string, CardDefinition>,
  active: ReturnType<typeof createCardInstance>,
  hand: ReturnType<typeof createCardInstance>[],
  turnNumber: number,
): EngineState {
  const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: [],
        hand,
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
        active: p2Active,
        bench: [],
        prizes: [],
        discard: [],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: {
      ...defs,
      "p2-active": mockPokemon("OpponentBasic", ["Basic"]),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Evolution — cannot evolve twice in the same turn", () => {
  it("Dreepy → Drakloak → Dragapult chain in one turn is blocked at the second step", () => {
    const dreepyDef = mockPokemon("Dreepy", ["Basic"]);
    const drakloakDef = mockPokemon("Drakloak", ["Stage 1"], "Dreepy");
    const dragapultDef = mockPokemon("Dragapult", ["Stage 2"], "Drakloak", "180");

    // Dreepy was placed on turn 1 — so on turn 5 it's legal to evolve it once.
    const dreepy = createCardInstance("dreepy-def", PlayerId.P1, Zone.Active);
    dreepy.enteredPlayTurn = 1;
    const drakloakCard = createCardInstance("drakloak-def", PlayerId.P1, Zone.Hand);
    const dragapultCard = createCardInstance("dragapult-def", PlayerId.P1, Zone.Hand);

    const state = makeState(
      {
        "dreepy-def": dreepyDef,
        "drakloak-def": drakloakDef,
        "dragapult-def": dragapultDef,
      },
      dreepy,
      [drakloakCard, dragapultCard],
      5,
    );

    // First evolution: Dreepy → Drakloak. This is allowed.
    const afterFirst = gameReducer(state, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: drakloakCard.instanceId,
      targetId: dreepy.instanceId,
    });
    const p1After1 = getPlayer(afterFirst, PlayerId.P1);
    expect(p1After1.active?.instanceId).toBe(drakloakCard.instanceId);
    // The freshly-evolved Drakloak must be tagged as entered-this-turn,
    // otherwise the second evolution would slip through.
    expect(p1After1.active?.enteredPlayTurn).toBe(5);
    // Dragapult must still be in hand, ready (or not) for the next attempt.
    expect(p1After1.hand.some((c) => c.instanceId === dragapultCard.instanceId)).toBe(true);

    // Second evolution attempt: Drakloak → Dragapult on the SAME turn.
    // Per TCG rules this is illegal — the engine must reject it.
    const afterSecond = gameReducer(afterFirst, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: dragapultCard.instanceId,
      targetId: drakloakCard.instanceId,
    });
    const p1After2 = getPlayer(afterSecond, PlayerId.P1);
    // Active should still be Drakloak (not Dragapult).
    expect(p1After2.active?.instanceId).toBe(drakloakCard.instanceId);
    // Dragapult card should still be in the player's hand.
    expect(p1After2.hand.some((c) => c.instanceId === dragapultCard.instanceId)).toBe(true);
  });

  it("but the chain works across turns (Drakloak from last turn evolves into Dragapult this turn)", () => {
    const drakloakDef = mockPokemon("Drakloak", ["Stage 1"], "Dreepy");
    const dragapultDef = mockPokemon("Dragapult", ["Stage 2"], "Drakloak", "180");

    // Drakloak already in play — its enteredPlayTurn is BEFORE this turn.
    const drakloak = createCardInstance("drakloak-def", PlayerId.P1, Zone.Active);
    drakloak.enteredPlayTurn = 4;
    const dragapultCard = createCardInstance("dragapult-def", PlayerId.P1, Zone.Hand);

    const state = makeState(
      { "drakloak-def": drakloakDef, "dragapult-def": dragapultDef },
      drakloak,
      [dragapultCard],
      5,
    );

    const after = gameReducer(state, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: dragapultCard.instanceId,
      targetId: drakloak.instanceId,
    });
    const p1 = getPlayer(after, PlayerId.P1);
    // Drakloak was eligible (entered last turn) → evolution to Dragapult succeeds.
    expect(p1.active?.instanceId).toBe(dragapultCard.instanceId);
    expect(p1.active?.enteredPlayTurn).toBe(5);
  });
});
