import { summarizeFocusExpansion } from "../format/standardFocus";
import {
  analyzeCriDeck,
  CRI_ENGINE_READY_SIGNATURES,
  CRI_ENGINE_READY_TRAINERS,
  listCriTrainerStubCounts,
  summarizeCriPlaytestAnalysis,
  summarizeCriTrainerCoverage,
} from "./criDeckAnalyzer";
import { CRI_PLAYTEST_DECKS } from "./criDeckPresets";
import {
  CI_BATCH_SEEDS,
  computeDeckTierList,
  DEFAULT_PLAYTEST_RUN,
  DEFAULT_PLAYTEST_SETUP,
  formatWinRate,
  runPresetMatrix,
  summarizeSimHealth,
  type DeckTierEntry,
  type MatchBatchOptions,
  type SimHealthSummary,
} from "./playtestRunner";
import type { Top16AnalysisSummary, TournamentDeckAnalysis } from "./top16Analyzer";

export interface CriMetaReadinessReport {
  analysis: Top16AnalysisSummary & { focusSignatures: ReturnType<typeof summarizeCriPlaytestAnalysis>["focusSignatures"] };
  trainerCoverage: ReturnType<typeof summarizeCriTrainerCoverage>;
  focusExpansion: ReturnType<typeof summarizeFocusExpansion>;
  simHealth: SimHealthSummary;
  deckTierList: DeckTierEntry[];
  trainerStubCounts: ReturnType<typeof listCriTrainerStubCounts>;
  analyses: TournamentDeckAnalysis[];
}

export interface BuildCriMetaReadinessReportOptions {
  presets?: typeof CRI_PLAYTEST_DECKS;
  batch?: MatchBatchOptions;
  includeSimHealth?: boolean;
}

export function buildCriMetaReadinessReport(
  options: BuildCriMetaReadinessReportOptions = {},
): CriMetaReadinessReport {
  const presets = options.presets ?? CRI_PLAYTEST_DECKS;
  const analyses = presets.map((preset) => analyzeCriDeck(preset));
  const analysis = summarizeCriPlaytestAnalysis(analyses);
  const trainerCoverage = summarizeCriTrainerCoverage(presets);
  const focusExpansion = summarizeFocusExpansion();

  const simHealth = options.includeSimHealth === false
    ? {
        matchups: [],
        totalGames: 0,
        stallRate: 0,
        completionRate: 0,
        setupFailureRate: 0,
        drawsByStall: 0,
        drawsByCap: 0,
      }
    : summarizeSimHealth(
        runPresetMatrix(presets, {
          seeds: options.batch?.seeds ?? CI_BATCH_SEEDS,
          setup: options.batch?.setup ?? DEFAULT_PLAYTEST_SETUP,
          run: options.batch?.run ?? DEFAULT_PLAYTEST_RUN,
        }),
      );

  const deckTierList =
    simHealth.matchups.length > 0 ? computeDeckTierList(presets, simHealth.matchups) : [];
  const trainerStubCounts = listCriTrainerStubCounts(analyses);

  return {
    analysis,
    trainerCoverage,
    focusExpansion,
    simHealth,
    deckTierList,
    trainerStubCounts,
    analyses,
  };
}

export function formatCriMetaReadinessReport(report: CriMetaReadinessReport): string {
  const { analysis, trainerCoverage, focusExpansion, simHealth, deckTierList, trainerStubCounts, analyses } =
    report;
  const lines: string[] = [
    "# Chaos Rising Meta Readiness Report",
    "",
    `Tournament: ${analysis.tournamentName}`,
    `Decks: ${analysis.deckCount} | Archetypes: ${analysis.uniqueArchetypes.join(", ")}`,
    `Pokémon corpus: ${analysis.pokemonCardsResolved} resolved, ${analysis.pokemonCardsMissing} missing lines`,
    `Signature effects: ${analysis.signatureEffects.engineReady}/${analysis.signatureEffects.total} engine-ready`,
    `Trainer staples: ${trainerCoverage.engineReady}/${trainerCoverage.stapleCount} engine-ready`,
    `CRI expansion gaps: ${focusExpansion.signatureGaps.length} unimplemented signature texts`,
    "",
    "## Static analysis — per deck",
  ];

  for (const deckAnalysis of analyses) {
    lines.push(
      `### ${deckAnalysis.label}`,
      `- Archetype: ${deckAnalysis.deckName}`,
      `- Pokémon: ${deckAnalysis.corpus.pokemonResolved}/${deckAnalysis.sections.Pokémon} in corpus`,
    );
    if (deckAnalysis.signatureEffects.length > 0) {
      lines.push("- Signatures:");
      for (const effect of deckAnalysis.signatureEffects) {
        const ready = CRI_ENGINE_READY_SIGNATURES.has(effect.effectName) ? "engine ✓" : "engine ✗";
        lines.push(
          `  - ${effect.cardName}: ${effect.effectName} (${effect.kind}): parse=${effect.parseCoverage}, impl=${effect.implementationCoverage}, ${ready}`,
        );
      }
    } else {
      lines.push("- Signatures: (none mapped)");
    }
    lines.push("");
  }

  if (analysis.signatureEffects.gaps.length > 0) {
    lines.push("## Signature implementation gaps");
    for (const gap of analysis.signatureEffects.gaps) {
      lines.push(`- ${gap.deckName}: ${gap.effectName} (${gap.implementationCoverage})`);
    }
    lines.push("");
  }

  if (trainerCoverage.gaps.length > 0) {
    lines.push("## Trainer staple gaps");
    for (const gap of trainerCoverage.gaps) {
      lines.push(`- ${gap.deckName}: ${gap.cardName} (${gap.implementationCoverage})`);
    }
    lines.push("");
  }

  if (focusExpansion.signatureGaps.length > 0) {
    lines.push("## CRI expansion signature gaps (corpus)");
    for (const gap of focusExpansion.signatureGaps.slice(0, 12)) {
      lines.push(
        `- ${gap.cardName} (${gap.set}-${gap.number}): ${gap.effectName} — ${gap.implementationCoverage}`,
      );
    }
    if (focusExpansion.signatureGaps.length > 12) {
      lines.push(`- … and ${focusExpansion.signatureGaps.length - 12} more`);
    }
    lines.push("");
  }

  lines.push("## Trainer stub counts (non-corpus trainer lines)");
  for (const entry of trainerStubCounts) {
    lines.push(`- ${entry.deckName}: ${entry.trainerStubCards} stub trainer cards`);
  }
  lines.push("");

  lines.push("## Auto-play sim health");
  if (simHealth.totalGames === 0) {
    lines.push("(sim health not collected)");
  } else {
    lines.push(
      `Games: ${simHealth.totalGames} | Completion: ${Math.round(simHealth.completionRate * 100)}% | Stalls: ${Math.round(simHealth.stallRate * 100)}% | Setup failures: ${Math.round(simHealth.setupFailureRate * 100)}%`,
      "",
      "| Matchup | Games | P1 win rate | Stalls | Avg turns |",
      "| --- | ---: | --- | ---: | ---: |",
    );
    for (const matchup of simHealth.matchups) {
      const label =
        matchup.p1PresetId === matchup.p2PresetId
          ? `${matchup.p1DeckName} mirror`
          : `${matchup.p1DeckName} vs ${matchup.p2DeckName}`;
      lines.push(
        `| ${label} | ${matchup.games} | ${formatWinRate(matchup.p1Wins, matchup.p2Wins)} | ${matchup.stalls} | ${matchup.avgTurnCount.toFixed(1)} |`,
      );
    }

    if (deckTierList.length > 0) {
      lines.push(
        "",
        "## Deck tier list (auto-play aggregate)",
        "",
        "| Deck | Games | Win rate | W-L-D |",
        "| --- | ---: | ---: | --- |",
      );
      for (const tier of deckTierList) {
        lines.push(
          `| ${tier.deckName} | ${tier.games} | ${Math.round(tier.winRate * 100)}% | ${tier.wins}-${tier.losses}-${tier.draws} |`,
        );
      }
    }
  }

  lines.push(
    "",
    "## Engine-ready allowlists",
    `- Signatures (${CRI_ENGINE_READY_SIGNATURES.size}): ${[...CRI_ENGINE_READY_SIGNATURES].sort().join(", ")}`,
    `- Trainers (${CRI_ENGINE_READY_TRAINERS.size}): ${[...CRI_ENGINE_READY_TRAINERS].sort().join(", ")}`,
  );

  return lines.join("\n");
}
