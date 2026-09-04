import { useCallback, useMemo, useRef, useState } from "react";
import {
  ALL_TOURNAMENTS,
  dedupeDecksByName,
  getWorlds2026Decks,
  type TournamentDeckPreset,
  type TournamentPresetBundle,
} from "@/lib/deck/tournamentPresets";
import { getMetaArchetypeDecks } from "@/lib/deck/metaArchetypes";
import {
  CI_BATCH_SEEDS,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  defaultBatchSeeds,
  runPresetMatrixAsync,
  summarizeSimHealth,
  computeDeckTierList,
  type DeckTierEntry,
  type MatchupStats,
  type SimHealthSummary,
} from "@/lib/deck/playtestRunner";
import { SimPlayback } from "@/components/SimPlayback/SimPlayback";
import { MatrixGrid } from "./MatrixGrid";
import { MatrixReport } from "./MatrixReport";
import { buildMatrixCsv, downloadTextFile } from "@/lib/deck/matrixCsv";

type AnalysisTab = "watch" | "matrix";
type MatrixSource = "meta11" | "worlds26" | "tournament";
type DeckCountOption = "4" | "8" | "all";
type PresetSeedMode = "ci" | "quick" | "extended";

function seedsForPreset(mode: PresetSeedMode): number[] {
  if (mode === "ci") return [...CI_BATCH_SEEDS];
  if (mode === "quick") return [1, 2, 3, 4, 5];
  return defaultBatchSeeds(10);
}

function decksForRun(tournament: TournamentPresetBundle, count: DeckCountOption): TournamentDeckPreset[] {
  if (count === "all") return tournament.decks;
  const n = count === "4" ? 4 : 8;
  return tournament.decks.slice(0, Math.min(n, tournament.decks.length));
}

function matrixSizeLabel(source: MatrixSource, presetCount: number): string {
  if (source === "meta11") return "11×11";
  return `${presetCount}×${presetCount}`;
}

function resolveMatrixPresets(
  source: MatrixSource,
  options: {
    metaDecks: TournamentDeckPreset[];
    worldsDecks: TournamentDeckPreset[];
    tournament: TournamentPresetBundle;
    deckCount: DeckCountOption;
    dedupeArchetypes: boolean;
  },
): TournamentDeckPreset[] {
  const raw =
    source === "meta11"
      ? options.metaDecks
      : source === "worlds26"
        ? options.worldsDecks
        : decksForRun(options.tournament, options.deckCount);
  return options.dedupeArchetypes ? dedupeDecksByName(raw) : raw;
}

export function AnalysisLab() {
  const [tab, setTab] = useState<AnalysisTab>("watch");
  const [matrixSource, setMatrixSource] = useState<MatrixSource>("meta11");
  const [tournamentId, setTournamentId] = useState(String(ALL_TOURNAMENTS[0]!.tournamentId));
  const [deckCount, setDeckCount] = useState<DeckCountOption>("4");
  const [seedCount, setSeedCount] = useState(3);
  const [presetSeedMode, setPresetSeedMode] = useState<PresetSeedMode>("ci");
  const [dedupeArchetypes, setDedupeArchetypes] = useState(true);
  const [matrixRunning, setMatrixRunning] = useState(false);
  const [matrixProgress, setMatrixProgress] = useState<{ done: number; total: number; currentLabel: string } | null>(null);
  const matrixAbortRef = useRef<AbortController | null>(null);
  const [matrixSummary, setMatrixSummary] = useState<{
    title: string;
    seedCount: number;
    health: SimHealthSummary;
    tiers: DeckTierEntry[];
  } | null>(null);
  const [matrixCancelled, setMatrixCancelled] = useState(false);
  const [matrixMatchups, setMatrixMatchups] = useState<MatchupStats[] | null>(null);
  const [matrixPresets, setMatrixPresets] = useState<TournamentDeckPreset[] | null>(null);
  const [matrixTiers, setMatrixTiers] = useState<ReturnType<typeof computeDeckTierList> | null>(null);

  const selectedTournament =
    ALL_TOURNAMENTS.find((t) => String(t.tournamentId) === tournamentId) ?? ALL_TOURNAMENTS[0]!;

  const worldsDecks = useMemo(() => getWorlds2026Decks(), []);
  const metaDecks = useMemo(() => getMetaArchetypeDecks(), []);

  const runMatrix = useCallback(async () => {
    matrixAbortRef.current?.abort();
    const controller = new AbortController();
    matrixAbortRef.current = controller;

    setMatrixRunning(true);
    setMatrixProgress(null);
    setMatrixSummary(null);
    setMatrixCancelled(false);
    setMatrixMatchups(null);
    setMatrixPresets(null);
    setMatrixTiers(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const presets = resolveMatrixPresets(matrixSource, {
        metaDecks,
        worldsDecks,
        tournament: selectedTournament,
        deckCount,
        dedupeArchetypes,
      });
      const seeds =
        matrixSource === "meta11" || matrixSource === "worlds26"
          ? seedsForPreset(presetSeedMode)
          : Array.from({ length: seedCount }, (_, i) => i + 1);
      const matchups = await runPresetMatrixAsync(
        presets,
        {
          seeds,
          setup: DEFAULT_PLAYTEST_SETUP,
          run: { ...DEFAULT_PLAYTEST_RUN, maxTurns: 30, maxActions: 240 },
        },
        (progress) => setMatrixProgress(progress),
        controller.signal,
      );
      const health = summarizeSimHealth(matchups);
      const tiers = computeDeckTierList(presets, health.matchups);
      const title =
        matrixSource === "meta11"
          ? "Standard meta — 11 archetypes (Utrecht)"
          : matrixSource === "worlds26"
            ? "World Championships 2026 — Top 8"
            : `${selectedTournament.name} — ${presets.length}-deck matrix`;
      setMatrixSummary({ title, seedCount: seeds.length, health, tiers });
      setMatrixMatchups(health.matchups);
      setMatrixPresets(presets);
      setMatrixTiers(tiers);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMatrixCancelled(true);
      } else {
        throw error;
      }
    } finally {
      setMatrixRunning(false);
      setMatrixProgress(null);
      matrixAbortRef.current = null;
    }
  }, [deckCount, dedupeArchetypes, matrixSource, metaDecks, presetSeedMode, seedCount, selectedTournament, worldsDecks]);

  const cancelMatrix = useCallback(() => {
    matrixAbortRef.current?.abort();
  }, []);

  const presetCount = resolveMatrixPresets(matrixSource, {
    metaDecks,
    worldsDecks,
    tournament: selectedTournament,
    deckCount,
    dedupeArchetypes,
  }).length;

  function exportMatrixCsv() {
    if (!matrixPresets || !matrixMatchups || !matrixTiers) return;
    const slug =
      matrixSource === "meta11"
        ? "meta11"
        : matrixSource === "worlds26"
          ? "worlds-2026"
          : `tournament-${tournamentId}`;
    const csv = buildMatrixCsv(matrixPresets, matrixMatchups, matrixTiers);
    downloadTextFile(`matrix-${slug}.csv`, csv);
  }

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
            Run cross-play simulations and view a {matrixSizeLabel(matrixSource, presetCount)} win-rate grid.
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
                <option value="worlds26">Worlds 2026 Top 8</option>
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
            {(matrixSource === "meta11" || matrixSource === "worlds26") && (
              <>
                <label className="matrix-runner__field">
                  Seeds
                  <select
                    value={presetSeedMode}
                    onChange={(e) => setPresetSeedMode(e.target.value as PresetSeedMode)}
                  >
                    <option value="ci">CI ({CI_BATCH_SEEDS.join(", ")})</option>
                    <option value="quick">Quick (5 seeds)</option>
                    <option value="extended">Extended (10 seeds)</option>
                  </select>
                </label>
                <p className="matrix-runner__hint">
                  {matrixSource === "meta11"
                    ? `${metaDecks.length} Utrecht archetype reps`
                    : dedupeArchetypes
                      ? `${presetCount} unique archetypes (${worldsDecks.length} lists)`
                      : `${worldsDecks.length} Worlds 2026 Top 8 lists`}
                </p>
              </>
            )}
            {(matrixSource === "worlds26" || matrixSource === "tournament") && (
              <label className="matrix-runner__field matrix-runner__field--check">
                <span>Dedupe archetypes</span>
                <input
                  type="checkbox"
                  checked={dedupeArchetypes}
                  onChange={(e) => setDedupeArchetypes(e.target.checked)}
                />
              </label>
            )}
          </div>
          <div className="matrix-runner__actions">
            <button type="button" disabled={matrixRunning} onClick={() => void runMatrix()}>
              {matrixRunning
                ? "Running…"
                : matrixSource === "tournament"
                  ? "Run matrix"
                  : `Run ${matrixSizeLabel(matrixSource, presetCount)} matrix`}
            </button>
            {matrixRunning && (
              <button type="button" className="matrix-runner__cancel" onClick={cancelMatrix}>
                Cancel
              </button>
            )}
            {matrixMatchups && matrixPresets && matrixTiers && (
              <button type="button" className="matrix-runner__export" onClick={exportMatrixCsv}>
                Export CSV
              </button>
            )}
          </div>
          {matrixProgress && matrixRunning && (
            <div className="matrix-runner__progress" role="status" aria-live="polite">
              <div
                className="matrix-runner__progress-bar"
                style={{
                  width: `${matrixProgress.total > 0 ? Math.round((matrixProgress.done / matrixProgress.total) * 100) : 0}%`,
                }}
              />
              <span className="matrix-runner__progress-label">
                {matrixProgress.done}/{matrixProgress.total} — {matrixProgress.currentLabel}
              </span>
            </div>
          )}
          {matrixMatchups && matrixPresets && (
            <MatrixGrid presets={matrixPresets} matchups={matrixMatchups} />
          )}
          {matrixCancelled && <p className="matrix-runner__cancelled">Matrix run cancelled.</p>}
          {matrixSummary && (
            <MatrixReport
              title={matrixSummary.title}
              seedCount={matrixSummary.seedCount}
              health={matrixSummary.health}
              tiers={matrixSummary.tiers}
            />
          )}
        </section>
      )}
    </div>
  );
}
