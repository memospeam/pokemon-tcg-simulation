import { CardResolver, enrichEvolutionChainDefinitions, expandResolvedDeck } from "../catalog";
import type { CardDefinition } from "../models/definition";
import { parseLimitlessDeckList, type ParsedDeckLine } from "./limitlessParser";
import { validateDeck, type DeckValidationResult } from "./validator";

export interface BuiltDeck {
  id: string;
  name: string;
  text: string;
  lines: ParsedDeckLine[];
  cards: CardDefinition[];
  definitions: Map<string, CardDefinition>;
  validation: DeckValidationResult;
  resolveErrors: string[];
}

export async function buildDeckFromText(name: string, text: string): Promise<BuiltDeck> {
  const parsed = parseLimitlessDeckList(text);
  const resolver = new CardResolver();
  const results = await resolver.resolveLines(
    parsed.lines.map((line) => ({
      count: line.count,
      name: line.name,
      setCode: line.setCode,
      number: line.number,
    })),
  );

  const { definitions, cards, errors } = expandResolvedDeck(results);
  await enrichEvolutionChainDefinitions(definitions, resolver);
  const validation = validateDeck(cards);

  return {
    id: crypto.randomUUID(),
    name,
    text,
    lines: parsed.lines,
    cards,
    definitions,
    validation,
    resolveErrors: [
      ...parsed.errors,
      ...errors.map((entry) => entry.error ?? "Unknown resolve error"),
    ],
  };
}

export function summarizeDeck(deck: BuiltDeck): string {
  const grouped = new Map<string, number>();
  for (const card of deck.cards) {
    grouped.set(card.name, (grouped.get(card.name) ?? 0) + 1);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${count} ${name}`)
    .join("\n");
}
