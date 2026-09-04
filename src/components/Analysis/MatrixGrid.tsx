import type { MatchupStats } from "@/lib/deck/playtestRunner";
import type { TournamentDeckPreset } from "@/lib/deck/tournamentPresets";

function shortDeckName(name: string): string {
  const trimmed = name.replace(/\s*\(.*\)$/, "").trim();
  return trimmed.length > 18 ? `${trimmed.slice(0, 16)}…` : trimmed;
}

function winRateForRow(
  rowId: string,
  colId: string,
  matchups: MatchupStats[],
): number | null {
  const direct = matchups.find((m) => m.p1PresetId === rowId && m.p2PresetId === colId);
  if (direct) return direct.p1WinRate;
  const reverse = matchups.find((m) => m.p1PresetId === colId && m.p2PresetId === rowId);
  if (reverse) return reverse.p2WinRate;
  return null;
}

function cellClass(rate: number | null, mirror: boolean): string {
  if (mirror) return "matrix-grid__cell matrix-grid__cell--mirror";
  if (rate === null) return "matrix-grid__cell matrix-grid__cell--empty";
  if (rate >= 0.6) return "matrix-grid__cell matrix-grid__cell--strong";
  if (rate >= 0.5) return "matrix-grid__cell matrix-grid__cell--even";
  if (rate >= 0.4) return "matrix-grid__cell matrix-grid__cell--weak";
  return "matrix-grid__cell matrix-grid__cell--bad";
}

interface MatrixGridProps {
  presets: TournamentDeckPreset[];
  matchups: MatchupStats[];
}

export function MatrixGrid({ presets, matchups }: MatrixGridProps) {
  return (
    <div className="matrix-grid-wrap">
      <table className="matrix-grid">
        <thead>
          <tr>
            <th scope="col" className="matrix-grid__corner">
              Row → Col
            </th>
            {presets.map((preset) => (
              <th key={preset.id} scope="col" title={preset.deckName}>
                {shortDeckName(preset.deckName)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {presets.map((row) => (
            <tr key={row.id}>
              <th scope="row" title={row.deckName}>
                {shortDeckName(row.deckName)}
              </th>
              {presets.map((col) => {
                const mirror = row.id === col.id;
                const rate = winRateForRow(row.id, col.id, matchups);
                const label =
                  rate === null ? "—" : mirror ? `${Math.round(rate * 100)}%` : `${Math.round(rate * 100)}%`;
                return (
                  <td key={col.id} className={cellClass(rate, mirror)} title={`${row.deckName} vs ${col.deckName}`}>
                    {label}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
