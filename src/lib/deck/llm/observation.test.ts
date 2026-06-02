import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { emptyTurnFlags, type EngineState } from "../../engine/types";
import {
  buildObservation,
  cardEffectText,
  enumerateMainPhaseActions,
  parseActionChoice,
  type ActionCandidate,
} from "./observation";
import type { GameAction } from "../../engine/types";

function dragapultDef(): CardDefinition {
  return {
    apiId: "dragapult",
    name: "Dragapult ex",
    supertype: "Pokémon",
    subtypes: ["Stage 2"],
    hp: "320",
    types: ["Psychic"],
    abilities: [],
    attacks: [
      { name: "Jet Headbutt", cost: ["Colorless"], convertedEnergyCost: 1, damage: "70", text: "" },
      { name: "Phantom Dive", cost: ["Fire", "Psychic"], convertedEnergyCost: 2, damage: "200", text: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like." },
    ],
    set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" },
  };
}

function basicState(): EngineState {
  const dragapult = createCardInstance("dragapult", PlayerId.P1, Zone.Active);
  const opp = createCardInstance("opp", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active, turnNumber: 4,
    currentPlayerId: PlayerId.P1, viewingPlayerId: PlayerId.P1, firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active: dragapult, bench: [], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: opp, bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { dragapult: dragapultDef(), opp: { ...dragapultDef(), apiId: "opp", name: "Opp" } },
    log: [], actionLog: [], winnerId: null, rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("cardEffectText", () => {
  it("includes attack cost, damage, and rules text", () => {
    const txt = cardEffectText(dragapultDef());
    expect(txt).toContain("Phantom Dive");
    expect(txt).toContain("Fire/Psychic");
    expect(txt).toContain("200");
    expect(txt).toContain("damage counters"); // the actual card text is surfaced
  });
});

describe("buildObservation", () => {
  it("shows the active Pokémon with its effect text (card knowledge wired in)", () => {
    const obs = buildObservation(basicState(), PlayerId.P1);
    expect(obs).toContain("YOUR ACTIVE: Dragapult ex");
    expect(obs).toContain("Phantom Dive"); // effect text present for decision-making
    expect(obs).toContain("Prizes left");
    expect(obs).toContain("OPPONENT ACTIVE: Opp");
  });
});

describe("parseActionChoice", () => {
  const candidates: ActionCandidate[] = [
    { action: { type: "ATTACK", playerId: PlayerId.P1, attackName: "A" } as GameAction, label: "Attack A" },
    { action: { type: "ATTACK", playerId: PlayerId.P1, attackName: "B" } as GameAction, label: "Attack B" },
    { action: { type: "END_TURN" } as GameAction, label: "End turn" },
  ];

  it("maps a bare number to the 1-based candidate", () => {
    expect(parseActionChoice("2", candidates)).toEqual(candidates[1].action);
  });

  it("tolerates prose like 'ACTION: 3 because ...'", () => {
    expect(parseActionChoice("ACTION: 3 because it ends the turn", candidates)).toEqual(candidates[2].action);
  });

  it("returns null on out-of-range or non-numeric replies (caller falls back)", () => {
    expect(parseActionChoice("99", candidates)).toBeNull();
    expect(parseActionChoice("no idea", candidates)).toBeNull();
  });
});

describe("enumerateMainPhaseActions", () => {
  it("always appends END_TURN as the final candidate", () => {
    const cands = enumerateMainPhaseActions(basicState(), PlayerId.P1);
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands[cands.length - 1]!.action.type).toBe("END_TURN");
  });
});
