import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { canAffordRetreat, payRetreatCost } from "./energy";
import { emptyTurnFlags, getPlayer, type EngineState } from "./types";

/**
 * Regression: payRetreatCost must consume flex Psychic/Darkness energy (e.g.
 * Team Rocket's Energy, which provides flexPsychicDark: 2 on a Team Rocket
 * Pokémon) to pay a Colorless retreat slot.
 *
 * canPayCost already counts flexPsychicDark toward Colorless, so
 * canAffordRetreat returned true — but payRetreatCost's Colorless branch only
 * looked at rainbow + colors and returned false. The mismatch made the
 * affordable retreat a no-op, which the auto-play runner retried forever
 * until maxActions, drawing the game.
 */

function trPokemon(): CardDefinition {
  return {
    apiId: "tr-mon",
    name: "Team Rocket's Mightyena", // name includes "team rocket's" → TR Pokémon
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "120",
    types: ["Darkness"],
    attacks: [],
    retreatCost: ["Colorless"],
    convertedRetreatCost: 1,
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function trEnergy(): CardDefinition {
  return {
    apiId: "tr-energy",
    name: "Team Rocket's Energy",
    supertype: "Energy",
    subtypes: ["Special"],
    set: { id: "t", name: "T" },
    number: "2",
    images: { small: "", large: "" },
  };
}

function stateWith(active: ReturnType<typeof createCardInstance>, defs: Record<string, CardDefinition>): EngineState {
  const bench = createCardInstance("tr-mon", PlayerId.P1, Zone.Bench);
  return {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active, bench: [bench], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: createCardInstance("tr-mon", PlayerId.P2, Zone.Active), bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: defs,
    log: [], actionLog: [], winnerId: null, rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null,
    heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("payRetreatCost — flex Psychic/Darkness pays Colorless", () => {
  it("Team Rocket's Energy can pay a Colorless retreat cost (affordable AND payable)", () => {
    const active = createCardInstance("tr-mon", PlayerId.P1, Zone.Active);
    const energy = createCardInstance("tr-energy", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [energy];
    const state = stateWith(active, { "tr-mon": trPokemon(), "tr-energy": trEnergy() });
    const player = getPlayer(state, PlayerId.P1);

    // Affordability and payment must AGREE — both true.
    expect(canAffordRetreat(state, active)).toBe(true);
    expect(payRetreatCost(state, player, active)).toBe(true);
  });
});
