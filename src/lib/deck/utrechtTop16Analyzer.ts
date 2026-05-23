import type { ImplementationCoverage, ParseCoverage } from "../format/effectCoverage";
import { getStandardEffectText } from "../format/loadStandardCorpus";
import type { StandardCardIndex } from "../format/prepareStandardCorpus";
import { findCorpusCard } from "./corpusDeckBuilder";
import { parseLimitlessDeckList, type DeckSection } from "./limitlessParser";
import { UTRECHT_535_TOP16, type TournamentDeckPreset } from "./tournamentPresets";

export interface DeckEffectEntry {
  cardName: string;
  effectName: string;
  kind: "attack" | "ability";
  textId: string;
  parseCoverage: ParseCoverage;
  implementationCoverage: ImplementationCoverage;
  deckCopies: number;
  isSignature: boolean;
}

export interface TournamentDeckAnalysis {
  id: string;
  label: string;
  deckName: string;
  placement: number;
  parseErrors: string[];
  sections: Record<DeckSection, number>;
  corpus: {
    pokemonResolved: number;
    pokemonMissing: string[];
    nonPokemonMissing: number;
    totalCards: number;
  };
  effects: DeckEffectEntry[];
  signatureEffects: DeckEffectEntry[];
  coverageStats: Record<ImplementationCoverage, number>;
}

export interface Top16AnalysisSummary {
  tournamentName: string;
  deckCount: number;
  uniqueArchetypes: string[];
  pokemonCardsResolved: number;
  pokemonCardsMissing: number;
  signatureEffects: {
    total: number;
    engineReady: number;
    gaps: Array<{ deckName: string; effectName: string; implementationCoverage: ImplementationCoverage }>;
  };
}

/** Signature mechanics we expect to smoke-test per Utrecht archetype. */
export const ARCHETYPE_SIGNATURES: Record<string, { attacks?: string[]; abilities?: string[] }> = {
  "Lopunny Dudunsparce": { attacks: ["Gale Thrust"] },
  Dragapult: { attacks: ["Phantom Dive"], abilities: ["Adrena-Brain"] },
  "Dragapult Dusknoir": { attacks: ["Phantom Dive"], abilities: ["Adrena-Brain", "Cursed Blast"] },
  "Dragapult Dudunsparce": { attacks: ["Phantom Dive"], abilities: ["Adrena-Brain"] },
  "Rocket's Honchkrow": { attacks: ["Rocket Feathers"] },
  "Ogerpon Box": { attacks: ["Myriad Leaf Shower"], abilities: ["Teal Dance"] },
  "N's Zoroark": { attacks: ["Night Joker"], abilities: ["Trade"] },
  "Alakazam Dudunsparce": { attacks: ["Powerful Hand"], abilities: ["Psychic Draw"] },
  "Cynthia's Garchomp": { attacks: ["Corkscrew Dive"], abilities: ["Champion's Call"] },
  Greninja: { attacks: ["Shinobi Blade", "Mirage Barrage"] },
  Hydrapple: { attacks: ["Syrup Storm"], abilities: ["Ripening Charge"] },
};

/** Effects with reducer smoke coverage (Batches 13–16 + meta playtests). */
export const ENGINE_READY_SIGNATURES = new Set([
  "Gale Thrust",
  "Phantom Dive",
  "Adrena-Brain",
  "Ripening Charge",
  "Syrup Storm",
  "Hydra Breath",
  "Corkscrew Dive",
  "Strange Hacking",
  "Champion's Call",
  "Rocket Feathers",
  "Myriad Leaf Shower",
  "Teal Dance",
  "Night Joker",
  "Trade",
  "Powerful Hand",
  "Mirage Barrage",
  "Shinobi Blade",
  "Cursed Blast",
  "Psychic Draw",
]);

function isSignatureEffect(
  deckName: string,
  kind: "attack" | "ability",
  effectName: string,
): boolean {
  const sig = ARCHETYPE_SIGNATURES[deckName];
  if (!sig) return false;
  return kind === "attack"
    ? (sig.attacks?.includes(effectName) ?? false)
    : (sig.abilities?.includes(effectName) ?? false);
}

function collectEffectsForCard(
  card: StandardCardIndex,
  deckCopies: number,
  deckName: string,
): DeckEffectEntry[] {
  const entries: DeckEffectEntry[] = [];

  for (const attack of card.attacks) {
    const record = getStandardEffectText(attack.textId);
    entries.push({
      cardName: card.name,
      effectName: attack.name,
      kind: "attack",
      textId: attack.textId,
      parseCoverage: record?.coverage ?? "none",
      implementationCoverage: record?.implementationCoverage ?? "unknown",
      deckCopies,
      isSignature: isSignatureEffect(deckName, "attack", attack.name),
    });
  }

  for (const ability of card.abilities) {
    const record = getStandardEffectText(ability.textId);
    entries.push({
      cardName: card.name,
      effectName: ability.name,
      kind: "ability",
      textId: ability.textId,
      parseCoverage: record?.coverage ?? "none",
      implementationCoverage: record?.implementationCoverage ?? "unknown",
      deckCopies,
      isSignature: isSignatureEffect(deckName, "ability", ability.name),
    });
  }

  return entries;
}

function emptyCoverageStats(): Record<ImplementationCoverage, number> {
  return {
    implemented: 0,
    stub: 0,
    partial_stub: 0,
    unknown: 0,
    empty: 0,
  };
}

export function analyzeTournamentDeck(deck: TournamentDeckPreset): TournamentDeckAnalysis {
  const parsed = parseLimitlessDeckList(deck.text);
  const sections: Record<DeckSection, number> = {
    Pokémon: parsed.sections.Pokémon ?? 0,
    Trainer: parsed.sections.Trainer ?? 0,
    Energy: parsed.sections.Energy ?? 0,
  };

  const pokemonMissing: string[] = [];
  let pokemonResolved = 0;
  let nonPokemonMissing = 0;
  let totalCards = 0;
  const effectMap = new Map<string, DeckEffectEntry>();
  const coverageStats = emptyCoverageStats();

  for (const line of parsed.lines) {
    totalCards += line.count;
    if (!line.setCode || !line.number) {
      if (line.section === "Pokémon") {
        pokemonMissing.push(`${line.count} ${line.name} (no set/number)`);
      } else {
        nonPokemonMissing += line.count;
      }
      continue;
    }

    const match = findCorpusCard(line.setCode, line.number, line.name);
    if (!match) {
      if (line.section === "Pokémon") {
        pokemonMissing.push(`${line.count} ${line.name} ${line.setCode} ${line.number}`);
      } else {
        nonPokemonMissing += line.count;
      }
      continue;
    }

    if (line.section === "Pokémon") {
      pokemonResolved += line.count;
      for (const entry of collectEffectsForCard(match, line.count, deck.deckName)) {
        const key = `${entry.kind}:${entry.textId}`;
        const existing = effectMap.get(key);
        if (existing) {
          existing.deckCopies += line.count;
        } else {
          effectMap.set(key, entry);
          coverageStats[entry.implementationCoverage] += 1;
        }
      }
    } else {
      nonPokemonMissing += line.count;
    }
  }

  const effects = [...effectMap.values()].sort((a, b) => {
    if (a.isSignature !== b.isSignature) return a.isSignature ? -1 : 1;
    return a.effectName.localeCompare(b.effectName);
  });
  const signatureEffects = effects.filter((entry) => entry.isSignature);

  return {
    id: deck.id,
    label: deck.label,
    deckName: deck.deckName,
    placement: deck.placement,
    parseErrors: parsed.errors,
    sections,
    corpus: {
      pokemonResolved,
      pokemonMissing,
      nonPokemonMissing,
      totalCards,
    },
    effects,
    signatureEffects,
    coverageStats,
  };
}

export function analyzeAllUtrechtTop16(): TournamentDeckAnalysis[] {
  return UTRECHT_535_TOP16.decks.map(analyzeTournamentDeck);
}

export function summarizeTop16Analysis(analyses: TournamentDeckAnalysis[]): Top16AnalysisSummary {
  const uniqueArchetypes = [...new Set(analyses.map((analysis) => analysis.deckName))].sort();
  const gaps: Top16AnalysisSummary["signatureEffects"]["gaps"] = [];
  let engineReady = 0;
  let signatureTotal = 0;

  for (const analysis of analyses) {
    for (const effect of analysis.signatureEffects) {
      signatureTotal += 1;
      if (ENGINE_READY_SIGNATURES.has(effect.effectName)) {
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
    tournamentName: UTRECHT_535_TOP16.name,
    deckCount: analyses.length,
    uniqueArchetypes,
    pokemonCardsResolved: analyses.reduce((sum, analysis) => sum + analysis.corpus.pokemonResolved, 0),
    pokemonCardsMissing: analyses.reduce(
      (sum, analysis) => sum + analysis.corpus.pokemonMissing.length,
      0,
    ),
    signatureEffects: {
      total: signatureTotal,
      engineReady,
      gaps: dedupeGaps(gaps),
    },
  };
}

function dedupeGaps(
  gaps: Top16AnalysisSummary["signatureEffects"]["gaps"],
): Top16AnalysisSummary["signatureEffects"]["gaps"] {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = `${gap.deckName}:${gap.effectName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatTop16AnalysisReport(
  summary: Top16AnalysisSummary,
  analyses: TournamentDeckAnalysis[],
): string {
  const lines: string[] = [
    `# Utrecht Top 16 Playtest Analysis`,
    ``,
    `Tournament: ${summary.tournamentName}`,
    `Decks: ${summary.deckCount} | Archetypes: ${summary.uniqueArchetypes.length}`,
    `Pokémon corpus: ${summary.pokemonCardsResolved} resolved, ${summary.pokemonCardsMissing} missing lines`,
    `Signature effects: ${summary.signatureEffects.engineReady}/${summary.signatureEffects.total} engine-ready`,
    ``,
    `## Per deck`,
  ];

  for (const analysis of analyses) {
    lines.push(
      `### ${analysis.label}`,
      `- Archetype: ${analysis.deckName}`,
      `- Pokémon: ${analysis.corpus.pokemonResolved}/${analysis.sections.Pokémon} in corpus`,
    );
    if (analysis.corpus.pokemonMissing.length > 0) {
      lines.push(`- Missing: ${analysis.corpus.pokemonMissing.join("; ")}`);
    }
    if (analysis.signatureEffects.length > 0) {
      lines.push(`- Signatures:`);
      for (const effect of analysis.signatureEffects) {
        const ready = ENGINE_READY_SIGNATURES.has(effect.effectName) ? "engine ✓" : "engine ✗";
        lines.push(
          `  - ${effect.cardName}: ${effect.effectName} (${effect.kind}): parse=${effect.parseCoverage}, impl=${effect.implementationCoverage}, ${ready}`,
        );
      }
    } else {
      lines.push(`- Signatures: (none mapped)`);
    }
    lines.push(``);
  }

  if (summary.signatureEffects.gaps.length > 0) {
    lines.push(`## Implementation gaps (signatures not engine-ready)`);
    for (const gap of summary.signatureEffects.gaps) {
      if (ENGINE_READY_SIGNATURES.has(gap.effectName)) continue;
      lines.push(`- ${gap.deckName}: ${gap.effectName} (${gap.implementationCoverage})`);
    }
  }

  return lines.join("\n");
}
