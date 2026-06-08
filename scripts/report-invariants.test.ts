import { describe, it } from "vitest";
import { ALL_TOURNAMENTS } from "../src/lib/deck/tournamentPresets";
import { capturePresetSimulation } from "../src/lib/deck/simulationCapture";
import { checkMatchInvariants, type Violation } from "../src/lib/deck/invariants";

/**
 * On-demand deep invariant sweep — run with `npm run report:invariants`.
 *
 * Excluded from the default vitest run (see vitest.config.ts). Plays the full
 * preset matrix at high N to surface rare, seed-dependent invariant violations
 * that the CI gate's small N=3 subset misses. Prints a grouped summary with one
 * reproduction (matchup + seed + turn) per violation kind, then a per-game
 * crash count. This is a triage report — it does not fail the build.
 */

const N = Number(process.env.INVARIANT_SEEDS ?? 10);

describe("deep invariant sweep", () => {
  // Long-running on-demand sweep (minutes). Override breadth with
  // INVARIANT_SEEDS=N. Generous timeout so it isn't killed at the default 5s.
  it(`plays the full preset matrix at N=${N} and reports violations`, () => {
    // Count DISTINCT affected games per kind (not per-frame occurrences — a
    // single stuck Pokémon would otherwise inflate the count across frames).
    interface Agg { kind: string; severity: Violation["severity"]; gameKeys: Set<string>; firstRepro: string }
    const agg = new Map<string, Agg>();
    let games = 0;
    let crashes = 0;

    const record = (kind: string, severity: Violation["severity"], gameKey: string, repro: string) => {
      const a = agg.get(kind) ?? { kind, severity, gameKeys: new Set<string>(), firstRepro: repro };
      a.gameKeys.add(gameKey);
      agg.set(kind, a);
    };

    for (const tournament of ALL_TOURNAMENTS) {
      const decks = tournament.decks;
      for (let i = 0; i < decks.length; i++) {
        for (let j = i; j < decks.length; j++) {
          for (let seed = 1; seed <= N; seed++) {
            games++;
            const gameKey = `${decks[i]!.label}|${decks[j]!.label}|${seed}`;
            let frames;
            try {
              frames = capturePresetSimulation(decks[i]!, decks[j]!, { seed, maxTurns: 40, maxActions: 320 });
            } catch (err) {
              crashes++;
              record(`crash:${(err as Error)?.message?.slice(0, 60) ?? "unknown"}`, "hard", gameKey, `${decks[i]!.label} vs ${decks[j]!.label} seed=${seed}`);
              continue;
            }
            const seenKinds = new Set<string>();
            for (const x of checkMatchInvariants(frames)) {
              record(x.kind, x.severity, gameKey, `${decks[i]!.label} vs ${decks[j]!.label} seed=${seed} turn=${x.turnNumber}: ${x.detail}`);
              seenKinds.add(x.kind);
            }
            void seenKinds;
          }
        }
      }
    }

    const rows = [...agg.values()].sort((a, b) => (a.severity === b.severity ? b.gameKeys.size - a.gameKeys.size : a.severity === "hard" ? -1 : 1));
    console.log(`\n=== Deep invariant sweep: ${games} games (N=${N} seeds), ${crashes} crashes ===`);
    if (rows.length === 0) {
      console.log("No violations. ✅");
    } else {
      for (const r of rows) {
        console.log(`[${r.severity.toUpperCase()}] ${r.kind} — ${r.gameKeys.size}/${games} games`);
        console.log(`    e.g. ${r.firstRepro}`);
      }
    }
    const hardGames = rows.filter((r) => r.severity === "hard").reduce((s, r) => s + r.gameKeys.size, 0);
    console.log(`\nGames with a HARD violation: ${hardGames}/${games} (these indicate real bugs)`);
  }, 1_800_000);
});
