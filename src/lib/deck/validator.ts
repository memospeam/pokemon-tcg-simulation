import type { CardDefinition } from "../models/definition";
import {
  deckCopyKey,
  isAceSpec,
  isBasicEnergy,
  isBasicPokemon,
  isRadiant,
} from "../models/definition";

export interface DeckValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface DeckValidationResult {
  valid: boolean;
  totalCards: number;
  issues: DeckValidationIssue[];
}

export function validateDeck(cards: CardDefinition[]): DeckValidationResult {
  const issues: DeckValidationIssue[] = [];
  const totalCards = cards.length;
  const copyCounts = new Map<string, { count: number; name: string }>();

  if (totalCards !== 60) {
    issues.push({
      level: "error",
      message: `Deck must contain exactly 60 cards (found ${totalCards}).`,
    });
  }

  let basicPokemonCount = 0;
  let aceSpecCount = 0;
  let radiantCount = 0;

  for (const card of cards) {
    const key = deckCopyKey(card);
    const existing = copyCounts.get(key) ?? { count: 0, name: card.name };
    existing.count += 1;
    copyCounts.set(key, existing);

    if (isBasicPokemon(card)) basicPokemonCount += 1;
    if (isAceSpec(card)) aceSpecCount += 1;
    if (isRadiant(card)) radiantCount += 1;
  }

  for (const { count, name } of copyCounts.values()) {
    const card = cards.find((entry) => entry.name === name);
    const maxCopies = card && isBasicEnergy(card) ? Infinity : 4;
    if (count > maxCopies) {
      issues.push({
        level: "error",
        message: `${name}: max 4 copies allowed (found ${count}).`,
      });
    }
  }

  if (basicPokemonCount === 0) {
    issues.push({
      level: "error",
      message: "Deck must include at least one Basic Pokémon.",
    });
  }

  if (aceSpecCount > 1) {
    issues.push({
      level: "warning",
      message: "Deck should contain at most one ACE SPEC card.",
    });
  }

  if (radiantCount > 1) {
    issues.push({
      level: "warning",
      message: "Deck should contain at most one Radiant Pokémon.",
    });
  }

  return {
    valid: issues.every((issue) => issue.level !== "error"),
    totalCards,
    issues,
  };
}
