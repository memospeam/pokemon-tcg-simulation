import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "./reducer";
import { createInitialGame } from "./rules";
import { emptyTurnFlags, getPlayer, type EngineState } from "./types";

/**
 * Regression for the user-reported bug:
 *   "ทำไมเมื่อเริ่ม Turn 1 ถึงสามารถ evolve เป็น Mega Lopunny ex ได้?"
 *
 * Root cause: setup basics had enteredPlayTurn = 0 (the pre-game turn) but
 * turn 1 had turnNumber = 1, so the engine's "did this Pokémon enter play
 * this turn" check returned false → evolution was incorrectly allowed.
 *
 * Per TCG rules: Pokémon placed during setup count as "just entered play"
 * on turn 1 — they CANNOT evolve until turn 2.
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

function mockEvolution(name: string, evolvesFrom: string): CardDefinition {
  return {
    apiId: name,
    name,
    subtypes: ["Stage 1"],
    supertype: "Pokémon",
    hp: "200",
    types: ["Colorless"],
    abilities: [],
    attacks: [],
    evolvesFrom,
    set: { id: "t", name: "t" },
    number: "2",
    images: { small: "", large: "" },
  };
}

describe("Turn 1 evolution block", () => {
  it("setup-placed basics cannot evolve on turn 1", () => {
    const bunearyDef = mockBasic("Buneary");
    const lopunnyDef = mockEvolution("Mega Lopunny ex", "Buneary");

    // Hand-built state mimicking the moment turn 1 begins: setup is finished,
    // turnNumber = 1, Buneary already placed (enteredPlayTurn = 1 after the
    // startGame stamp), Mega Lopunny ex still in hand.
    const buneary = createCardInstance("Buneary", PlayerId.P1, Zone.Active);
    buneary.enteredPlayTurn = 1; // stamped by startGameIfReady
    const lopunnyCard = createCardInstance("Mega Lopunny ex", PlayerId.P1, Zone.Hand);
    const opp = createCardInstance("opp", PlayerId.P2, Zone.Active);

    const state: EngineState = {
      phase: GamePhase.Active,
      turnNumber: 1,
      currentPlayerId: PlayerId.P1,
      viewingPlayerId: PlayerId.P1,
      firstPlayerId: PlayerId.P1,
      players: {
        [PlayerId.P1]: {
          id: PlayerId.P1, name: "P1",
          deck: [], hand: [lopunnyCard], active: buneary, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
        [PlayerId.P2]: {
          id: PlayerId.P2, name: "P2",
          deck: [], hand: [], active: opp, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
      },
      stadium: null,
      stadiumOwnerId: null,
      definitions: {
        "Buneary": bunearyDef,
        "Mega Lopunny ex": lopunnyDef,
        "opp": mockBasic("Opp"),
      },
      log: [], actionLog: [], winnerId: null, rngSeed: 42,
      turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null, pendingAction: null,
      heldCard: null, itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    const after = gameReducer(state, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: lopunnyCard.instanceId,
      targetId: buneary.instanceId,
    });

    const p1 = getPlayer(after, PlayerId.P1);
    // Mega Lopunny ex should NOT have replaced Buneary
    expect(p1.active?.instanceId).toBe(buneary.instanceId);
    // Mega Lopunny ex should still be in hand
    expect(p1.hand.some((c) => c.instanceId === lopunnyCard.instanceId)).toBe(true);
  });

  it("evolutions become legal once turnNumber advances to 2", () => {
    // Same hand-built turn-1 state, but advance to turn 2 manually.
    const bunearyDef = mockBasic("Buneary");
    const lopunnyDef = mockEvolution("Mega Lopunny ex", "Buneary");

    const buneary = createCardInstance("Buneary", PlayerId.P1, Zone.Active);
    buneary.enteredPlayTurn = 1; // setup-stamped
    const lopunnyCard = createCardInstance("Mega Lopunny ex", PlayerId.P1, Zone.Hand);
    const opp = createCardInstance("opp", PlayerId.P2, Zone.Active);

    const state: EngineState = {
      phase: GamePhase.Active,
      turnNumber: 2, // ← turn 2 now
      currentPlayerId: PlayerId.P1,
      viewingPlayerId: PlayerId.P1,
      firstPlayerId: PlayerId.P1,
      players: {
        [PlayerId.P1]: {
          id: PlayerId.P1, name: "P1",
          deck: [], hand: [lopunnyCard], active: buneary, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
        [PlayerId.P2]: {
          id: PlayerId.P2, name: "P2",
          deck: [], hand: [], active: opp, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
      },
      stadium: null, stadiumOwnerId: null,
      definitions: {
        "Buneary": bunearyDef,
        "Mega Lopunny ex": lopunnyDef,
        "opp": mockBasic("Opp"),
      },
      log: [], actionLog: [], winnerId: null, rngSeed: 42,
      turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null, pendingAction: null,
      heldCard: null, itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    const after = gameReducer(state, {
      type: "EVOLVE",
      playerId: PlayerId.P1,
      evolutionId: lopunnyCard.instanceId,
      targetId: buneary.instanceId,
    });

    const p1 = getPlayer(after, PlayerId.P1);
    // Evolution now succeeds — Mega Lopunny ex replaces Buneary
    expect(p1.active?.instanceId).toBe(lopunnyCard.instanceId);
    expect(p1.active?.enteredPlayTurn).toBe(2);
  });
});
