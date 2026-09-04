import { useCallback, useState } from "react";
import {
  ALL_TOURNAMENTS,
  type TournamentDeckPreset,
  type TournamentPresetBundle,
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
type DeckCountOption = "4" | "8" | "all";

function decksForRun(tournament: TournamentPresetBundle, count: DeckCountOption): TournamentDeckPreset[] {
  if (count === "all") return tournament.decks;
  const n = count === "4" ? 4 : 8;
  return tournament.decks.slice(0, Math.min(n, tournament.decks.length));
}

export function AnalysisLab() {
  const [tab, setTab] = useState<AnalysisTab>("watch");
  const [tournamentId, setTournamentId] = useState(String(ALL_TOURNAMENTS[0]!.tournamentId));
  const [deckCount, setDeckCount] = useState<DeckCountOption>("4");
  const [seedCount, setSeedCount] = useState(3);
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [matrixReport, setMatrixReport] = useState<string | null>(null);

  const selectedTournament =
    ALL_TOURNAMENTS.find((t) => String(t.tournamentId) === tournamentId) ?? ALL_TOURNAMENTS[0]!;

  const runMatrix = useCallback(async () => {
    setMatrixRunning(true);
    setMatrixReport(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const presets = decksForRun(selectedTournament, deckCount);
      const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
      const matchups = runPresetMatrix(presets, {
        seeds,
        setup: DEFAULT_PLAYTEST_SETUP,
        run: { ...DEFAULT_PLAYTEST_RUN, maxTurns: 30, maxActions: 240 },
      });
      const health = summarizeSimHealth(matchups);
      const tiers = computeDeckTierList(presets, health.matchups);
      const lines = [
        `# ${selectedTournament.name} — ${presets.length}-deck matrix (${seedCount} seeds)`,
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
  }, [deckCount, seedCount, selectedTournament]);

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
            Cross-play tournament decks with configurable deck count and seeds. For full CI meta reports
            use <code>npm run report:cri-meta</code>.
          </p>
          <div className="matrix-runner__controls">
            <label className="matrix-runner__field">
              Tournament
              <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
                {ALL_TOURNAMENTS.map((t) => (
                  <option key={t.tournamentId} value={String(t.tournamentId)}>
                    {t.name} ({t.decks.length} decks)
                  </option>
                ))}
              </select>
            </label>
            <label className="matrix-runner__field">
              Decks
              <select value={deckCount} onChange={(e) => setDeckCount(e.target.value as DeckCountOption)}>
                <option value="4">Top 4</option>
                <option value="8">Top 8</option>
                <option value="all">All ({selectedTournament.decks.length})</option>
              </select>
            </label>
            <label className="matrix-runner__field">
              Seeds
              <select value={seedCount} onChange={(e) => setSeedCount(Number(e.target.value))}>
                {[1, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" disabled={matrixRunning} onClick={() => void runMatrix()}>
            {matrixRunning ? "Running…" : "Run matrix"}
          </button>
          {matrixReport && <pre className="matrix-runner__report">{matrixReport}</pre>}
        </section>
      )}
    </div>
  );
}
