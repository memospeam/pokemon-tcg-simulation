import type { BuiltDeck } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { PlayerId } from "../models/enums";
import {
  runMatchFromBuiltDecks,
  type GameRunOptions,
  type MatchSetupOptions,
  type TournamentMatchResult,
} from "./metaGameRunner";

export interface MatchBatchOptions {
  seeds: number[];
  setup?: MatchSetupOptions;
  run?: GameRunOptions;
}

export interface MatchupStats {
  p1PresetId: string;
  p2PresetId: string;
  p1DeckName: string;
  p2DeckName: string;
  games: number;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  stalls: number;
  setupFailures: number;
  avgTurnCount: number;
  avgActionCount: number;
  /** Share of decided games (excludes draws). */
  p1WinRate: number;
  p2WinRate: number;
}

export interface DeckTierEntry {
  presetId: string;
  deckName: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface SimHealthSummary {
  matchups: MatchupStats[];
  totalGames: number;
  stallRate: number;
  completionRate: number;
  setupFailureRate: number;
}

export const DEFAULT_PLAYTEST_SETUP: MatchSetupOptions = {
  placeBenchBasics: true,
  maxMulligans: 40,
};

export const DEFAULT_PLAYTEST_RUN: GameRunOptions = {
  maxTurns: 30,
  maxActions: 240,
};

/** Small seed set for fast CI batch smokes. */
export const CI_BATCH_SEEDS = [11, 23, 37];

export function defaultBatchSeeds(count: number, base = 1): number[] {
  return Array.from({ length: count }, (_, index) => base + index * 13);
}

function recordMatchResult(stats: Omit<MatchupStats, "avgTurnCount" | "avgActionCount"> & {
  turnTotal: number;
  actionTotal: number;
}, result: TournamentMatchResult): void {
  stats.games += 1;
  stats.turnTotal += result.turnCount;
  stats.actionTotal += result.actionCount;

  if (!result.setupComplete) {
    stats.setupFailures += 1;
  }
  if (result.stalled) {
    stats.stalls += 1;
  }
  if (result.winnerId === PlayerId.P1) {
    stats.p1Wins += 1;
  } else if (result.winnerId === PlayerId.P2) {
    stats.p2Wins += 1;
  } else {
    stats.draws += 1;
  }
}

function finalizeMatchupStats(
  base: Omit<MatchupStats, "avgTurnCount" | "avgActionCount" | "p1WinRate" | "p2WinRate"> & {
    turnTotal: number;
    actionTotal: number;
  },
): MatchupStats {
  const decided = base.p1Wins + base.p2Wins;
  return {
    ...base,
    avgTurnCount: base.games > 0 ? base.turnTotal / base.games : 0,
    avgActionCount: base.games > 0 ? base.actionTotal / base.games : 0,
    p1WinRate: decided > 0 ? base.p1Wins / decided : 0,
    p2WinRate: decided > 0 ? base.p2Wins / decided : 0,
  };
}

export function runBuiltDeckMatchupBatch(
  input: {
    p1PresetId: string;
    p2PresetId: string;
    p1DeckName: string;
    p2DeckName: string;
    p1Player: string;
    p2Player: string;
    p1Deck: BuiltDeck;
    p2Deck: BuiltDeck;
  },
  options: MatchBatchOptions,
): MatchupStats {
  const setup = options.setup ?? DEFAULT_PLAYTEST_SETUP;
  const run = options.run ?? DEFAULT_PLAYTEST_RUN;

  const accumulator = {
    p1PresetId: input.p1PresetId,
    p2PresetId: input.p2PresetId,
    p1DeckName: input.p1DeckName,
    p2DeckName: input.p2DeckName,
    games: 0,
    p1Wins: 0,
    p2Wins: 0,
    draws: 0,
    stalls: 0,
    setupFailures: 0,
    turnTotal: 0,
    actionTotal: 0,
  };

  for (const seed of options.seeds) {
    const result = runMatchFromBuiltDecks(
      {
        player1Name: input.p1Player,
        player2Name: input.p2Player,
        player1Deck: input.p1Deck,
        player2Deck: input.p2Deck,
        seed,
      },
      setup,
      run,
    );
    recordMatchResult(accumulator, result);
  }

  return finalizeMatchupStats(accumulator);
}

export function runPresetMatchupBatch(
  p1Preset: TournamentDeckPreset,
  p2Preset: TournamentDeckPreset,
  options: MatchBatchOptions,
): MatchupStats {
  const p1Deck = buildPlaytestDeckFromCorpusText(p1Preset.label, p1Preset.text);
  const p2Deck = buildPlaytestDeckFromCorpusText(p2Preset.label, p2Preset.text);
  return runBuiltDeckMatchupBatch(
    {
      p1PresetId: p1Preset.id,
      p2PresetId: p2Preset.id,
      p1DeckName: p1Preset.deckName,
      p2DeckName: p2Preset.deckName,
      p1Player: p1Preset.player,
      p2Player: p2Preset.player,
      p1Deck,
      p2Deck,
    },
    options,
  );
}

/** Run mirror + cross matchups for each preset pair (i ≤ j). */
export function runPresetMatrix(
  presets: TournamentDeckPreset[],
  options: MatchBatchOptions,
): MatchupStats[] {
  const stats: MatchupStats[] = [];
  for (let i = 0; i < presets.length; i += 1) {
    for (let j = i; j < presets.length; j += 1) {
      stats.push(runPresetMatchupBatch(presets[i]!, presets[j]!, options));
    }
  }
  return stats;
}

export function summarizeSimHealth(matchups: MatchupStats[]): SimHealthSummary {
  const totalGames = matchups.reduce((sum, matchup) => sum + matchup.games, 0);
  const stalls = matchups.reduce((sum, matchup) => sum + matchup.stalls, 0);
  const setupFailures = matchups.reduce((sum, matchup) => sum + matchup.setupFailures, 0);
  const completed = matchups.reduce(
    (sum, matchup) => sum + matchup.p1Wins + matchup.p2Wins,
    0,
  );

  return {
    matchups,
    totalGames,
    stallRate: totalGames > 0 ? stalls / totalGames : 0,
    completionRate: totalGames > 0 ? completed / totalGames : 0,
    setupFailureRate: totalGames > 0 ? setupFailures / totalGames : 0,
  };
}

export function formatWinRate(p1Wins: number, p2Wins: number): string {
  const decided = p1Wins + p2Wins;
  if (decided === 0) return "—";
  const p1Pct = Math.round((p1Wins / decided) * 100);
  return `${p1Pct}% / ${100 - p1Pct}%`;
}

/** Aggregate per-deck win rates across a preset matrix (mirrors + cross-matchups). */
export function computeDeckTierList(
  presets: TournamentDeckPreset[],
  matchups: MatchupStats[],
): DeckTierEntry[] {
  const byId = new Map<string, DeckTierEntry>();
  for (const preset of presets) {
    byId.set(preset.id, {
      presetId: preset.id,
      deckName: preset.deckName,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRate: 0,
    });
  }

  for (const matchup of matchups) {
    const p1 = byId.get(matchup.p1PresetId);
    const p2 = byId.get(matchup.p2PresetId);
    if (!p1) continue;

    p1.games += matchup.games;
    p1.wins += matchup.p1Wins;
    p1.draws += matchup.draws;

    if (matchup.p1PresetId === matchup.p2PresetId) {
      p1.wins += matchup.p2Wins;
      continue;
    }

    p1.losses += matchup.p2Wins;
    if (p2) {
      p2.games += matchup.games;
      p2.wins += matchup.p2Wins;
      p2.losses += matchup.p1Wins;
      p2.draws += matchup.draws;
    }
  }

  return [...byId.values()]
    .map((entry) => {
      const decided = entry.wins + entry.losses;
      return {
        ...entry,
        winRate: decided > 0 ? entry.wins / decided : 0,
      };
    })
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}
