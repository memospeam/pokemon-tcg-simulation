import type { MatchupStats, DeckTierEntry } from "@/lib/deck/playtestRunner";
import type { TournamentDeckPreset } from "@/lib/deck/tournamentPresets";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function winRateForRow(
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

/** Win-rate grid + tier list + matchup detail as CSV. */
export function buildMatrixCsv(
  presets: TournamentDeckPreset[],
  matchups: MatchupStats[],
  tiers: DeckTierEntry[],
): string {
  const lines: string[] = [];

  lines.push("Win rate matrix (% row deck vs column deck)");
  lines.push(["Row deck", ...presets.map((p) => p.deckName)].map(csvEscape).join(","));
  for (const row of presets) {
    const cells = presets.map((col) => {
      const rate = winRateForRow(row.id, col.id, matchups);
      return rate === null ? "" : String(Math.round(rate * 100));
    });
    lines.push([row.deckName, ...cells].map(csvEscape).join(","));
  }

  lines.push("");
  lines.push("Tier list");
  lines.push("Rank,Deck,Win%,W,L,D");
  tiers.forEach((entry, index) => {
    lines.push(
      [String(index + 1), entry.deckName, String(Math.round(entry.winRate * 100)), String(entry.wins), String(entry.losses), String(entry.draws)]
        .map(csvEscape)
        .join(","),
    );
  });

  lines.push("");
  lines.push("Matchup detail");
  lines.push("Deck A,Deck B,Games,P1 win%,P2 win%,Avg turns,Stalls");
  for (const m of matchups) {
    lines.push(
      [
        m.p1DeckName,
        m.p2DeckName,
        String(m.games),
        String(Math.round(m.p1WinRate * 100)),
        String(Math.round(m.p2WinRate * 100)),
        m.avgTurnCount.toFixed(1),
        String(m.stalls),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
