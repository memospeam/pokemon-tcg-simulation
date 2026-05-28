import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { gameReducer } from "./reducer";
import { emptyTurnFlags, getPlayer, type EngineState } from "./types";

/**
 * Regression: an attack that spawns a multi-pick CHOOSE_OPPONENT_DAMAGE
 * pending (e.g. Mirage Barrage — "deal 120 damage to 2 of your opponent's
 * Pokémon") previously failed to set turnFlags.attacked = true when the
 * final pick resolved. That left the engine in a state where the attacker
 * could keep attacking on the same turn, even though one attack per turn
 * is the rule.
 */

function mockBasic(
  apiId: string,
  name: string,
  hp: string,
  types: string[],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp,
    types,
    attacks,
    set: { id: "t", name: "t" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockEnergy(apiId: string): CardDefinition {
  return {
    apiId,
    name: "Water Energy",
    supertype: "Energy",
    subtypes: ["Basic"],
    types: ["Water"],
    set: { id: "t", name: "t" },
    number: "9",
    images: { small: "", large: "" },
  };
}

describe("multi-pick attack completion sets turnFlags.attacked", () => {
  it("after the last CHOOSE_OPPONENT_DAMAGE pick the turn is flagged as attacked", () => {
    const greninja = mockBasic("greninja", "Greninja ex", "330", ["Water"], [
      {
        name: "Mirage Barrage",
        cost: [],
        convertedEnergyCost: 0,
        damage: "",
        text:
          "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon.",
      },
    ]);

    const greninjaInstance = createCardInstance("greninja", PlayerId.P1, Zone.Active);
    const energies = Array.from({ length: 4 }, (_, i) => {
      const e = createCardInstance(`energy-${i}`, PlayerId.P1, Zone.Active);
      e.definitionId = "water";
      return e;
    });
    greninjaInstance.attachedEnergy = energies;

    const p2Active = createCardInstance("p2-active", PlayerId.P2, Zone.Active);
    const bench = [
      createCardInstance("p2-b0", PlayerId.P2, Zone.Bench),
      createCardInstance("p2-b1", PlayerId.P2, Zone.Bench),
    ];

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
          deck: [createCardInstance("dummy", PlayerId.P1, Zone.Deck)],
          hand: [],
          active: greninjaInstance,
          bench: [],
          prizes: Array.from({ length: 6 }, (_, i) =>
            createCardInstance(`p1-prize-${i}`, PlayerId.P1, Zone.Prizes),
          ),
          discard: [],
          lostZone: [],
        },
        [PlayerId.P2]: {
          id: PlayerId.P2,
          name: "P2",
          deck: [createCardInstance("dummy", PlayerId.P2, Zone.Deck)],
          hand: [],
          active: p2Active,
          bench,
          prizes: Array.from({ length: 6 }, (_, i) =>
            createCardInstance(`p2-prize-${i}`, PlayerId.P2, Zone.Prizes),
          ),
          discard: [],
          lostZone: [],
        },
      },
      stadium: null,
      stadiumOwnerId: null,
      definitions: {
        greninja,
        water: mockEnergy("water"),
        "p2-active": mockBasic("p2-active", "Defender", "330", ["Colorless"]),
        "p2-b0": mockBasic("p2-b0", "Bench A", "200", ["Colorless"]),
        "p2-b1": mockBasic("p2-b1", "Bench B", "200", ["Colorless"]),
        dummy: mockBasic("dummy", "Dummy", "60", ["Colorless"]),
      },
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

    let s = gameReducer(state, {
      type: "ATTACK",
      playerId: PlayerId.P1,
      attackName: "Mirage Barrage",
    });
    expect(s.pendingAction?.type).toBe("DAMAGE_TWO_OPPONENT");
    expect(s.turnFlags.attacked).toBe(false);

    // First pick — pending should remain
    s = gameReducer(s, {
      type: "CHOOSE_OPPONENT_DAMAGE",
      playerId: PlayerId.P1,
      targetId: bench[0].instanceId,
    });
    expect(s.pendingAction?.type).toBe("DAMAGE_TWO_OPPONENT");
    expect(s.turnFlags.attacked).toBe(false);

    // Second/last pick — pending clears and turn must be flagged attacked
    s = gameReducer(s, {
      type: "CHOOSE_OPPONENT_DAMAGE",
      playerId: PlayerId.P1,
      targetId: bench[1].instanceId,
    });
    // Once attacked = true, tryAutoEndTurnIfAttacked also ends the turn,
    // so currentPlayerId may have flipped to P2. Either way, P1 must NOT
    // be allowed to attack again. The cleanest invariant: turn has moved on.
    expect(s.currentPlayerId === PlayerId.P2 || s.turnFlags.attacked).toBe(true);
    // And only 2 energies remain on Greninja (Mirage Barrage discarded 2).
    const p1Active = getPlayer(s, PlayerId.P1).active;
    if (p1Active) {
      expect(p1Active.attachedEnergy.length).toBe(2);
    }
  });
});
