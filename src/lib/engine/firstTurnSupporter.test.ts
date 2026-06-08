import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { getLegalActions } from "./reducer";
import { emptyTurnFlags, type EngineState } from "./types";

/**
 * Rule: the player who goes FIRST cannot use a Supporter on their first turn.
 * Exceptions are cards that explicitly say "If you go first, you may use this
 * card during your first turn" — Team Rocket's Proton and Carmine.
 * The second player has no such restriction on their first turn.
 */

function supporter(name: string): CardDefinition {
  return {
    apiId: name, name, supertype: "Trainer", subtypes: ["Supporter"],
    set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}
function item(name: string): CardDefinition {
  return {
    apiId: name, name, supertype: "Trainer", subtypes: ["Item"],
    set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}
function basic(name: string): CardDefinition {
  return {
    apiId: name, name, supertype: "Pokémon", subtypes: ["Basic"], hp: "70", types: ["Colorless"],
    attacks: [], abilities: [], set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}

function stateWith(turnNumber: number, current: PlayerId, first: PlayerId, hand: ReturnType<typeof createCardInstance>[], defs: Record<string, CardDefinition>): EngineState {
  const mkActive = (p: PlayerId) => createCardInstance("murkrow", p, Zone.Active);
  // Both players get a benched Pokémon so target-requiring Supporters (e.g.
  // Boss's Orders, which switches in an opponent's Benched Pokémon) ARE legal —
  // otherwise they'd be filtered for lack of a target, masking the T1 rule.
  const mkBench = (p: PlayerId) => [createCardInstance("murkrow", p, Zone.Bench)];
  return {
    phase: GamePhase.Active, turnNumber, currentPlayerId: current, viewingPlayerId: current, firstPlayerId: first,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [createCardInstance("murkrow", PlayerId.P1, Zone.Deck)], hand: current === PlayerId.P1 ? hand : [], active: mkActive(PlayerId.P1), bench: mkBench(PlayerId.P1), prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [createCardInstance("murkrow", PlayerId.P2, Zone.Deck)], hand: current === PlayerId.P2 ? hand : [], active: mkActive(PlayerId.P2), bench: mkBench(PlayerId.P2), prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { murkrow: basic("Murkrow"), ...defs },
    log: [], actionLog: [], winnerId: null, rngSeed: 1, turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

function legalTrainerNames(state: EngineState): string[] {
  return getLegalActions(state)
    .filter((a) => a.type === "PLAY_TRAINER")
    .map((a) => state.definitions[
      [...Object.values(state.players)].flatMap((p) => p.hand).find((c) => c.instanceId === (a as { instanceId: string }).instanceId)?.definitionId ?? ""
    ]?.name ?? "");
}

describe("first-player turn-1 Supporter rule", () => {
  const defs = {
    boss: supporter("Boss's Orders"),
    proton: supporter("Team Rocket's Proton"),
    carmine: supporter("Carmine"),
    ub: item("Ultra Ball"),
  };
  const hand = (p: PlayerId) => [
    createCardInstance("boss", p, Zone.Hand),
    createCardInstance("proton", p, Zone.Hand),
    createCardInstance("carmine", p, Zone.Hand),
    createCardInstance("ub", p, Zone.Hand),
  ];

  it("first player turn 1: regular Supporter blocked; Proton/Carmine/Item allowed", () => {
    const names = legalTrainerNames(stateWith(1, PlayerId.P1, PlayerId.P1, hand(PlayerId.P1), defs));
    expect(names).not.toContain("Boss's Orders"); // blocked going first T1
    expect(names).toContain("Team Rocket's Proton"); // explicit go-first clause
    expect(names).toContain("Carmine"); // explicit go-first clause
    expect(names).toContain("Ultra Ball"); // items are always fine
  });

  it("second player's first turn (turn 2): regular Supporter is allowed", () => {
    const names = legalTrainerNames(stateWith(2, PlayerId.P2, PlayerId.P1, hand(PlayerId.P2), defs));
    expect(names).toContain("Boss's Orders");
  });

  it("first player's SECOND turn (turn 3): regular Supporter is allowed", () => {
    const names = legalTrainerNames(stateWith(3, PlayerId.P1, PlayerId.P1, hand(PlayerId.P1), defs));
    expect(names).toContain("Boss's Orders");
  });
});
