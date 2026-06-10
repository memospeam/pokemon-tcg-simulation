import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { mapApiCard } from "../catalog/mapApiCard";
import type { PokemonTcgApiResponse } from "../catalog/types";
import type { CardDefinition } from "../models/definition";
import { parseAbilityText, parseAttackText } from "../engine/effects/parseText";
import { parseTrainerText } from "../engine/effects/trainerText";
import type { ParsedAbility, ParsedEffect } from "../engine/effects/types";
import { analyzeParsedEffects } from "./effectCoverage";
import { STANDARD_FORMAT } from "./standard";

const API_BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

export interface EffectTextRecord {
  id: string;
  kind: "attack" | "ability" | "trainer";
  text: string;
  coverage: "full" | "partial" | "none" | "empty";
  parsedEffects: ParsedEffect[];
  parsedAbility?: ParsedAbility;
  unknownClauses: string[];
  stubClauses?: string[];
  implementationCoverage?: import("./effectCoverage").ImplementationCoverage;
  cardCount: number;
  exampleCards: string[];
  trainerSubtype?: string;
}

export interface StandardCorpusManifest {
  generatedAt: string;
  format: typeof STANDARD_FORMAT;
  totalPokemonCards: number;
  totalTrainerCards: number;
  /** Special Energy cards (absent from manifests generated before the energy query). */
  totalEnergyCards?: number;
  cardsWithAttacks: number;
  cardsWithAbilities: number;
  cardsWithTrainerRules: number;
  uniqueAttackTexts: number;
  uniqueAbilityTexts: number;
  uniqueTrainerTexts: number;
  attackCoverage: CoverageStats;
  abilityCoverage: CoverageStats;
  trainerCoverage: CoverageStats;
  /** @deprecated use totalPokemonCards */
  totalCards?: number;
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
  hp?: string;
  regulationMark?: string;
  supertype: CardDefinition["supertype"];
  subtypes: string[];
  attacks: {
    name: string;
    damage: string;
    text: string;
    textId: string;
    /** Authoritative cost from the Pokémon TCG API (may be missing for older indexes). */
    cost?: string[];
    convertedEnergyCost?: number;
  }[];
  abilities: { name: string; text: string; textId: string }[];
  trainerRules?: { text: string; textId: string };
}

function getApiKey(): string | undefined {
  return process.env.POKEMONTCG_API_KEY ?? process.env.VITE_POKEMONTCG_API_KEY;
}

function normalizeTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function textId(kind: "attack" | "ability" | "trainer" | "energy", text: string): string {
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

async function fetchStandardPage(query: string, page: number): Promise<PokemonTcgApiResponse> {
  const params = new URLSearchParams({
    q: query,
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

async function fetchAllStandardCards(query: string): Promise<CardDefinition[]> {
  const first = await fetchStandardPage(query, 1);
  const totalCount = first.totalCount ?? first.data.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const cards = first.data.map(mapApiCard);

  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await fetchStandardPage(query, page);
    cards.push(...payload.data.map(mapApiCard));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return cards;
}

async function fetchAllStandardPokemon(): Promise<CardDefinition[]> {
  return fetchAllStandardCards(STANDARD_FORMAT.pokemonQuery);
}

async function fetchAllStandardTrainers(): Promise<CardDefinition[]> {
  return fetchAllStandardCards(STANDARD_FORMAT.trainerQuery);
}

async function fetchAllStandardEnergies(): Promise<CardDefinition[]> {
  return fetchAllStandardCards(STANDARD_FORMAT.energyQuery);
}

/** Exported for tests — pure assembly of the fetched card lists into the corpus. */
export function buildCorpus(
  pokemonCards: CardDefinition[],
  trainerCards: CardDefinition[],
  energyCards: CardDefinition[] = [],
): StandardCorpus {
  const attackMap = new Map<string, EffectTextRecord>();
  const abilityMap = new Map<string, EffectTextRecord>();
  const trainerMap = new Map<string, EffectTextRecord>();
  const cardIndex: StandardCardIndex[] = [];

  for (const card of pokemonCards) {
    const entry: StandardCardIndex = {
      apiId: card.apiId,
      name: card.name,
      set: card.set.ptcgoCode ?? card.set.id,
      number: card.number,
      hp: card.hp,
      regulationMark: card.regulationMark,
      supertype: card.supertype,
      subtypes: card.subtypes,
      attacks: [],
      abilities: [],
    };

    for (const attack of card.attacks ?? []) {
      const id = textId("attack", attack.text);
      // Preserve the authoritative cost and converted cost from the API.
      // These were dropped in earlier index builds, forcing corpusDeckBuilder
      // to invent a 1-of-primary-type fallback (see knownAttackCosts.ts).
      // Once the corpus is rebuilt with these fields, the fallback becomes
      // a per-card fallback only — Phantom Dive, Powerful Hand, Dark Frost,
      // etc. all resolve to their real costs automatically.
      entry.attacks.push({
        name: attack.name,
        damage: attack.damage,
        text: attack.text,
        textId: id,
        cost: attack.cost,
        convertedEnergyCost: attack.convertedEnergyCost,
      });

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

  for (const card of trainerCards) {
    const parsed = parseTrainerText(card);
    const effectText = parsed.text;
    if (!effectText) continue;

    const id = textId("trainer", effectText);
    const entry: StandardCardIndex = {
      apiId: card.apiId,
      name: card.name,
      set: card.set.ptcgoCode ?? card.set.id,
      number: card.number,
      regulationMark: card.regulationMark,
      supertype: card.supertype,
      subtypes: card.subtypes,
      attacks: [],
      abilities: [],
      trainerRules: { text: effectText, textId: id },
    };
    cardIndex.push(entry);

    const existing = trainerMap.get(id);
    if (existing) {
      existing.cardCount += 1;
      if (existing.exampleCards.length < 3 && !existing.exampleCards.includes(card.name)) {
        existing.exampleCards.push(card.name);
      }
    } else {
      trainerMap.set(id, {
        id,
        kind: "trainer",
        text: effectText,
        coverage: parsed.parseCoverage,
        parsedEffects: parsed.effects,
        unknownClauses: parsed.unknownClauses,
        implementationCoverage: parsed.implementationCoverage,
        cardCount: 1,
        exampleCards: [card.name],
        trainerSubtype: card.subtypes[0],
      });
    }
  }

  for (const card of energyCards) {
    // Special Energy (basic energies carry no regulation mark, so the energy
    // query never returns them). Rules text is stored on the entry the same
    // way trainer rules are, but is NOT funneled through parseTrainerText —
    // Special Energy effects are implemented by card name in
    // engine/effects/specialEnergyEffects.ts, so parsing the text would only
    // pollute unknown-patterns.json.
    const effectText = (card.rules ?? []).join("\n").trim();
    cardIndex.push({
      apiId: card.apiId,
      name: card.name,
      set: card.set.ptcgoCode ?? card.set.id,
      number: card.number,
      regulationMark: card.regulationMark,
      supertype: card.supertype,
      subtypes: card.subtypes,
      attacks: [],
      abilities: [],
      trainerRules: effectText
        ? { text: effectText, textId: textId("energy", effectText) }
        : undefined,
    });
  }

  const attackTexts = [...attackMap.values()].sort((a, b) => b.cardCount - a.cardCount);
  const abilityTexts = [...abilityMap.values()].sort((a, b) => b.cardCount - a.cardCount);
  const trainerTexts = [...trainerMap.values()].sort((a, b) => b.cardCount - a.cardCount);

  const manifest: StandardCorpusManifest = {
    generatedAt: new Date().toISOString(),
    format: STANDARD_FORMAT,
    totalPokemonCards: pokemonCards.length,
    totalTrainerCards: trainerCards.length,
    totalEnergyCards: energyCards.length,
    totalCards: pokemonCards.length,
    cardsWithAttacks: pokemonCards.filter((c) => (c.attacks?.length ?? 0) > 0).length,
    cardsWithAbilities: pokemonCards.filter((c) => (c.abilities?.length ?? 0) > 0).length,
    cardsWithTrainerRules: trainerTexts.reduce((sum, entry) => sum + entry.cardCount, 0),
    uniqueAttackTexts: attackTexts.length,
    uniqueAbilityTexts: abilityTexts.length,
    uniqueTrainerTexts: trainerTexts.length,
    attackCoverage: countCoverage(attackTexts),
    abilityCoverage: countCoverage(abilityTexts),
    trainerCoverage: countCoverage(trainerTexts),
  };

  return {
    manifest,
    effectTexts: [...attackTexts, ...abilityTexts, ...trainerTexts],
    cards: cardIndex,
  };
}

export async function prepareStandardCorpus(outputDir = "data/standard"): Promise<StandardCorpus> {
  const [pokemonCards, trainerCards, energyCards] = await Promise.all([
    fetchAllStandardPokemon(),
    fetchAllStandardTrainers(),
    fetchAllStandardEnergies(),
  ]);
  const corpus = buildCorpus(pokemonCards, trainerCards, energyCards);

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
