import type { EffectTextRecord, StandardCardIndex } from "./prepareStandardCorpus";
import { getStandardEffectText, getStandardCardsBySet } from "./loadStandardCorpus";
import { FOCUS_EXPANSION, type StandardExpansion } from "./standardExpansions";

export interface FocusEffectGap {
  textId: string;
  kind: EffectTextRecord["kind"];
  effectName: string;
  cardName: string;
  set: string;
  number: string;
  text: string;
  parseCoverage: EffectTextRecord["coverage"];
  implementationCoverage: EffectTextRecord["implementationCoverage"];
}

export interface FocusExpansionSummary {
  expansion: StandardExpansion;
  cardsInCorpus: number;
  cardsWithAbilities: number;
  signatureGaps: FocusEffectGap[];
  unimplementedCount: number;
}

function collectEffectGapsForCard(card: StandardCardIndex): FocusEffectGap[] {
  const gaps: FocusEffectGap[] = [];

  for (const attack of card.attacks) {
    const record = getStandardEffectText(attack.textId);
    if (!record || record.coverage === "full" || record.coverage === "empty") continue;
    if (record.implementationCoverage === "implemented") continue;
    gaps.push({
      textId: attack.textId,
      kind: "attack",
      effectName: attack.name,
      cardName: card.name,
      set: card.set,
      number: card.number,
      text: attack.text,
      parseCoverage: record.coverage,
      implementationCoverage: record.implementationCoverage ?? "unknown",
    });
  }

  for (const ability of card.abilities) {
    const record = getStandardEffectText(ability.textId);
    if (!record || record.coverage === "full" || record.coverage === "empty") continue;
    if (record.implementationCoverage === "implemented") continue;
    gaps.push({
      textId: ability.textId,
      kind: "ability",
      effectName: ability.name,
      cardName: card.name,
      set: card.set,
      number: card.number,
      text: ability.text,
      parseCoverage: record.coverage,
      implementationCoverage: record.implementationCoverage ?? "unknown",
    });
  }

  return gaps;
}

export function getStandardCardsByPtcgoCode(ptcgoCode: string): StandardCardIndex[] {
  return getStandardCardsBySet(ptcgoCode);
}

export function summarizeFocusExpansion(
  expansion: StandardExpansion = FOCUS_EXPANSION,
): FocusExpansionSummary {
  const cards = getStandardCardsByPtcgoCode(expansion.ptcgoCode);
  const gapMap = new Map<string, FocusEffectGap>();

  for (const card of cards) {
    for (const gap of collectEffectGapsForCard(card)) {
      gapMap.set(`${gap.kind}:${gap.textId}`, gap);
    }
  }

  const signatureGaps = [...gapMap.values()].sort((a, b) =>
    a.effectName.localeCompare(b.effectName),
  );

  return {
    expansion,
    cardsInCorpus: cards.length,
    cardsWithAbilities: cards.filter((card) => card.abilities.length > 0).length,
    signatureGaps,
    unimplementedCount: signatureGaps.length,
  };
}

/**
 * Chaos Rising (CRI) set has 122 cards in pokemontcg.io; the Standard Pokémon corpus
 * indexes 119 — slots 84–86 are Special Energy (Bubbly Water, Magnetic Metal, Nitro Fire)
 * and are excluded from `STANDARD_FORMAT.pokemonQuery`.
 */
export const CRI_SET_PRINTED_TOTAL = 122;
export const CRI_POKEMON_CORPUS_COUNT = 119;
export const CRI_SPECIAL_ENERGY_NUMBERS = ["84", "85", "86"] as const;

/** CRI Mega/ex lines to prioritize in playtests (unique card numbers, newest expansion). */
export const CHAOS_RISING_SIGNATURES = [
  { card: "Mega Greninja ex", number: "22", attack: "Ninja Spinner", ability: "Mortal Shuriken" },
  { card: "Mega Floette ex", number: "35", attack: "Eternity Bloom" },
  { card: "Mega Pyroar ex", number: "15", attack: "Fiery Big Bang" },
  { card: "Mega Dragalge ex", number: "65", attack: "Pernicious Poison" },
  { card: "Mega Gallade ex", number: "48", attack: "Marvelous Edge" },
] as const;
