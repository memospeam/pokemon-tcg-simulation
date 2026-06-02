import { describe, expect, it, vi } from "vitest";
import { getTournamentDeckById } from "../tournamentPresets";
import { buildPlaytestDeckFromCorpusText } from "../corpusDeckBuilder";
import { beginMatchFromBuiltDecks, autoSetupEngineState } from "../metaGameRunner";
import { buildStrategyContext } from "../deckStrategy";
import { getDefinition, getPlayer } from "../../engine/types";
import { enumerateMainPhaseActions } from "./observation";
import { LlmPolicy } from "./llmPolicy";
import type { CompleteFn } from "./client";

const DRAGAPULT = "utrecht-2-hasan-kunukcu";

function setupState(seed = 11) {
  const preset = getTournamentDeckById(DRAGAPULT)!;
  const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
  let state = beginMatchFromBuiltDecks({
    player1Name: "A", player2Name: "B",
    player1Deck: deck, player2Deck: deck, seed,
  });
  state = autoSetupEngineState(state, { placeBenchBasics: true, maxMulligans: 40 });
  return state;
}

function ctxFor(state: ReturnType<typeof setupState>, playerId: ReturnType<typeof getPlayer>["id"]) {
  const p = getPlayer(state, playerId);
  return buildStrategyContext(
    [...p.deck, ...p.hand, ...(p.active ? [p.active] : []), ...p.bench]
      .map((c) => getDefinition(state, c.definitionId)?.name ?? ""),
  );
}

describe("LlmPolicy", () => {
  it("applies the action the model selects (mocked completion)", async () => {
    const state = setupState();
    const pid = state.currentPlayerId;
    const candidates = enumerateMainPhaseActions(state, pid);
    // Model picks candidate #1 (the first real action).
    const complete: CompleteFn = vi.fn(async () => "1");
    const policy = new LlmPolicy(complete, { maxCalls: 80 });

    const action = await policy.decide(state, pid, ctxFor(state, pid));
    expect(complete).toHaveBeenCalledOnce();
    // candidate[0] is the first action; if it's END_TURN, decide() returns null.
    const expected = candidates[0]!.action;
    if (expected.type === "END_TURN") expect(action).toBeNull();
    else expect(action).toEqual(expected);
  });

  it("falls back to the heuristic when the model reply is garbage", async () => {
    const state = setupState();
    const pid = state.currentPlayerId;
    const fallbackReasons: string[] = [];
    const complete: CompleteFn = vi.fn(async () => "I have no idea what to do");
    const policy = new LlmPolicy(complete, { onFallback: (r) => fallbackReasons.push(r) });

    const action = await policy.decide(state, pid, ctxFor(state, pid));
    expect(fallbackReasons).toContain("parse-fail");
    // Heuristic returns a concrete action or null — either way, no throw.
    expect(action === null || typeof action.type === "string").toBe(true);
  });

  it("falls back (not throws) when the client errors", async () => {
    const state = setupState();
    const pid = state.currentPlayerId;
    const reasons: string[] = [];
    const complete: CompleteFn = vi.fn(async () => { throw new Error("network down"); });
    const policy = new LlmPolicy(complete, { onFallback: (r) => reasons.push(r) });

    await expect(policy.decide(state, pid, ctxFor(state, pid))).resolves.not.toThrow();
    expect(reasons.some((r) => r.startsWith("error:"))).toBe(true);
  });

  it("respects the call cap, then falls back without calling the model", async () => {
    const state = setupState();
    const pid = state.currentPlayerId;
    const reasons: string[] = [];
    const complete: CompleteFn = vi.fn(async () => "1");
    const policy = new LlmPolicy(complete, { maxCalls: 0, onFallback: (r) => reasons.push(r) });

    await policy.decide(state, pid, ctxFor(state, pid));
    expect(complete).not.toHaveBeenCalled();
    expect(reasons).toContain("call-cap");
  });
});
