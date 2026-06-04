import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoTrainerAction } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

/**
 * Honchkrow (Team Rocket) deck: on turn 1 going first, Team Rocket's Proton —
 * the one Supporter playable on the first turn — should be the FIRST trainer
 * the AI plays (it fills the bench with 3 Basic TR Pokémon). It must out-rank
 * items like Team Rocket's Transceiver.
 */

function mockProton(): CardDefinition {
  return {
    apiId: "tr-proton",
    name: "Team Rocket's Proton", // isProtonSupporter matches this exact name
    supertype: "Trainer",
    subtypes: ["Supporter"],
    rules: ["If you go first, you may use this card during your first turn. Search your deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."],
    set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" },
  };
}
function mockTransceiver(): CardDefinition {
  return {
    apiId: "tr-transceiver",
    name: "Team Rocket's Transceiver",
    supertype: "Trainer",
    subtypes: ["Item"],
    set: { id: "t", name: "T" }, number: "2", images: { small: "", large: "" },
  };
}
function mockTrMon(name: string): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Pokémon", subtypes: ["Basic"], hp: "70", types: ["Darkness"],
    attacks: [], abilities: [],
    set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" },
  };
}

describe("Team Rocket's Proton — turn-1 priority", () => {
  it("AI plays Proton before Transceiver on turn 1 (going first)", () => {
    const proton = createCardInstance("tr-proton", PlayerId.P1, Zone.Hand);
    const transceiver = createCardInstance("tr-transceiver", PlayerId.P1, Zone.Hand);
    const active = createCardInstance("murkrow", PlayerId.P1, Zone.Active);
    const oppActive = createCardInstance("murkrow", PlayerId.P2, Zone.Active);

    const state: EngineState = {
      phase: GamePhase.Active,
      turnNumber: 1,
      currentPlayerId: PlayerId.P1,
      viewingPlayerId: PlayerId.P1,
      firstPlayerId: PlayerId.P1, // P1 goes first → Proton is legal this turn
      players: {
        [PlayerId.P1]: {
          id: PlayerId.P1, name: "P1",
          deck: [createCardInstance("murkrow", PlayerId.P1, Zone.Deck)],
          hand: [proton, transceiver], active, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
        [PlayerId.P2]: {
          id: PlayerId.P2, name: "P2", deck: [], hand: [], active: oppActive, bench: [],
          prizes: [], discard: [], lostZone: [],
        },
      },
      stadium: null, stadiumOwnerId: null,
      definitions: {
        "tr-proton": mockProton(),
        "tr-transceiver": mockTransceiver(),
        "murkrow": mockTrMon("Team Rocket's Murkrow"),
      },
      log: [], actionLog: [], winnerId: null, rngSeed: 1,
      turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    const ctx = buildStrategyContext(["Team Rocket's Murkrow", "Team Rocket's Honchkrow"]);
    const picked = pickAutoTrainerAction(state, ctx);
    expect(picked).not.toBeNull();
    expect(picked!.instanceId).toBe(proton.instanceId);
  });
});
