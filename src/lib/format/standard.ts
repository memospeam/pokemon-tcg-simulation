import type { CardDefinition } from "../models/definition";

/** Play! Pokémon Standard (2026 season): G rotated out; H/I/J legal. */
export const STANDARD_REGULATION_MARKS = ["H", "I", "J"] as const;

export type StandardRegulationMark = (typeof STANDARD_REGULATION_MARKS)[number];

export const STANDARD_FORMAT = {
  name: "Standard",
  season: "2025-26 / 2026 rotation",
  effectiveFrom: "2026-04-10",
  regulationMarks: STANDARD_REGULATION_MARKS,
  /** Lucene query for pokemontcg.io — Pokémon only (attacks/abilities). */
  pokemonQuery:
    'supertype:Pokémon (regulationMark:H OR regulationMark:I OR regulationMark:J)',
  /** Lucene query for pokemontcg.io — Trainers (effect text in rules[]). */
  trainerQuery:
    'supertype:Trainer (regulationMark:H OR regulationMark:I OR regulationMark:J)',
} as const;

export function isStandardRegulationMark(mark: string | undefined): mark is StandardRegulationMark {
  return !!mark && (STANDARD_REGULATION_MARKS as readonly string[]).includes(mark);
}

export function isStandardLegalCard(def: Pick<CardDefinition, "regulationMark">): boolean {
  return isStandardRegulationMark(def.regulationMark);
}
