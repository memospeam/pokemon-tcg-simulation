import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { TOURNAMENT_535_TOP16 } from "../src/lib/deck/tournamentPresets";
import { capturePresetPolicySimulation } from "../src/lib/deck/simulationCapture";
import { checkMatchInvariants, type Violation } from "../src/lib/deck/invariants";
import { createOpenAICompatibleComplete } from "../src/lib/deck/llm/client";
import { LlmPolicy } from "../src/lib/deck/llm/llmPolicy";
import { getPlayer } from "../src/lib/engine/types";

/**
 * LLM-vs-LLM invariant bug scan — always Groq 70B.
 *
 *   GROQ_API_KEY=gsk_… npm run report:llm-invariants
 *
 * Drives full AI-vs-AI games where BOTH players are an LLM (Groq
 * llama-3.3-70b-versatile by default), then runs the state-invariant checker
 * over the captured frames to surface engine bugs reachable by the LLM's
 * (different-from-heuristic) action sequences. Excluded from the default vitest
 * run (see vitest.config.ts). Triage report — does not fail the build.
 *
 * Tunables:  GROQ_MODEL (default llama-3.3-70b-versatile),
 *            LLM_GAMES   (matchups to play, default 6),
 *            LLM_SEED    (base seed, default 1).
 */
/** Read GROQ_API_KEY from the process env, falling back to .env.local (vitest
 *  doesn't reliably inject non-VITE_ vars into process.env). */
function loadGroqKey(): string | undefined {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    return env.match(/^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}
const KEY = loadGroqKey();
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const GAMES = Number(process.env.LLM_GAMES ?? 6);
const BASE_SEED = Number(process.env.LLM_SEED ?? 1);
// Groq's free tier is token-rate-limited (~6k TPM) and the observation prompt
// carries full card text, so a full LLM-driven game can take ~90 min. Cap the
// LLM to the opening (heuristic finishes) to stay within budget; raise on a
// paid tier. LLM_MAXCALLS = LLM decisions per player before heuristic takeover.
const MAXCALLS = Number(process.env.LLM_MAXCALLS ?? 100000);
const MAXTURNS = Number(process.env.LLM_MAXTURNS ?? 30);
const MAXACTIONS = Number(process.env.LLM_MAXACTIONS ?? 280);

// A rotating spread of matchups (cross + a mirror), sliced to GAMES.
const MATCHUPS: [number, number][] = [
  [1, 7], [10, 0], [3, 15], [11, 4], [13, 14], [8, 1], [2, 2], [0, 10],
];

describe("LLM-vs-LLM invariant scan (Groq 70B)", () => {
  it(`plays ${GAMES} Groq-70B games and reports invariant violations`, async () => {
    if (!KEY) {
      console.log("\n⚠️  GROQ_API_KEY not set — skipping.\n    Run with:  GROQ_API_KEY=gsk_… npm run report:llm-invariants\n");
      return;
    }
    const complete = createOpenAICompatibleComplete({
      baseUrl: "https://api.groq.com/openai/v1",
      model: MODEL,
      apiKey: KEY,
      timeoutMs: 60000,
    });
    const decks = TOURNAMENT_535_TOP16.decks;

    interface Agg { kind: string; severity: Violation["severity"]; games: Set<string>; firstRepro: string }
    const agg = new Map<string, Agg>();
    let totalFallbacks = 0;

    console.log(`\n=== LLM-vs-LLM invariant scan — model=${MODEL}, ${GAMES} games ===`);
    for (let g = 0; g < GAMES; g++) {
      const [i, j] = MATCHUPS[g % MATCHUPS.length]!;
      const p1 = decks[i]!, p2 = decks[j]!;
      const seed = BASE_SEED + g;
      let fb = 0;
      const mk = () => new LlmPolicy(complete, { maxCalls: MAXCALLS, onFallback: () => { fb++; } });
      const t0 = Date.now();
      const frames = await capturePresetPolicySimulation(p1, p2, mk(), mk(), { seed, maxTurns: MAXTURNS, maxActions: MAXACTIONS });
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      totalFallbacks += fb;
      const last = frames.at(-1)!.state;
      const winner = last.winnerId ? getPlayer(last, last.winnerId).name : "stall/draw";
      const violations = checkMatchInvariants(frames);
      const hard = violations.filter((x) => x.severity === "hard");
      const gameKey = `${p1.label}|${p2.label}|${seed}`;
      for (const x of violations) {
        const a = agg.get(x.kind) ?? { kind: x.kind, severity: x.severity, games: new Set<string>(), firstRepro: `${p1.label} vs ${p2.label} seed=${seed} turn=${x.turnNumber}: ${x.detail}` };
        a.games.add(gameKey);
        agg.set(x.kind, a);
      }
      console.log(`  [${g + 1}/${GAMES}] ${p1.label} vs ${p2.label} (seed ${seed}) — turns=${last.turnNumber} winner=${winner} | ${secs}s | LLM-fallbacks=${fb} | HARD=${hard.length}`);
      for (const x of hard.slice(0, 6)) console.log(`        [HARD] t${x.turnNumber} ${x.kind}: ${x.detail}`);
    }

    const rows = [...agg.values()].sort((a, b) => (a.severity === b.severity ? b.games.size - a.games.size : a.severity === "hard" ? -1 : 1));
    console.log(`\n=== Summary (${GAMES} games, ${totalFallbacks} total LLM fallbacks) ===`);
    if (rows.length === 0) console.log("No violations. ✅");
    for (const r of rows) {
      console.log(`[${r.severity.toUpperCase()}] ${r.kind} — ${r.games.size}/${GAMES} games`);
      console.log(`    e.g. ${r.firstRepro}`);
    }
    const hardGames = rows.filter((r) => r.severity === "hard").reduce((s, r) => s + r.games.size, 0);
    console.log(`\nGames with a HARD violation: ${hardGames}/${GAMES} (these indicate real bugs)`);
  }, 1_800_000);
});
