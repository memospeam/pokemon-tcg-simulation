import { describe, expect, it } from "vitest";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import type { CardDefinition } from "../models/definition";
import { emptyTurnFlags, type EngineState } from "../engine/types";
import { capturePresetSimulation, type SimFrame } from "./simulationCapture";
import { TOURNAMENT_535_TOP16 } from "./tournamentPresets";
import {
  checkStateInvariants,
  checkTurnInvariants,
  checkMatchInvariants,
  countInstancesByOwner,
} from "./invariants";

// ─── Unit tests: the checker flags hand-crafted violations ──────────────────

function mon(name: string, hp = "120"): CardDefinition {
  return { apiId: name, name, supertype: "Pokémon", subtypes: ["Basic"], hp, types: ["Colorless"], attacks: [], abilities: [], set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" } };
}
function supporter(name: string): CardDefinition {
  return { apiId: name, name, supertype: "Trainer", subtypes: ["Supporter"], set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" } };
}

function baseState(p1: Partial<EngineState["players"][PlayerId.P1]>, defs: Record<string, CardDefinition>): EngineState {
  return {
    phase: GamePhase.Active, turnNumber: 3, currentPlayerId: PlayerId.P1, viewingPlayerId: PlayerId.P1, firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active: null, bench: [], prizes: [], discard: [], lostZone: [], ...p1 },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: createCardInstance("opp", PlayerId.P2, Zone.Active), bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null, definitions: { opp: mon("Opp"), ...defs }, log: [], actionLog: [], winnerId: null, rngSeed: 1, turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("checkStateInvariants", () => {
  it("flags a card that appears in two zones (duplicate instance)", () => {
    const card = createCardInstance("pika", PlayerId.P1, Zone.Hand);
    const state = baseState({ hand: [card], discard: [{ ...card, zone: Zone.Discard }] }, { pika: mon("Pikachu") });
    const kinds = checkStateInvariants(state).map((x) => x.kind);
    expect(kinds).toContain("duplicate-instance");
  });

  it("flags a zone-tag mismatch", () => {
    const card = createCardInstance("pika", PlayerId.P1, Zone.Hand); // tag says Hand…
    const state = baseState({ bench: [card] }, { pika: mon("Pikachu") }); // …but it's on the bench
    expect(checkStateInvariants(state).map((x) => x.kind)).toContain("zone-tag-mismatch");
  });

  it("flags a bench overflow (>5)", () => {
    const bench = Array.from({ length: 6 }, () => createCardInstance("pika", PlayerId.P1, Zone.Bench));
    const state = baseState({ active: createCardInstance("pika", PlayerId.P1, Zone.Active), bench }, { pika: mon("Pikachu") });
    expect(checkStateInvariants(state).map((x) => x.kind)).toContain("bench-overflow");
  });

  it("hard-flags a card-count INCREASE (cards created from nowhere)", () => {
    const a = createCardInstance("pika", PlayerId.P1, Zone.Hand);
    const state = baseState({ hand: [a] }, { pika: mon("Pikachu") });
    const start = { ...countInstancesByOwner(state) };
    start[PlayerId.P1] -= 1; // pretend we started with one fewer → now we have more
    const hit = checkStateInvariants(state, start).find((x) => x.kind === "card-count-increased");
    expect(hit?.severity).toBe("hard");
  });

  it("soft-flags a card-count DECREASE (evolution drops pre-evo stacks)", () => {
    const a = createCardInstance("pika", PlayerId.P1, Zone.Hand);
    const state = baseState({ hand: [a] }, { pika: mon("Pikachu") });
    const start = { ...countInstancesByOwner(state) };
    start[PlayerId.P1] += 1; // pretend we started with one more
    const hit = checkStateInvariants(state, start).find((x) => x.kind === "card-count-decreased");
    expect(hit?.severity).toBe("soft");
  });

  it("passes a clean state", () => {
    const state = baseState({ active: createCardInstance("pika", PlayerId.P1, Zone.Active) }, { pika: mon("Pikachu") });
    expect(checkStateInvariants(state, countInstancesByOwner(state))).toEqual([]);
  });
});

describe("checkTurnInvariants", () => {
  function frame(turnNumber: number, logDelta: string[], category: SimFrame["category"] = "trainer"): SimFrame {
    const st = baseState({}, { boss: supporter("Boss's Orders"), iono: supporter("Iono") });
    st.turnNumber = turnNumber;
    return { state: st, label: logDelta.at(-1) ?? "", category, logDelta };
  }

  it("flags two Supporters played in one turn (the reported bug)", () => {
    const frames = [frame(3, ["P1 played Boss's Orders."]), frame(3, ["P1 played Iono."])];
    expect(checkTurnInvariants(frames).map((x) => x.kind)).toContain("supporters-per-turn");
  });

  it("does not flag one Supporter per turn", () => {
    const frames = [frame(3, ["P1 played Boss's Orders."]), frame(5, ["P1 played Iono."])];
    expect(checkTurnInvariants(frames).filter((x) => x.kind === "supporters-per-turn")).toEqual([]);
  });
});

// ─── CI gate: real preset matchups must produce zero HARD violations ────────

describe("invariant gate over tournament preset matchups", () => {
  const decks = TOURNAMENT_535_TOP16.decks;
  // A representative spread of matchups (mirrors + cross), kept small for the
  // 30s budget; the full high-N sweep lives in scripts/report-invariants.test.ts.
  const matchups: [number, number][] = [
    [0, 1], [1, 7], [3, 10], [13, 15], [0, 0], [1, 1], [10, 10],
  ];
  const seeds = [11, 23, 37];

  it("no hard state/turn invariant violations across representative matchups", () => {
    const failures: string[] = [];
    for (const [i, j] of matchups) {
      const p1 = decks[i]!, p2 = decks[j]!;
      for (const seed of seeds) {
        const frames = capturePresetSimulation(p1, p2, { seed, maxTurns: 40, maxActions: 320 });
        const hard = checkMatchInvariants(frames).filter((x) => x.severity === "hard");
        for (const x of hard) {
          failures.push(`[${p1.label} vs ${p2.label} seed=${seed} turn=${x.turnNumber}] ${x.kind}: ${x.detail}`);
        }
      }
    }
    expect(failures, `\n${failures.slice(0, 25).join("\n")}`).toEqual([]);
  });
});
