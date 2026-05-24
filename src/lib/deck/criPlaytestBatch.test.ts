import { describe, expect, it } from "vitest";
import { runCriPlaytest } from "./criPlaytestRunner";
import {
  buildCriMetaReadinessReport,
  formatCriMetaReadinessReport,
} from "./metaReadinessReport";
import {
  CI_BATCH_SEEDS,
  computeDeckTierList,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  runPresetMatchupBatch,
  runPresetMatrix,
  summarizeSimHealth,
} from "./playtestRunner";
import { CRI_PLAYTEST_DECKS, getCriDeckById } from "./criDeckPresets";

describe("CRI playtest batch runner", () => {
  const batchOptions = {
    seeds: CI_BATCH_SEEDS,
    setup: DEFAULT_PLAYTEST_SETUP,
    run: DEFAULT_PLAYTEST_RUN,
  };

  it("aggregates win-rate and stall metrics for a preset mirror", () => {
    const preset = getCriDeckById("cri-greninja-water")!;
    const stats = runPresetMatchupBatch(preset, preset, batchOptions);

    expect(stats.games).toBe(CI_BATCH_SEEDS.length);
    expect(stats.p1Wins + stats.p2Wins + stats.draws).toBe(stats.games);
    expect(stats.p1WinRate + stats.p2WinRate).toBeCloseTo(1, 5);
    expect(stats.stalls).toBe(0);
    expect(stats.setupFailures).toBe(0);
    expect(stats.avgActionCount).toBeGreaterThan(5);
  });

  it("runs the full CRI preset matrix without stalls or setup failures", () => {
    const matchups = runPresetMatrix(CRI_PLAYTEST_DECKS, batchOptions);
    const health = summarizeSimHealth(matchups);

    expect(matchups).toHaveLength((CRI_PLAYTEST_DECKS.length * (CRI_PLAYTEST_DECKS.length + 1)) / 2);
    expect(health.totalGames).toBe(matchups.length * CI_BATCH_SEEDS.length);
    expect(health.stallRate).toBe(0);
    expect(health.setupFailureRate).toBe(0);
    expect(health.completionRate).toBeGreaterThan(0.5);
  });

  it("cross-match Greninja vs Floette completes every seed", () => {
    const greninja = getCriDeckById("cri-greninja-water")!;
    const floette = getCriDeckById("cri-floette-psychic")!;
    const stats = runPresetMatchupBatch(greninja, floette, batchOptions);

    expect(stats.stalls).toBe(0);
    expect(stats.setupFailures).toBe(0);
    expect(stats.p1Wins + stats.p2Wins).toBeGreaterThan(0);
  });

  it("builds a deck tier list from matrix results", () => {
    const matchups = runPresetMatrix(CRI_PLAYTEST_DECKS, batchOptions);
    const tierList = computeDeckTierList(CRI_PLAYTEST_DECKS, matchups);

    expect(tierList).toHaveLength(CRI_PLAYTEST_DECKS.length);
    expect(tierList.every((entry) => entry.games > 0)).toBe(true);
    expect(tierList.every((entry) => entry.winRate >= 0 && entry.winRate <= 1)).toBe(true);
  });
});

describe("CRI meta readiness report", () => {
  it("builds a report with static analysis and sim health", () => {
    const report = buildCriMetaReadinessReport();
    expect(report.analysis.pokemonCardsMissing).toBe(0);
    expect(report.analysis.signatureEffects.gaps).toEqual([]);
    expect(report.trainerCoverage.gaps).toEqual([]);
    expect(report.simHealth.stallRate).toBe(0);
    expect(report.simHealth.totalGames).toBeGreaterThan(0);
    expect(report.deckTierList).toHaveLength(CRI_PLAYTEST_DECKS.length);
    expect(report.trainerStubCounts).toHaveLength(CRI_PLAYTEST_DECKS.length);
  });

  it("formats markdown sections for manual review", () => {
    const report = buildCriMetaReadinessReport();
    const markdown = formatCriMetaReadinessReport(report);

    expect(markdown).toContain("# Chaos Rising Meta Readiness Report");
    expect(markdown).toContain("Signature effects:");
    expect(markdown).toContain("Auto-play sim health");
    expect(markdown).toContain("Deck tier list");
    expect(markdown).toContain("Mega Greninja ex mirror");
    // eslint-disable-next-line no-console
    console.log("\n" + markdown);
  });

  it("runCriPlaytest returns report and markdown in one call", () => {
    const result = runCriPlaytest();
    expect(result.report.deckTierList.length).toBe(CRI_PLAYTEST_DECKS.length);
    expect(result.markdown).toContain("# Chaos Rising Meta Readiness Report");
    expect(result.deckTierList).toBe(result.report.deckTierList);
  });
});
