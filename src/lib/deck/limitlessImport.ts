import type { TournamentDeckPreset, TournamentPresetBundle } from "./tournamentPresets";
import { validateDeckTextAgainstCorpus } from "./corpusDeckBuilder";

export interface LimitlessImportOptions {
  /** Only keep decks whose text references this set code (e.g. CRI). */
  setCode?: string;
  /** Only keep decks whose title or text matches this substring. */
  deckNameIncludes?: string;
}

export function filterLimitlessDecks(
  bundle: TournamentPresetBundle,
  options: LimitlessImportOptions = {},
): TournamentDeckPreset[] {
  const setNeedle = options.setCode?.toUpperCase();
  const nameNeedle = options.deckNameIncludes?.toLowerCase();

  return bundle.decks.filter((deck) => {
    if (nameNeedle) {
      const haystack = `${deck.deckName} ${deck.text}`.toLowerCase();
      if (!haystack.includes(nameNeedle)) return false;
    }
    if (setNeedle && !deck.text.toUpperCase().includes(` ${setNeedle} `)) {
      return false;
    }
    return true;
  });
}

export function validateLimitlessPreset(deck: TournamentDeckPreset): {
  preset: TournamentDeckPreset;
  corpus: ReturnType<typeof validateDeckTextAgainstCorpus>;
} {
  return {
    preset: deck,
    corpus: validateDeckTextAgainstCorpus(deck.text),
  };
}

export function summarizeLimitlessImport(
  bundle: TournamentPresetBundle,
  options: LimitlessImportOptions = {},
): {
  sourceUrl: string;
  matchedDecks: number;
  fullyResolved: number;
  gaps: Array<{ id: string; label: string; missing: string[] }>;
} {
  const decks = filterLimitlessDecks(bundle, options);
  const gaps: Array<{ id: string; label: string; missing: string[] }> = [];
  let fullyResolved = 0;

  for (const deck of decks) {
    const result = validateDeckTextAgainstCorpus(deck.text);
    if (result.pokemonMissing.length === 0 && result.missing.length === 0) {
      fullyResolved += 1;
    } else {
      gaps.push({
        id: deck.id,
        label: deck.label,
        missing: [...result.pokemonMissing, ...result.missing],
      });
    }
  }

  return {
    sourceUrl: bundle.sourceUrl,
    matchedDecks: decks.length,
    fullyResolved,
    gaps,
  };
}

export function mergeLimitlessIntoPresets(
  base: TournamentDeckPreset[],
  imported: TournamentDeckPreset[],
): TournamentDeckPreset[] {
  const seen = new Set(base.map((deck) => deck.id));
  const merged = [...base];
  for (const deck of imported) {
    if (seen.has(deck.id)) continue;
    merged.push(deck);
    seen.add(deck.id);
  }
  return merged;
}
