import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import {
  CI_BATCH_SEEDS,
  computeDeckTierList,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  formatWinRate,
  runPresetMatrix,
  summarizeSimHealth,
} from "./playtestRunner";

// One representative per unique archetype from Utrecht Regional 2026-05-16
const META_DECK_IDS = [
  "utrecht-1-miloslav-posledni",     // Lopunny Dudunsparce  — 1st
  "utrecht-2-hasan-kunukcu",         // Dragapult             — 2nd
  "utrecht-4-joshua-vanoverschelde", // Rocket's Honchkrow    — 4th
  "utrecht-7-luke-burke",            // Dragapult Dusknoir    — 7th
  "utrecht-8-fabio-battistella",     // Ogerpon Box           — 8th
  "utrecht-11-hermanni-hietalahti",  // N's Zoroark           — 11th
  "utrecht-12-joris-van-dijk",       // Alakazam Dudunsparce  — 12th
  "utrecht-13-constantin-geisb-sch", // Cynthia's Garchomp    — 13th
  "utrecht-14-niklas-leitz",         // Greninja              — 14th
  "utrecht-15-oscar-madsen",         // Dragapult Dudunsparce — 15th
  "utrecht-16-fabian-kern",          // Hydrapple             — 16th
];

const META_DECKS = META_DECK_IDS.map((id) => {
  const deck = getTournamentDeckById(id);
  if (!deck) throw new Error(`Deck preset not found: ${id}`);
  return deck;
});

const BATCH_OPTIONS = {
  seeds: CI_BATCH_SEEDS,
  setup: DEFAULT_PLAYTEST_SETUP,
  run: DEFAULT_PLAYTEST_RUN,
};

describe("Tournament meta playtest", () => {
  it("resolves all 11 archetype representatives", () => {
    expect(META_DECKS).toHaveLength(11);
    for (const deck of META_DECKS) {
      expect(deck.id).toBeTruthy();
      expect(deck.deckName).toBeTruthy();
    }
  });

  it("runs the full meta matrix with no setup failures", () => {
    const matchups = runPresetMatrix(META_DECKS, BATCH_OPTIONS);
    const health = summarizeSimHealth(matchups);

    expect(matchups).toHaveLength((META_DECKS.length * (META_DECKS.length + 1)) / 2);
    expect(health.totalGames).toBe(matchups.length * CI_BATCH_SEEDS.length);
    // Stall rate may be non-zero: Lopunny/Alakazam/Honchkrow/Ogerpon need choice mechanics the auto-runner doesn't yet support.
    expect(health.setupFailureRate).toBe(0);
    expect(health.completionRate).toBeGreaterThan(0);
  }, 90000);

  it("prints meta tier list and matchup table for manual review", () => {
    const matchups = runPresetMatrix(META_DECKS, BATCH_OPTIONS);
    const health = summarizeSimHealth(matchups);
    const tierList = computeDeckTierList(META_DECKS, matchups);

    // Tier list
    const tierRows = tierList
      .map((entry, i) => {
        const rank = i + 1;
        const pct = Math.round(entry.winRate * 100);
        return `| ${rank} | ${entry.deckName} | ${pct}% | ${entry.wins}-${entry.losses}-${entry.draws} |`;
      })
      .join("\n");

    // Matchup table (cross only, not mirrors)
    const crossMatchups = matchups.filter((m) => m.p1PresetId !== m.p2PresetId);
    const matchupRows = crossMatchups
      .map(
        (m) =>
          `| ${m.p1DeckName} vs ${m.p2DeckName} | ${m.games} | ${formatWinRate(m.p1Wins, m.p2Wins)} | ${m.stalls} | ${m.avgTurnCount.toFixed(1)} | ${m.avgPrizeMargin.toFixed(1)} |`,
      )
      .join("\n");

    const report = `
# Utrecht Regional Meta Playtest — Auto-play Simulation
Tournament: Utrecht Regional 2026-05-16
Seeds: ${CI_BATCH_SEEDS.join(", ")} | Decks: ${META_DECKS.length} archetypes

## Sim health
Games: ${health.totalGames} | Completion: ${Math.round(health.completionRate * 100)}% | Stalls: ${Math.round(health.stallRate * 100)}% | Setup failures: ${Math.round(health.setupFailureRate * 100)}%
Draws: ${health.drawsByCap} turn/action-cap, ${health.drawsByStall} stall

## Tier List
| Rank | Deck | Win% | W-L-D |
| ---: | --- | ---: | --- |
${tierRows}

## Cross Matchups
| Matchup | Games | P1 win rate | Stalls | Avg turns | Prize margin |
| --- | ---: | --- | ---: | ---: | ---: |
${matchupRows}
`;

    // eslint-disable-next-line no-console
    console.log(report);

    expect(tierList).toHaveLength(META_DECKS.length);
    expect(tierList.every((e) => e.games > 0)).toBe(true);
  }, 90000);
});
