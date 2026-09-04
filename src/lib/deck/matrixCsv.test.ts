import { describe, expect, it } from "vitest";
import { buildMatrixCsv, winRateForRow } from "./matrixCsv";
import type { MatchupStats } from "./playtestRunner";

const sampleMatchups: MatchupStats[] = [
  {
    p1PresetId: "a",
    p2PresetId: "a",
    p1DeckName: "Deck A",
    p2DeckName: "Deck A",
    games: 3,
    p1Wins: 2,
    p2Wins: 1,
    draws: 0,
    stalls: 0,
    setupFailures: 0,
    avgTurnCount: 12,
    avgActionCount: 40,
    p1WinRate: 2 / 3,
    p2WinRate: 1 / 3,
    avgPrizeMargin: 2,
  },
  {
    p1PresetId: "a",
    p2PresetId: "b",
    p1DeckName: "Deck A",
    p2DeckName: "Deck B",
    games: 3,
    p1Wins: 1,
    p2Wins: 2,
    draws: 0,
    stalls: 0,
    setupFailures: 0,
    avgTurnCount: 14,
    avgActionCount: 45,
    p1WinRate: 1 / 3,
    p2WinRate: 2 / 3,
    avgPrizeMargin: 1.5,
  },
];

describe("matrixCsv", () => {
  it("resolves win rate from either orientation", () => {
    expect(winRateForRow("a", "b", sampleMatchups)).toBeCloseTo(1 / 3);
    expect(winRateForRow("b", "a", sampleMatchups)).toBeCloseTo(2 / 3);
  });

  it("builds CSV with grid, tiers, and matchup rows", () => {
    const csv = buildMatrixCsv(
      [
        { id: "a", label: "A", placement: 1, player: "P1", deckName: "Deck A", text: "" },
        { id: "b", label: "B", placement: 2, player: "P2", deckName: "Deck B", text: "" },
      ],
      sampleMatchups,
      [
        {
          presetId: "b",
          deckName: "Deck B",
          games: 6,
          wins: 3,
          losses: 3,
          draws: 0,
          winRate: 0.5,
        },
      ],
    );
    expect(csv).toContain("Win rate matrix");
    expect(csv).toContain("Row deck,Deck A,Deck B");
    expect(csv).toContain("Tier list");
    expect(csv).toContain("Matchup detail");
  });
});
