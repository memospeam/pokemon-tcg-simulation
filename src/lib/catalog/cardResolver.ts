import type { CardDefinition } from "../models/definition";
import { cacheByLookupKey, getCachedByLookupKey } from "./cache";
import { createDefaultClient, PokemonTcgClient } from "./pokemontcgClient";
import { normalizeSetCode } from "./setCodeMap";
import type { ResolveLineInput, ResolveLineResult } from "./types";

function lookupKey(input: ResolveLineInput): string {
  const setCode = normalizeSetCode(input.setCode);
  return [input.name.toLowerCase(), setCode ?? "", input.number ?? ""].join("|");
}

function pickBestMatch(cards: CardDefinition[], input: ResolveLineInput): CardDefinition | undefined {
  if (cards.length === 0) return undefined;
  if (cards.length === 1) return cards[0];

  const setCode = normalizeSetCode(input.setCode);
  if (setCode && input.number) {
    const exact = cards.find(
      (card) =>
        card.set.ptcgoCode?.toUpperCase() === setCode &&
        card.number === input.number &&
        card.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (exact) return exact;
  }

  const byName = cards.find((card) => card.name.toLowerCase() === input.name.toLowerCase());
  return byName ?? cards[0];
}

export class CardResolver {
  constructor(private readonly client: PokemonTcgClient = createDefaultClient()) {}

  async resolveLine(input: ResolveLineInput): Promise<ResolveLineResult> {
    const key = lookupKey(input);
    const cached = await getCachedByLookupKey(key);
    if (cached) {
      return { input, definition: cached };
    }

    const setCode = normalizeSetCode(input.setCode);
    const queries = [
      this.client.buildExactQuery(input.name, setCode, input.number),
      setCode ? this.client.buildExactQuery(input.name, setCode) : null,
      this.client.buildExactQuery(input.name),
    ].filter(Boolean) as string[];

    for (const query of queries) {
      try {
        const cards = await this.client.searchCards(query);
        const match = pickBestMatch(cards, input);
        if (match) {
          await cacheByLookupKey(key, match);
          return { input, definition: match };
        }
      } catch {
        continue;
      }
    }

    return {
      input,
      error: `Could not resolve: ${input.count} ${input.name}${setCode ? ` ${setCode}` : ""}${input.number ? ` ${input.number}` : ""}`,
    };
  }

  async resolveLines(inputs: ResolveLineInput[]): Promise<ResolveLineResult[]> {
    const results: ResolveLineResult[] = [];
    for (const input of inputs) {
      results.push(await this.resolveLine(input));
    }
    return results;
  }
}

export async function enrichEvolutionChainDefinitions(
  definitions: Map<string, CardDefinition>,
  resolver: CardResolver,
): Promise<void> {
  const pending = new Set<string>();
  for (const def of definitions.values()) {
    if (def.evolvesFrom) pending.add(def.evolvesFrom);
  }

  while (pending.size > 0) {
    const name = pending.values().next().value as string;
    pending.delete(name);
    if ([...definitions.values()].some((def) => def.name.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    const result = await resolver.resolveLine({ count: 1, name });
    if (!result.definition) continue;
    definitions.set(result.definition.apiId, result.definition);
    if (result.definition.evolvesFrom) pending.add(result.definition.evolvesFrom);
  }
}

export function expandResolvedDeck(
  results: ResolveLineResult[],
): {
  definitions: Map<string, CardDefinition>;
  cards: CardDefinition[];
  errors: ResolveLineResult[];
} {
  const definitions = new Map<string, CardDefinition>();
  const cards: CardDefinition[] = [];
  const errors: ResolveLineResult[] = [];

  for (const result of results) {
    if (!result.definition) {
      errors.push(result);
      continue;
    }
    definitions.set(result.definition.apiId, result.definition);
    for (let i = 0; i < result.input.count; i += 1) {
      cards.push(result.definition);
    }
  }

  return { definitions, cards, errors };
}
