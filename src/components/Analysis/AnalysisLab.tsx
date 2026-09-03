import { useCallback, useState } from "react";
import {
  ALL_TOURNAMENTS,
  type TournamentDeckPreset,
} from "@/lib/deck/tournamentPresets";
import {
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  runPresetMatrix,
  summarizeSimHealth,
  computeDeckTierList,
} from "@/lib/deck/playtestRunner";
import { SimPlayback } from "@/components/SimPlayback/SimPlayback";

type AnalysisTab = "watch" | "matrix";

export function AnalysisLab() {
  const [tab, setTab] = useState<AnalysisTab>("watch");
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [matrixReport, setMatrixReport] = useState<string | null>(null);

  const runMatrix = useCallback(async () => {
    setMatrixRunning(true);
    setMatrixReport(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const tournament = ALL_TOURNAMENTS[0]!;
      const presets = tournament.decks.slice(0, 4) as TournamentDeckPreset[];
      const matchups = runPresetMatrix(presets, {
        seeds: [1, 2, 3],
        setup: DEFAULT_PLAYTEST_SETUP,
        run: { ...DEFAULT_PLAYTEST_RUN, maxTurns: 30, maxActions: 240 },
      });
      const health = summarizeSimHealth(matchups);
      const tiers = computeDeckTierList(presets, health.matchups);
      const lines = [
        `# ${tournament.name} — mini matrix (top 4 decks × 3 seeds)`,
        "",
        `Games: ${health.totalGames} · Completion: ${Math.round(health.completionRate * 100)}% · Stalls: ${Math.round(health.stallRate * 100)}%`,
        "",
        "## Tier list",
        ...tiers.map(
          (row) =>
            `- ${row.deckName}: ${Math.round(row.winRate * 100)}% (${row.wins}-${row.losses}-${row.draws})`,
        ),
        "",
        "## Matchups",
        ...health.matchups.map(
          (m) =>
            `- ${m.p1DeckName} vs ${m.p2DeckName}: ${Math.round(m.p1WinRate * 100)}% / ${Math.round(m.p2WinRate * 100)}% · avg ${m.avgTurnCount.toFixed(1)} turns`,
        ),
      ];
      setMatrixReport(lines.join("\n"));
    } finally {
      setMatrixRunning(false);
    }
  }, []);

  return (
    <div className="analysis-lab">
      <header className="analysis-lab__header panel">
        <div>
          <h2>Analysis Lab</h2>
          <p>Watch AI vs AI matches or run batch meta simulations.</p>
        </div>
        <nav className="analysis-lab__tabs" aria-label="Analysis mode">
          <button
            type="button"
            className={tab === "watch" ? "tabs__button tabs__button--active" : "tabs__button"}
            onClick={() => setTab("watch")}
          >
            Watch match
          </button>
          <button
            type="button"
            className={tab === "matrix" ? "tabs__button tabs__button--active" : "tabs__button"}
            onClick={() => setTab("matrix")}
          >
            Batch matrix
          </button>
        </nav>
      </header>

      {tab === "watch" && <SimPlayback embedded />}

      {tab === "matrix" && (
        <section className="panel matrix-runner">
          <p>
            Runs a quick 4-deck cross matrix from the latest tournament preset (3 seeds each).
            For full meta reports use <code>npm run report:cri-meta</code> in CI.
          </p>
          <button type="button" disabled={matrixRunning} onClick={() => void runMatrix()}>
            {matrixRunning ? "Running…" : "Run mini matrix"}
          </button>
          {matrixReport && <pre className="matrix-runner__report">{matrixReport}</pre>}
        </section>
      )}
    </div>
  );
}
