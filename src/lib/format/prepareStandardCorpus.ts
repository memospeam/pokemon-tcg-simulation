import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { mapApiCard } from "../catalog/mapApiCard";
import type { PokemonTcgApiResponse } from "../catalog/types";
import type { CardDefinition } from "../models/definition";
import { parseAbilityText, parseAttackText } from "../engine/effects/parseText";
import type { ParsedAbility, ParsedEffect } from "../engine/effects/types";
import { analyzeParsedEffects } from "./effectCoverage";
import { STANDARD_FORMAT } from "./standard";

const API_BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

export interface EffectTextRecord {
  id: string;
  kind: "attack" | "ability";
  text: string;
  coverage: "full" | "partial" | "none" | "empty";
  parsedEffects: ParsedEffect[];
  parsedAbility?: ParsedAbility;
  unknownClauses: string[];
  stubClauses?: string[];
  implementationCoverage?: import("./effectCoverage").ImplementationCoverage;
  cardCount: number;
  exampleCards: string[];
}

export interface StandardCorpusManifest {
  generatedAt: string;
  format: typeof STANDARD_FORMAT;
  totalCards: number;
  cardsWithAttacks: number;
  cardsWithAbilities: number;
  uniqueAttackTexts: number;
  uniqueAbilityTexts: number;
  attackCoverage: CoverageStats;
  abilityCoverage: CoverageStats;
}

export interface CoverageStats {
  full: number;
  partial: number;
  none: number;
  empty: number;
}

export interface StandardCorpus {
  manifest: StandardCorpusManifest;
  effectTexts: EffectTextRecord[];
  cards: StandardCardIndex[];
}

export interface StandardCardIndex {
  apiId: string;
  name: string;
  set: string;
  number: string;
  regulationMark?: string;
  attacks: { name: string; damage: string; text: string; textId: string }[];
  abilities: { name: string; text: string; textId: string }[];
}

function getApiKey(): string | undefined {
  return process.env.POKEMONTCG_API_KEY ?? process.env.VITE_POKEMONTCG_API_KEY;
}

function normalizeTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function textId(kind: "attack" | "ability", text: string): string {
  const key = normalizeTextKey(text);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `${kind}-${hash.toString(16)}`;
}

function countCoverage(records: EffectTextRecord[]): CoverageStats {
  const stats: CoverageStats = { full: 0, partial: 0, none: 0, empty: 0 };
  for (const record of records) {
    stats[record.coverage] += 1;
  }
  return stats;
}

async function fetchStandardPokemonPage(page: number): Promise<PokemonTcgApiResponse> {
  const params = new URLSearchParams({
    q: STANDARD_FORMAT.pokemonQuery,
    pageSize: String(PAGE_SIZE),
    page: String(page),
    orderBy: "set.releaseDate",
  });

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const response = await fetch(`${API_BASE}/cards?${params.toString()}`, { headers });
  if (!response.ok) {
    throw new Error(`Pokemon TCG API error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as PokemonTcgApiResponse;
}

async function fetchAllStandardPokemon(): Promise<CardDefinition[]> {
  const first = await fetchStandardPokemonPage(1);
  const totalCount = first.totalCount ?? first.data.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const cards = first.data.map(mapApiCard);

  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await fetchStandardPokemonPage(page);
    cards.push(...payload.data.map(mapApiCard));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return cards;
}

function buildCorpus(cards: CardDefinition[]): StandardCorpus {
  const attackMap = new Map<string, EffectTextRecord>();
  const abilityMap = new Map<string, EffectTextRecord>();
  const cardIndex: StandardCardIndex[] = [];

  for (const card of cards) {
    const entry: StandardCardIndex = {
      apiId: card.apiId,
      name: card.name,
      set: card.set.ptcgoCode ?? card.set.id,
      number: card.number,
      regulationMark: card.regulationMark,
      attacks: [],
      abilities: [],
    };

    for (const attack of card.attacks ?? []) {
      const id = textId("attack", attack.text);
      entry.attacks.push({ name: attack.name, damage: attack.damage, text: attack.text, textId: id });

      const parsedEffects = parseAttackText(attack.text);
      const { parseCoverage, unknownClauses, stubClauses, implementationCoverage } =
        analyzeParsedEffects(parsedEffects);
      const existing = attackMap.get(id);
      if (existing) {
        existing.cardCount += 1;
        if (existing.exampleCards.length < 3 && !existing.exampleCards.includes(card.name)) {
          existing.exampleCards.push(card.name);
        }
      } else {
        attackMap.set(id, {
          id,
          kind: "attack",
          text: attack.text,
          coverage: parseCoverage,
          parsedEffects,
          unknownClauses,
          stubClauses,
          implementationCoverage,
          cardCount: 1,
          exampleCards: [card.name],
        });
      }
    }

    for (const ability of card.abilities ?? []) {
      const id = textId("ability", ability.text);
      entry.abilities.push({ name: ability.name, text: ability.text, textId: id });

      const parsedAbility = parseAbilityText(ability);
      const { parseCoverage, unknownClauses, stubClauses, implementationCoverage } =
        analyzeParsedEffects(parsedAbility.effects);
      const existing = abilityMap.get(id);
      if (existing) {
        existing.cardCount += 1;
        if (existing.exampleCards.length < 3 && !existing.exampleCards.includes(card.name)) {
          existing.exampleCards.push(card.name);
        }
      } else {
        abilityMap.set(id, {
          id,
          kind: "ability",
          text: ability.text,
          coverage: parseCoverage,
          parsedEffects: parsedAbility.effects,
          parsedAbility,
          unknownClauses,
          stubClauses,
          implementationCoverage,
          cardCount: 1,
          exampleCards: [card.name],
        });
      }
    }

    cardIndex.push(entry);
  }

  const attackTexts = [...attackMap.values()].sort((a, b) => b.cardCount - a.cardCount);
  const abilityTexts = [...abilityMap.values()].sort((a, b) => b.cardCount - a.cardCount);

  const manifest: StandardCorpusManifest = {
    generatedAt: new Date().toISOString(),
    format: STANDARD_FORMAT,
    totalCards: cards.length,
    cardsWithAttacks: cards.filter((c) => (c.attacks?.length ?? 0) > 0).length,
    cardsWithAbilities: cards.filter((c) => (c.abilities?.length ?? 0) > 0).length,
    uniqueAttackTexts: attackTexts.length,
    uniqueAbilityTexts: abilityTexts.length,
    attackCoverage: countCoverage(attackTexts),
    abilityCoverage: countCoverage(abilityTexts),
  };

  return {
    manifest,
    effectTexts: [...attackTexts, ...abilityTexts],
    cards: cardIndex,
  };
}

export async function prepareStandardCorpus(outputDir = "data/standard"): Promise<StandardCorpus> {
  const cards = await fetchAllStandardPokemon();
  const corpus = buildCorpus(cards);

  const resolvedDir = path.resolve(process.cwd(), outputDir);
  await mkdir(resolvedDir, { recursive: true });

  await writeFile(path.join(resolvedDir, "manifest.json"), `${JSON.stringify(corpus.manifest, null, 2)}\n`);
  await writeFile(path.join(resolvedDir, "effect-texts.json"), `${JSON.stringify(corpus.effectTexts, null, 2)}\n`);
  await writeFile(path.join(resolvedDir, "cards-index.json"), `${JSON.stringify(corpus.cards, null, 2)}\n`);

  const unknownPatterns = corpus.effectTexts
    .filter((entry) => entry.coverage === "none" || entry.coverage === "partial")
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      coverage: entry.coverage,
      unknownClauses: entry.unknownClauses,
      cardCount: entry.cardCount,
      exampleCards: entry.exampleCards,
    }));

  await writeFile(
    path.join(resolvedDir, "unknown-patterns.json"),
    `${JSON.stringify(unknownPatterns, null, 2)}\n`,
  );

  const stubPatterns = corpus.effectTexts
    .filter((entry) => (entry.stubClauses?.length ?? 0) > 0)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      parseCoverage: entry.coverage,
      implementationCoverage: entry.implementationCoverage ?? "stub",
      stubClauses: entry.stubClauses ?? [],
      cardCount: entry.cardCount,
      exampleCards: entry.exampleCards,
    }));

  await writeFile(
    path.join(resolvedDir, "stub-patterns.json"),
    `${JSON.stringify(stubPatterns, null, 2)}\n`,
  );

  return corpus;
}
