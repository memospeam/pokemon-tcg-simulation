import { useCallback, useState } from "react";
import { ALL_TOURNAMENTS, type TournamentDeckPreset } from "@/lib/deck/tournamentPresets";
import {
  getDeckStrategy,
  detectArchetype,
  STRATEGY_PROFILES,
  type Archetype,
  type StrategyProfile,
} from "@/lib/deck/deckStrategy";
import { buildPlaytestDeckFromCorpusText } from "@/lib/deck/corpusDeckBuilder";
import { runMatchFromBuiltDecks } from "@/lib/deck/metaGameRunner";
import { PlayerId } from "@/lib/models/enums";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MatchupResult {
  p1Id: string;
  p2Id: string;
  p1Name: string;
  p2Name: string;
  p1Archetype: Archetype;
  p2Archetype: Archetype;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  stalls: number;
  games: number;
  avgTurns: number;
}

const SEEDS = [1, 7, 13, 19, 31, 42, 55, 67, 80, 99];

// ─── Helper: run multiple seeds with strategy-aware AI ───────────────────────

function runMatchup(
  p1: TournamentDeckPreset,
  p2: TournamentDeckPreset,
  seeds: number[],
): MatchupResult {
  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  let stalls = 0;
  let totalTurns = 0;

  const p1Deck = buildPlaytestDeckFromCorpusText(p1.label, p1.text);
  const p2Deck = buildPlaytestDeckFromCorpusText(p2.label, p2.text);

  for (const seed of seeds) {
    const result = runMatchFromBuiltDecks(
      { player1Name: p1.player, player2Name: p2.player, player1Deck: p1Deck, player2Deck: p2Deck, seed },
      { placeBenchBasics: true, maxMulligans: 40 },
      { maxTurns: 50, maxActions: 500 },
    );
    // Only count as a stall if the engine genuinely got stuck (unresolved pendingAction)
    if (result.stalled) {
      stalls += 1;
      draws += 1;
    } else if (result.winnerId === PlayerId.P1) {
      p1Wins += 1;
    } else if (result.winnerId === PlayerId.P2) {
      p2Wins += 1;
    } else {
      // Time-limit draw (no winner, not stalled) — count as draw but not stall
      draws += 1;
    }
    totalTurns += result.state.turnNumber;
  }

  return {
    p1Id: p1.id,
    p2Id: p2.id,
    p1Name: p1.deckName,
    p2Name: p2.deckName,
    p1Archetype: detectArchetype(p1.text),
    p2Archetype: detectArchetype(p2.text),
    p1Wins,
    p2Wins,
    draws,
    stalls,
    games: seeds.length,
    avgTurns: totalTurns / seeds.length,
  };
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function winRateLabel(wins: number, games: number): string {
  if (games === 0) return "—";
  return `${Math.round((wins / games) * 100)}%`;
}

function winRateColor(wins: number, games: number): string {
  if (games === 0) return "#64748b";
  const rate = wins / games;
  if (rate >= 0.6) return "#34d399";
  if (rate >= 0.5) return "#a3e635";
  if (rate >= 0.4) return "#fbbf24";
  return "#f87171";
}

const PLAYSTYLE_COLOR: Record<string, string> = {
  spread: "#a78bfa",
  "tank-heal": "#34d399",
  "discard-engine": "#f97316",
  toolbox: "#60a5fa",
  aggro: "#f43f5e",
};

// ─── Deck Strategy Card ───────────────────────────────────────────────────────

function StrategyCard({ profile, preset }: { profile: StrategyProfile; preset?: TournamentDeckPreset }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="meta-strategy-card">
      <div className="meta-strategy-card__header">
        <span
          className="meta-strategy-card__badge"
          style={{ background: PLAYSTYLE_COLOR[profile.playstyle] ?? "#64748b" }}
        >
          {profile.playstyle}
        </span>
        <h3>{profile.displayName}</h3>
        {preset && (
          <span className="meta-strategy-card__placement">
            {preset.player} · #{preset.placement}
          </span>
        )}
      </div>

      <p className="meta-strategy-card__win-condition">{profile.winCondition}</p>

      <div className="meta-strategy-card__attacker-row">
        {profile.attackerRoles
          .filter((r) => r.role === "primary" || r.role === "secondary")
          .map((r) => (
            <span
              key={r.pokemonName}
              className={`meta-strategy-card__attacker meta-strategy-card__attacker--${r.role}`}
            >
              {r.pokemonName}
            </span>
          ))}
      </div>

      <button
        type="button"
        className="meta-strategy-card__toggle"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "▾ Hide" : "▸ Game plan & tips"}
      </button>

      {expanded && (
        <div className="meta-strategy-card__detail">
          <h4>Game plan</h4>
          <ol className="meta-strategy-card__game-plan">
            {profile.gamePlan.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>

          <div className="meta-strategy-card__columns">
            <div>
              <h4>Boss's Orders targets</h4>
              <ul>
                {profile.bossPriority.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
            <div>
              <h4>Bench first</h4>
              <ul>
                {profile.benchPriority.slice(0, 4).map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          </div>

          {Object.keys(profile.matchupNotes).length > 0 && (
            <>
              <h4>Matchup notes</h4>
              <ul>
                {Object.entries(profile.matchupNotes).map(([vs, note]) => (
                  <li key={vs}>
                    <strong>vs {STRATEGY_PROFILES[vs as Archetype]?.displayName ?? vs}:</strong> {note}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Matchup matrix ──────────────────────────────────────────────────────────

interface MatchupMatrixProps {
  results: MatchupResult[];
  decks: TournamentDeckPreset[];
}

function MatchupMatrix({ results, decks }: MatchupMatrixProps) {
  const names = decks.map((d) => ({ id: d.id, label: d.deckName, arch: detectArchetype(d.text) }));

  return (
    <div className="meta-matrix">
      <p className="meta-matrix__note">
        P1 win rate (row vs column). <span style={{ color: "#34d399" }}>Green ≥ 60%</span>
        {" · "}
        <span style={{ color: "#f87171" }}>Red ≤ 40%</span>
        {" · "}Hover for W/L/stall detail.
      </p>
      <div className="meta-matrix__scroll">
        <table className="meta-matrix__table">
          <thead>
            <tr>
              <th>P1 ↓ / P2 →</th>
              {names.map((n) => (
                <th key={n.id} title={n.label}>
                  <span
                    className="meta-matrix__arch-dot"
                    style={{ background: PLAYSTYLE_COLOR[STRATEGY_PROFILES[n.arch]?.playstyle ?? ""] ?? "#64748b" }}
                  />
                  {n.label.substring(0, 12)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((row) => (
              <tr key={row.id}>
                <td className="meta-matrix__label">
                  <span
                    className="meta-matrix__arch-dot"
                    style={{ background: PLAYSTYLE_COLOR[STRATEGY_PROFILES[row.arch]?.playstyle ?? ""] ?? "#64748b" }}
                  />
                  {row.label.substring(0, 14)}
                </td>
                {names.map((col) => {
                  if (row.id === col.id) return <td key={col.id} className="meta-matrix__mirror">—</td>;
                  const r = results.find((m) => m.p1Id === row.id && m.p2Id === col.id);
                  const rev = results.find((m) => m.p1Id === col.id && m.p2Id === row.id);
                  const wins = (r?.p1Wins ?? 0) + (rev?.p2Wins ?? 0);
                  const losses = (r?.p2Wins ?? 0) + (rev?.p1Wins ?? 0);
                  const stalls = (r?.stalls ?? 0) + (rev?.stalls ?? 0);
                  const games = (r?.games ?? 0) + (rev?.games ?? 0);
                  const avgT = r && rev
                    ? ((r.avgTurns + rev.avgTurns) / 2).toFixed(1)
                    : (r?.avgTurns ?? rev?.avgTurns ?? 0).toFixed(1);
                  return (
                    <td
                      key={col.id}
                      className="meta-matrix__cell"
                      style={{ color: winRateColor(wins, games) }}
                      title={`${wins}W / ${losses}L / ${stalls} stall · avg ${avgT} turns`}
                    >
                      {winRateLabel(wins, games)}
                      {stalls > 0 && <span className="meta-matrix__stall"> ⚠</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Deck stats panel ─────────────────────────────────────────────────────────

interface DeckStatRow {
  deck: TournamentDeckPreset;
  wins: number;
  losses: number;
  stalls: number;
  games: number;
  winRate: number | null;
  avgTurns: number | null;
}

function DeckStatsPanel({ decks, results }: { decks: TournamentDeckPreset[]; results: MatchupResult[] }) {
  const rows: DeckStatRow[] = decks.map((deck) => {
    let wins = 0, losses = 0, stalls = 0, games = 0, totalTurns = 0;
    for (const r of results) {
      if (r.p1Id === deck.id) {
        wins += r.p1Wins; losses += r.p2Wins; stalls += r.stalls;
        games += r.games; totalTurns += r.avgTurns * r.games;
      }
      if (r.p2Id === deck.id) {
        wins += r.p2Wins; losses += r.p1Wins; stalls += r.stalls;
        games += r.games; totalTurns += r.avgTurns * r.games;
      }
    }
    return {
      deck,
      wins,
      losses,
      stalls,
      games,
      winRate: games > 0 ? wins / games : null,
      avgTurns: games > 0 ? totalTurns / games : null,
    };
  }).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

  return (
    <div className="meta-stats">
      <table className="meta-stats__table">
        <thead>
          <tr>
            <th>#</th>
            <th>Deck</th>
            <th>Archetype</th>
            <th>Win rate</th>
            <th>W / L</th>
            <th>Stalls</th>
            <th>Avg turns</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const arch = detectArchetype(row.deck.text);
            const profile = STRATEGY_PROFILES[arch];
            return (
              <tr key={row.deck.id}>
                <td className="meta-stats__rank">{idx + 1}</td>
                <td className="meta-stats__name">{row.deck.deckName}</td>
                <td>
                  <span
                    className="meta-strategy-card__badge"
                    style={{ background: PLAYSTYLE_COLOR[profile?.playstyle ?? ""] ?? "#64748b", fontSize: "0.7rem" }}
                  >
                    {profile?.playstyle ?? "?"}
                  </span>
                </td>
                <td style={{ color: row.winRate !== null ? winRateColor(row.wins, row.games) : "#64748b", fontWeight: 700 }}>
                  {row.winRate !== null ? `${Math.round(row.winRate * 100)}%` : "—"}
                </td>
                <td className="meta-stats__wl">
                  <span style={{ color: "#34d399" }}>{row.wins}W</span>
                  {" / "}
                  <span style={{ color: "#f87171" }}>{row.losses}L</span>
                </td>
                <td style={{ color: row.stalls > 0 ? "#fbbf24" : "#64748b" }}>
                  {row.stalls > 0 ? `⚠ ${row.stalls}` : "0"}
                </td>
                <td className="meta-stats__turns">
                  {row.avgTurns !== null ? row.avgTurns.toFixed(1) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="meta-stats__note">
        Strategy-aware AI · Retreat logic · Archetype-specific targeting
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MetaAnalyzer() {
  const [tournament, setTournament] = useState(ALL_TOURNAMENTS[0]!);
  const [matchupResults, setMatchupResults] = useState<MatchupResult[]>([]);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"strategies" | "matrix" | "stats">("strategies");
  const [simGames, setSimGames] = useState(10);

  const decks = tournament.decks;

  const handleRunMatrix = useCallback(() => {
    setRunning(true);
    setMatchupResults([]);
    setTimeout(() => {
      const seeds = SEEDS.slice(0, simGames);
      const results: MatchupResult[] = [];
      for (let i = 0; i < decks.length; i++) {
        for (let j = i + 1; j < decks.length; j++) {
          results.push(runMatchup(decks[i]!, decks[j]!, seeds));
        }
      }
      setMatchupResults(results);
      setRunning(false);
      setActiveTab("stats");
    }, 0);
  }, [decks, simGames]);

  // Aggregate win rate per deck (for tier bar)
  const deckWinRates = decks.map((deck) => {
    let wins = 0, games = 0;
    for (const r of matchupResults) {
      if (r.p1Id === deck.id) { wins += r.p1Wins; games += r.games; }
      if (r.p2Id === deck.id) { wins += r.p2Wins; games += r.games; }
    }
    return { deck, wins, games, winRate: games > 0 ? wins / games : null };
  }).sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

  const pairCount = decks.length * (decks.length - 1) / 2;

  return (
    <div className="meta-analyzer">
      {/* Header bar */}
      <div className="meta-analyzer__toolbar">
        <select
          value={String(tournament.tournamentId)}
          onChange={(e) => {
            const t = ALL_TOURNAMENTS.find((t) => String(t.tournamentId) === e.target.value);
            if (t) { setTournament(t); setMatchupResults([]); }
          }}
          className="meta-analyzer__tournament-select"
        >
          {ALL_TOURNAMENTS.map((t) => (
            <option key={t.tournamentId} value={String(t.tournamentId)}>
              {t.name} ({t.date})
            </option>
          ))}
        </select>

        <label className="meta-analyzer__games-label">
          Games/matchup:
          <select
            value={simGames}
            onChange={(e) => setSimGames(Number(e.target.value))}
            className="meta-analyzer__games-select"
          >
            {[4, 6, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <button
          type="button"
          className="meta-analyzer__run-btn"
          onClick={handleRunMatrix}
          disabled={running}
        >
          {running ? "Simulating…" : `▶ Run ${pairCount} matchups × ${simGames}g`}
        </button>

        <nav className="meta-analyzer__tabs">
          <button
            type="button"
            className={activeTab === "strategies" ? "meta-analyzer__tab meta-analyzer__tab--active" : "meta-analyzer__tab"}
            onClick={() => setActiveTab("strategies")}
          >
            Deck Strategies
          </button>
          <button
            type="button"
            className={activeTab === "stats" ? "meta-analyzer__tab meta-analyzer__tab--active" : "meta-analyzer__tab"}
            onClick={() => setActiveTab("stats")}
          >
            Deck Stats {matchupResults.length > 0 ? "✓" : ""}
          </button>
          <button
            type="button"
            className={activeTab === "matrix" ? "meta-analyzer__tab meta-analyzer__tab--active" : "meta-analyzer__tab"}
            onClick={() => setActiveTab("matrix")}
          >
            Matchup Matrix {matchupResults.length > 0 ? `(${simGames}g)` : ""}
          </button>
        </nav>
      </div>

      {/* Tier summary bar (when data available) */}
      {matchupResults.length > 0 && (
        <div className="meta-tier-bar">
          <span className="meta-tier-bar__label">Win rates (strategy AI):</span>
          {deckWinRates.map(({ deck, winRate, wins, games }) => (
            <span
              key={deck.id}
              className="meta-tier-bar__chip"
              style={{ borderColor: winRate !== null ? winRateColor(wins, games) : "#64748b" }}
              title={`${wins}W / ${games - wins}L out of ${games} games`}
            >
              {deck.deckName.split(" ")[0]}
              {" "}
              <strong style={{ color: winRate !== null ? winRateColor(wins, games) : undefined }}>
                {winRate !== null ? `${Math.round(winRate * 100)}%` : "—"}
              </strong>
            </span>
          ))}
        </div>
      )}

      {/* Content area */}
      {activeTab === "strategies" && (
        <div className="meta-strategies-grid">
          {decks.map((deck) => (
            <StrategyCard key={deck.id} profile={getDeckStrategy(deck)} preset={deck} />
          ))}
        </div>
      )}

      {activeTab === "stats" && matchupResults.length === 0 && (
        <div className="meta-empty">
          <p>Run matchups above to see per-deck statistics.</p>
          <p className="meta-empty__sub">
            Each pair plays {simGames} games with strategy-aware AI (retreat logic, archetype targeting, signature attacks).
          </p>
        </div>
      )}

      {activeTab === "stats" && matchupResults.length > 0 && (
        <DeckStatsPanel decks={decks} results={matchupResults} />
      )}

      {activeTab === "matrix" && matchupResults.length === 0 && (
        <div className="meta-empty">
          <p>Run matchups above to generate the win-rate matrix.</p>
          <p className="meta-empty__sub">Each pair plays {simGames} games with different random seeds.</p>
        </div>
      )}

      {activeTab === "matrix" && matchupResults.length > 0 && (
        <MatchupMatrix results={matchupResults} decks={decks} />
      )}
    </div>
  );
}
