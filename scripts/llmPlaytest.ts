/**
 * LLM-agent playtest harness. Runs AI-vs-AI games where each side is either the
 * deterministic heuristic policy or an LLM agent that reads card text to decide.
 *
 * Requires ANTHROPIC_API_KEY for any "llm" side. Costs tokens + is slow — run
 * with a SMALL number of seeds. Not part of CI.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/llmPlaytest.ts \
 *     --p1 llm --p2 heuristic --deck utrecht-2-hasan-kunukcu --opp utrecht-14-niklas-leitz --seeds 11,23
 *
 * Flags:
 *   --p1, --p2     "llm" | "heuristic"  (default: llm vs heuristic)
 *   --deck         P1 tournament deck id (default Dragapult)
 *   --opp          P2 tournament deck id (default Greninja)
 *   --seeds        comma-separated seeds (default "11")
 *   --maxTurns     turn cap (default 45)
 *   --maxCalls     LLM calls per game before heuristic fallback (default 80)
 */
import { getTournamentDeckById } from "../src/lib/deck/tournamentPresets";
import { buildPlaytestDeckFromCorpusText } from "../src/lib/deck/corpusDeckBuilder";
import { runPolicyMatchFromBuiltDecks } from "../src/lib/deck/policyMatch";
import { HeuristicPolicy, type TurnPolicy } from "../src/lib/deck/policy";
import { LlmPolicy } from "../src/lib/deck/llm/llmPolicy";
import { createCompleteFromEnv } from "../src/lib/deck/llm/clientAnthropic";
import { getPlayer } from "../src/lib/engine/types";
import { PlayerId } from "../src/lib/models/enums";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const p1Kind = arg("p1", "llm");
const p2Kind = arg("p2", "heuristic");
const p1DeckId = arg("deck", "utrecht-2-hasan-kunukcu"); // Dragapult
const p2DeckId = arg("opp", "utrecht-14-niklas-leitz"); // Greninja
const seeds = arg("seeds", "11").split(",").map((s) => parseInt(s.trim(), 10));
const maxTurns = parseInt(arg("maxTurns", "45"), 10);
const maxCalls = parseInt(arg("maxCalls", "80"), 10);

const STARTING_PRIZES = 6;

function makePolicy(kind: string, label: string): TurnPolicy {
  if (kind !== "llm") return new HeuristicPolicy();
  let complete;
  try {
    complete = createCompleteFromEnv();
  } catch (err) {
    console.warn(`  ${label}: ${(err as Error).message} → falling back to HEURISTIC`);
    return new HeuristicPolicy();
  }
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  console.log(`  ${label}: LLM agent (provider=${provider}, maxCalls=${maxCalls})`);
  return new LlmPolicy(complete, { maxCalls });
}

(async () => {
  const p1Preset = getTournamentDeckById(p1DeckId);
  const p2Preset = getTournamentDeckById(p2DeckId);
  if (!p1Preset || !p2Preset) {
    console.error("Unknown deck id(s):", p1DeckId, p2DeckId);
    process.exit(1);
  }
  const p1Deck = buildPlaytestDeckFromCorpusText(p1Preset.label, p1Preset.text);
  const p2Deck = buildPlaytestDeckFromCorpusText(p2Preset.label, p2Preset.text);

  console.log(`\n${p1Preset.deckName} (P1=${p1Kind}) vs ${p2Preset.deckName} (P2=${p2Kind})`);
  console.log(`Seeds: ${seeds.join(", ")} | maxTurns ${maxTurns}\n`);

  let p1Wins = 0, p2Wins = 0, draws = 0;

  for (const seed of seeds) {
    console.log(`--- seed ${seed} ---`);
    const p1 = makePolicy(p1Kind, "P1");
    const p2 = makePolicy(p2Kind, "P2");
    const transcript: string[] = [];
    const t0 = Date.now();
    const result = await runPolicyMatchFromBuiltDecks(
      { player1Name: p1Preset.player, player2Name: p2Preset.player, player1Deck: p1Deck, player2Deck: p2Deck, seed },
      p1, p2,
      { maxTurns, maxCalls, transcript },
    );
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const me = getPlayer(result.state, PlayerId.P1);
    const opp = getPlayer(result.state, PlayerId.P2);
    const margin = Math.abs(
      (STARTING_PRIZES - me.prizes.length) - (STARTING_PRIZES - opp.prizes.length),
    );
    const winner = result.winnerId === PlayerId.P1 ? "P1" : result.winnerId === PlayerId.P2 ? "P2" : "draw";
    if (result.winnerId === PlayerId.P1) p1Wins += 1;
    else if (result.winnerId === PlayerId.P2) p2Wins += 1;
    else draws += 1;
    console.log(`  → ${winner} | turns ${result.turnCount} | prize margin ${margin} | ${secs}s | stalled=${result.stalled}`);
    if (process.argv.includes("--full")) {
      console.log("  FULL TRANSCRIPT:");
      transcript.forEach((line, i) => console.log(`    ${(i + 1).toString().padStart(3)}. ${line}`));
      console.log("  FINAL LOG (last 12):");
      result.state.log.slice(-12).forEach((l) => console.log(`      · ${l}`));
      console.log(`  Final prizes — P1: ${me.prizes.length}, P2: ${opp.prizes.length}`);
    } else {
      console.log(`     last actions: ${transcript.slice(-6).join(" · ")}`);
    }
  }

  console.log(`\n=== ${p1Preset.deckName}(${p1Kind}) ${p1Wins} - ${p2Wins} ${p2Preset.deckName}(${p2Kind}) | draws ${draws} ===`);
})();
