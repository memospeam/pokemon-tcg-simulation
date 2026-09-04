import { useCallback, useState } from "react";
import {
  ALL_TOURNAMENTS,
  type TournamentDeckPreset,
  type TournamentPresetBundle,
} from "@/lib/deck/tournamentPresets";
import { getMetaArchetypeDecks } from "@/lib/deck/metaArchetypes";
import {
  CI_BATCH_SEEDS,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  runPresetMatrix,
  summarizeSimHealth,
  computeDeckTierList,
  type MatchupStats,
} from "@/lib/deck/playtestRunner";
import { SimPlayback } from "@/components/SimPlayback/SimPlayback";
import { MatrixGrid } from "./MatrixGrid";

type AnalysisTab = "watch" | "matrix";
type MatrixSource = "tournament" | "meta11";
type DeckCountOption = "4" | "8" | "all";

function decksForRun(tournament: TournamentPresetBundle, count: DeckCountOption): TournamentDeckPreset[] {
  if (count === "all") return tournament.decks;
  const n = count === "4" ? 4 : 8;
  return tournament.decks.slice(0, Math.min(n, tournament.decks.length));
}

export function AnalysisLab() {
  const [tab, setTab] = useState<AnalysisTab>("watch");
  const [matrixSource, setMatrixSource] = useState<MatrixSource>("meta11");
  const [tournamentId, setTournamentId] = useState(String(ALL_TOURNAMENTS[0]!.tournamentId));
  const [deckCount, setDeckCount] = useState<DeckCountOption>("4");
  const [seedCount, setSeedCount] = useState(3);
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [matrixReport, setMatrixReport] = useState<string | null>(null);
  const [matrixMatchups, setMatrixMatchups] = useState<MatchupStats[] | null>(null);
  const [matrixPresets, setMatrixPresets] = useState<TournamentDeckPreset[] | null>(null);

  const selectedTournament =
    ALL_TOURNAMENTS.find((t) => String(t.tournamentId) === tournamentId) ?? ALL_TOURNAMENTS[0]!;

  const runMatrix = useCallback(async () => {
    setMatrixRunning(true);
    setMatrixReport(null);
    setMatrixMatchups(null);
    setMatrixPresets(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const presets =
        matrixSource === "meta11" ? getMetaArchetypeDecks() : decksForRun(selectedTournament, deckCount);
      const seeds =
        matrixSource === "meta11" ? CI_BATCH_SEEDS : Array.from({ length: seedCount }, (_, i) => i + 1);
      const matchups = runPresetMatrix(presets, {
        seeds,
        setup: DEFAULT_PLAYTEST_SETUP,
        run: { ...DEFAULT_PLAYTEST_RUN, maxTurns: 30, maxActions: 240 },
      });
      const health = summarizeSimHealth(matchups);
      const tiers = computeDeckTierList(presets, health.matchups);
      const title =
        matrixSource === "meta11"
          ? "Standard meta — 11 archetypes (Utrecht)"
          : `${selectedTournament.name} — ${presets.length}-deck matrix`;
      const lines = [
        `# ${title} (${seeds.length} seeds)`,
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
      setMatrixMatchups(health.matchups);
      setMatrixPresets(presets);
    } finally {
      setMatrixRunning(false);
    }
  }, [deckCount, matrixSource, seedCount, selectedTournament]);

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
            Run cross-play simulations and view an {matrixSource === "meta11" ? "11×11" : "N×N"} win-rate grid.
            For full CI meta reports use <code>npm run report:cri-meta</code>.
          </p>
          <div className="matrix-runner__controls">
            <label className="matrix-runner__field">
              Source
              <select
                value={matrixSource}
                onChange={(e) => setMatrixSource(e.target.value as MatrixSource)}
              >
                <option value="meta11">Standard meta (11 archetypes)</option>
                <option value="tournament">Tournament preset</option>
              </select>
            </label>
            {matrixSource === "tournament" && (
              <>
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
              </>
            )}
            {matrixSource === "meta11" && (
              <p className="matrix-runner__hint">
                Uses {getMetaArchetypeDecks().length} Utrecht Regional archetype reps · seeds{" "}
                {CI_BATCH_SEEDS.join(", ")}
              </p>
            )}
          </div>
          <button type="button" disabled={matrixRunning} onClick={() => void runMatrix()}>
            {matrixRunning ? "Running…" : matrixSource === "meta11" ? "Run 11×11 matrix" : "Run matrix"}
          </button>
          {matrixMatchups && matrixPresets && (
            <MatrixGrid presets={matrixPresets} matchups={matrixMatchups} />
          )}
          {matrixReport && <pre className="matrix-runner__report">{matrixReport}</pre>}
        </section>
      )}
    </div>
  );
}
