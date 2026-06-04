import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "./reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "./types";

/**
 * Regression: promoting a Pokémon from the Bench to the Active Spot (e.g. the
 * PROMOTE pending created after Dudunsparce's Run Away Draw shuffles the Active
 * away) must set turnFlags.movedFromBenchToActiveIds, exactly like Retreat
 * does. Otherwise Mega Lopunny ex's Gale Thrust ("+170 if this Pokémon moved
 * from the Bench to the Active Spot this turn") only deals its base 60.
 */

function mockBasic(name: string, hp = "200"): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Pokémon", subtypes: ["Basic"], hp, types: ["Colorless"],
    abilities: [], attacks: [],
    set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}

function stateWithEmptyActive(): EngineState {
  const lopunny = createCardInstance("lopunny", PlayerId.P1, Zone.Bench);
  const oppActive = createCardInstance("opp", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 5,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active: null, bench: [lopunny], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: oppActive, bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { lopunny: mockBasic("Mega Lopunny ex", "200"), opp: mockBasic("Opp") },
    log: [], actionLog: [], winnerId: null, rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: { type: "PROMOTE", playerId: PlayerId.P1 },
    heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("PROMOTE_BENCH marks moved-from-bench (Gale Thrust bonus)", () => {
  it("promoting from bench sets turnFlags.movedFromBenchToActiveIds", () => {
    const state = stateWithEmptyActive();
    const lopunny = getPlayer(state, PlayerId.P1).bench[0]!;

    const after = gameReducer(state, {
      type: "PROMOTE_BENCH",
      playerId: PlayerId.P1,
      instanceId: lopunny.instanceId,
    });

    const p1 = getPlayer(after, PlayerId.P1);
    expect(p1.active?.instanceId).toBe(lopunny.instanceId);
    expect(after.turnFlags.movedFromBenchToActiveIds ?? []).toContain(lopunny.instanceId);
    expect(after.pendingAction).toBeNull();
  });
});
