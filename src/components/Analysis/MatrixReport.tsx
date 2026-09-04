import type { DeckTierEntry, MatchupStats, SimHealthSummary } from "@/lib/deck/playtestRunner";

interface MatrixReportProps {
  title: string;
  seedCount: number;
  health: SimHealthSummary;
  tiers: DeckTierEntry[];
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function MatrixReport({ title, seedCount, health, tiers }: MatrixReportProps) {
  return (
    <section className="matrix-report" aria-label="Matrix summary">
      <header className="matrix-report__header">
        <h3>{title}</h3>
        <p className="matrix-report__meta">{seedCount} seeds · {health.totalGames} games simulated</p>
      </header>

      <div className="matrix-report__stats">
        <div className="matrix-report__stat">
          <span className="matrix-report__stat-value">{pct(health.completionRate)}</span>
          <span className="matrix-report__stat-label">Completion</span>
        </div>
        <div className="matrix-report__stat">
          <span className="matrix-report__stat-value">{pct(health.stallRate)}</span>
          <span className="matrix-report__stat-label">Stalls</span>
        </div>
        <div className="matrix-report__stat">
          <span className="matrix-report__stat-value">{pct(health.setupFailureRate)}</span>
          <span className="matrix-report__stat-label">Setup fails</span>
        </div>
        <div className="matrix-report__stat">
          <span className="matrix-report__stat-value">{health.drawsByStall + health.drawsByCap}</span>
          <span className="matrix-report__stat-label">Draws</span>
        </div>
      </div>

      <div className="matrix-report__section">
        <h4>Tier list</h4>
        <table className="matrix-report__table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Deck</th>
              <th scope="col">Win rate</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((row, index) => (
              <tr key={row.presetId}>
                <td>{index + 1}</td>
                <td>{row.deckName}</td>
                <td>{pct(row.winRate)}</td>
                <td>
                  {row.wins}-{row.losses}-{row.draws}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="matrix-report__matchups">
        <summary>Matchup details ({health.matchups.length})</summary>
        <ul className="matrix-report__matchup-list">
          {health.matchups.map((matchup) => (
            <li key={`${matchup.p1PresetId}-${matchup.p2PresetId}`}>
              <MatchupLine matchup={matchup} />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function MatchupLine({ matchup }: { matchup: MatchupStats }) {
  const mirror = matchup.p1PresetId === matchup.p2PresetId;
  return (
    <span>
      <strong>{matchup.p1DeckName}</strong>
      {mirror ? " (mirror)" : ` vs ${matchup.p2DeckName}`}:{" "}
      {pct(matchup.p1WinRate)} / {pct(matchup.p2WinRate)} · avg {matchup.avgTurnCount.toFixed(1)} turns
    </span>
  );
}
