import type { ImplementationCoverage, ParseCoverage } from "../format/effectCoverage";
import { CHAOS_RISING_SIGNATURES } from "../format/standardFocus";
import { parseTrainerText } from "../engine/effects/trainerText";
import { isTrainerKindImplemented } from "../engine/effects/trainerCoverage";
import type { BuiltDeck } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import {
  analyzeTournamentDeck,
  type Top16AnalysisSummary,
  type TournamentDeckAnalysis,
} from "./utrechtTop16Analyzer";
import { CRI_PLAYTEST_DECKS } from "./criDeckPresets";
import type { TournamentDeckPreset } from "./tournamentPresets";

/** Signature mechanics to smoke-test per CRI archetype. */
export const CRI_ARCHETYPE_SIGNATURES: Record<string, { attacks?: string[]; abilities?: string[] }> = {
  "Mega Greninja ex": { attacks: ["Ninja Spinner"], abilities: ["Mortal Shuriken"] },
  "Mega Floette ex": { attacks: ["Eternity Bloom", "Gentle Light"] },
  "Mega Pyroar ex": { attacks: ["Fiery Big Bang", "Ferocious Bellow"] },
  "Mega Dragalge ex": { attacks: ["Pernicious Poison", "Corrosive Liquid"] },
  "Mega Gallade ex": { attacks: ["Marvelous Edge", "Gale Slash"] },
};

/** CRI signature effects with reducer smoke coverage. */
export const CRI_ENGINE_READY_SIGNATURES = new Set([
  "Ninja Spinner",
  "Mortal Shuriken",
  "Gentle Light",
  "Eternity Bloom",
  "Ferocious Bellow",
  "Fiery Big Bang",
  "Corrosive Liquid",
  "Pernicious Poison",
  "Gale Slash",
  "Marvelous Edge",
]);

/** T1 trainer staples used across CRI playtest lists. */
export const CRI_TRAINER_STAPLES = [
  "Lillie's Determination",
  "Boss's Orders",
  "Ultra Ball",
  "Buddy-Buddy Poffin",
  "Crispin",
  "Night Stretcher",
  "Rare Candy",
  "Poké Pad",
  "Judge",
  "Professor's Research",
] as const;

/** Trainers verified via parsed rules or legacy engine paths in CRI smokes. */
export const CRI_ENGINE_READY_TRAINERS = new Set<string>([
  "Lillie's Determination",
  "Boss's Orders",
  "Ultra Ball",
  "Buddy-Buddy Poffin",
  "Crispin",
  "Night Stretcher",
  "Rare Candy",
  "Poké Pad",
  "Judge",
  "Professor's Research",
]);

export interface CriTrainerCoverageEntry {
  cardName: string;
  deckCopies: number;
  parseCoverage: ParseCoverage;
  implementationCoverage: ImplementationCoverage;
  engineReady: boolean;
  effectKinds: string[];
}

function isTrainerEngineReady(def: import("../models/definition").CardDefinition): boolean {
  if (CRI_ENGINE_READY_TRAINERS.has(def.name)) return true;
  const parsed = parseTrainerText(def);
  if (parsed.effects.length === 0) return false;
  return parsed.effects.every((effect) => isTrainerKindImplemented(effect.kind));
}

export function analyzeCriTrainerStaples(deck: BuiltDeck): CriTrainerCoverageEntry[] {
  const counts = new Map<string, number>();
  for (const card of deck.cards) {
    if (card.supertype !== "Trainer") continue;
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }

  const entries: CriTrainerCoverageEntry[] = [];
  for (const staple of CRI_TRAINER_STAPLES) {
    const copies = counts.get(staple) ?? 0;
    if (copies === 0) continue;
    const def = [...deck.definitions.values()].find((entry) => entry.name === staple);
    if (!def) continue;
    const parsed = parseTrainerText(def);
    entries.push({
      cardName: staple,
      deckCopies: copies,
      parseCoverage: parsed.parseCoverage,
      implementationCoverage: parsed.implementationCoverage,
      engineReady: isTrainerEngineReady(def),
      effectKinds: parsed.effects.map((effect) => effect.kind),
    });
  }
  return entries;
}

export function analyzeCriTrainerStaplesForPreset(deck: TournamentDeckPreset): CriTrainerCoverageEntry[] {
  return analyzeCriTrainerStaples(buildPlaytestDeckFromCorpusText(deck.label, deck.text));
}

export function summarizeCriTrainerCoverage(
  presets: TournamentDeckPreset[] = CRI_PLAYTEST_DECKS,
): {
  stapleCount: number;
  engineReady: number;
  gaps: Array<{ deckName: string; cardName: string; implementationCoverage: ImplementationCoverage }>;
} {
  const gaps: Array<{ deckName: string; cardName: string; implementationCoverage: ImplementationCoverage }> =
    [];
  let engineReady = 0;
  let stapleCount = 0;

  for (const preset of presets) {
    for (const entry of analyzeCriTrainerStaplesForPreset(preset)) {
      stapleCount += 1;
      if (entry.engineReady) {
        engineReady += 1;
      } else {
        gaps.push({
          deckName: preset.deckName,
          cardName: entry.cardName,
          implementationCoverage: entry.implementationCoverage,
        });
      }
    }
  }

  return { stapleCount, engineReady, gaps };
}

export function analyzeCriDeck(deck: TournamentDeckPreset): TournamentDeckAnalysis {
  return analyzeTournamentDeck(deck, CRI_ARCHETYPE_SIGNATURES);
}

export function analyzeAllCriPlaytestDecks(): TournamentDeckAnalysis[] {
  return CRI_PLAYTEST_DECKS.map(analyzeCriDeck);
}

export function summarizeCriPlaytestAnalysis(
  analyses: TournamentDeckAnalysis[] = analyzeAllCriPlaytestDecks(),
): Top16AnalysisSummary & { focusSignatures: typeof CHAOS_RISING_SIGNATURES } {
  const gaps: Top16AnalysisSummary["signatureEffects"]["gaps"] = [];
  let engineReady = 0;
  let signatureTotal = 0;

  for (const analysis of analyses) {
    for (const effect of analysis.signatureEffects) {
      signatureTotal += 1;
      if (CRI_ENGINE_READY_SIGNATURES.has(effect.effectName)) {
        engineReady += 1;
      } else if (effect.implementationCoverage !== "implemented") {
        gaps.push({
          deckName: analysis.deckName,
          effectName: effect.effectName,
          implementationCoverage: effect.implementationCoverage,
        });
      }
    }
  }

  return {
    tournamentName: "Chaos Rising playtest presets",
    deckCount: analyses.length,
    uniqueArchetypes: [...new Set(analyses.map((analysis) => analysis.deckName))].sort(),
    pokemonCardsResolved: analyses.reduce((sum, a) => sum + a.corpus.pokemonResolved, 0),
    pokemonCardsMissing: analyses.reduce((sum, a) => sum + a.corpus.pokemonMissing.length, 0),
    signatureEffects: {
      total: signatureTotal,
      engineReady,
      gaps,
    },
    focusSignatures: CHAOS_RISING_SIGNATURES,
  };
}

export function listCriTrainerStubCounts(
  analyses: TournamentDeckAnalysis[] = analyzeAllCriPlaytestDecks(),
): { deckName: string; trainerStubCards: number }[] {
  return analyses.map((analysis) => ({
    deckName: analysis.deckName,
    trainerStubCards: analysis.corpus.nonPokemonMissing,
  }));
}

export function collectCriImplementationGaps(
  analyses: TournamentDeckAnalysis[] = analyzeAllCriPlaytestDecks(),
): Array<{ deckName: string; effectName: string; coverage: ImplementationCoverage }> {
  const gaps: Array<{ deckName: string; effectName: string; coverage: ImplementationCoverage }> = [];
  for (const analysis of analyses) {
    for (const effect of analysis.signatureEffects) {
      if (effect.implementationCoverage !== "implemented") {
        gaps.push({
          deckName: analysis.deckName,
          effectName: effect.effectName,
          coverage: effect.implementationCoverage,
        });
      }
    }
  }
  return gaps;
}
