import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import {
  CI_BATCH_SEEDS,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  formatWinRate,
  runPresetMatchupBatch,
  summarizeSimHealth,
  type MatchupStats,
} from "./playtestRunner";

function printMatrix(title: string, rows: Array<[string, MatchupStats]>, health: ReturnType<typeof summarizeSimHealth>) {
  console.log(`\n# ${title}`);
  console.log(`Seeds: ${CI_BATCH_SEEDS.join(", ")} | maxTurns ${DEFAULT_PLAYTEST_RUN.maxTurns}`);
  console.log(
    `Health: ${Math.round(health.completionRate * 100)}% complete, ${Math.round(health.stallRate * 100)}% stall, ${health.drawsByCap} cap draws\n`,
  );
  console.log("| Matchup | Games | P1 win% | W-L-D | Stalls | Avg turns | Prize margin |");
  console.log("| --- | ---: | --- | --- | ---: | ---: | ---: |");
  for (const [label, m] of rows) {
    console.log(
      `| ${label} | ${m.games} | ${formatWinRate(m.p1Wins, m.p2Wins)} | ${m.p1Wins}-${m.p2Wins}-${m.draws} | ${m.stalls} | ${m.avgTurnCount.toFixed(1)} | ${m.avgPrizeMargin.toFixed(1)} |`,
    );
  }
}

function aggregateCross(
  zoroP1: MatchupStats,
  oppP1: MatchupStats,
  zoroName: string,
  oppName: string,
) {
  const zoroWins = zoroP1.p1Wins + oppP1.p2Wins;
  const oppWins = zoroP1.p2Wins + oppP1.p1Wins;
  const crossGames = zoroP1.games + oppP1.games;
  console.log(
    `\nAggregate (both seats): ${zoroName} ${zoroWins}/${crossGames} (${Math.round((zoroWins / crossGames) * 100)}%) — ${oppName} ${oppWins}/${crossGames} (${Math.round((oppWins / crossGames) * 100)}%)`,
  );
}

describe("Worlds Zoroark matrix (heuristic AI)", () => {
  const opts = {
    seeds: CI_BATCH_SEEDS,
    setup: DEFAULT_PLAYTEST_SETUP,
    run: DEFAULT_PLAYTEST_RUN,
  };

  it("Liam #60 vs Dragapult #1 and Alakazam #2", () => {
    const liam = getTournamentDeckById("worlds26-60-liam-halliburton")!;
    const dragapult = getTournamentDeckById("worlds26-1-andrew-hedrick")!;
    const alakazam = getTournamentDeckById("worlds26-2-diego-cassiraga")!;
    expect(liam).toBeDefined();
    expect(dragapult).toBeDefined();
    expect(alakazam).toBeDefined();

    const liamVsDragP1 = runPresetMatchupBatch(liam, dragapult, opts);
    const dragVsLiamP1 = runPresetMatchupBatch(dragapult, liam, opts);
    const liamVsAlakP1 = runPresetMatchupBatch(liam, alakazam, opts);
    const alakVsLiamP1 = runPresetMatchupBatch(alakazam, liam, opts);

    const health = summarizeSimHealth([liamVsDragP1, dragVsLiamP1, liamVsAlakP1, alakVsLiamP1]);
    printMatrix("Worlds 2026 — Liam #60 Zoroark cross-matchups", [
      ["Liam Zoroark vs Dragapult (Liam P1)", liamVsDragP1],
      ["Dragapult vs Liam Zoroark (Dragapult P1)", dragVsLiamP1],
      ["Liam Zoroark vs Alakazam (Liam P1)", liamVsAlakP1],
      ["Alakazam vs Liam Zoroark (Alakazam P1)", alakVsLiamP1],
    ], health);
    aggregateCross(liamVsDragP1, dragVsLiamP1, "Liam Zoroark", "Dragapult");
    aggregateCross(liamVsAlakP1, alakVsLiamP1, "Liam Zoroark", "Alakazam");
  }, 180000);

  it("Öjvind #9 vs Dragapult #1 (reference)", () => {
    const zoroark = getTournamentDeckById("worlds26-9-ojvind-svinhufvud")!;
    const dragapult = getTournamentDeckById("worlds26-1-andrew-hedrick")!;
    expect(zoroark).toBeDefined();
    expect(dragapult).toBeDefined();

    const zoroP1 = runPresetMatchupBatch(zoroark, dragapult, opts);
    const dragP1 = runPresetMatchupBatch(dragapult, zoroark, opts);
    const health = summarizeSimHealth([zoroP1, dragP1]);
    printMatrix("Worlds 2026 — Öjvind #9 Zoroark vs Dragapult #1 (reference)", [
      ["Zoroark vs Dragapult (Zoroark P1)", zoroP1],
      ["Dragapult vs Zoroark (Dragapult P1)", dragP1],
    ], health);
    aggregateCross(zoroP1, dragP1, "Öjvind Zoroark", "Dragapult");
  }, 120000);
});
