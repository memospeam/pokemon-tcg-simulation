import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { mapApiCard } from "../catalog/mapApiCard";
import type { PokemonTcgApiResponse } from "../catalog/types";
import type { CardDefinition } from "../models/definition";
import { parseAbilityText, parseAttackText } from "../engine/effects/parseText";
import { parseTrainerText } from "../engine/effects/trainerText";
import type { ParsedAbility, ParsedEffect } from "../engine/effects/types";
import { analyzeParsedEffects } from "./effectCoverage";
import { isStandardRegulationMark, STANDARD_FORMAT } from "./standard";
import { STANDARD_EXPANSIONS, getStandardExpansionByPtcgoCode } from "./standardExpansions";

const API_BASE = "https://api.pokemontcg.io/v2";
/** Small pages — pokemontcg.io returns 500 on larger pageSize for bulk queries. */
const PAGE_SIZE = 25;
const PAGE_DELAY_MS = 300;

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
  /** Pokémon typing + battle modifiers (absent from indexes generated before 2026-06). */
  types?: string[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
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
  });

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = getApiKey();
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const url = `${API_BASE}/cards?${params.toString()}`;
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.ok) {
      return (await response.json()) as PokemonTcgApiResponse;
    }
    lastStatus = `${response.status} ${response.statusText}`;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * 2 ** attempt, 8000)));
      continue;
    }
    throw new Error(`Pokemon TCG API error: ${lastStatus}`);
  }
  throw new Error(`Pokemon TCG API error: ${lastStatus}`);
}

async function fetchQueryPages(query: string): Promise<CardDefinition[]> {
  const first = await fetchStandardPage(query, 1);
  const totalCount = first.totalCount ?? first.data.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const cards = first.data.map(mapApiCard);

  for (let page = 2; page <= totalPages; page += 1) {
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const payload = await fetchStandardPage(query, page);
    cards.push(...payload.data.map(mapApiCard));
  }

  return cards;
}

async function fetchExpansionCards(
  supertype: CardDefinition["supertype"],
  expansions: typeof STANDARD_EXPANSIONS,
): Promise<CardDefinition[]> {
  const byId = new Map<string, CardDefinition>();
  for (const expansion of expansions) {
    const query = `supertype:${supertype} set.id:${expansion.id}`;
    for (const card of await fetchQueryPages(query)) {
      if (supertype === "Energy" || isStandardRegulationMark(card.regulationMark)) {
        byId.set(card.apiId, card);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }
  return [...byId.values()];
}

function indexEntryToDefinition(entry: StandardCardIndex): CardDefinition {
  const expansion = getStandardExpansionByPtcgoCode(entry.set);
  const setId = expansion?.id ?? entry.set.toLowerCase();
  return {
    apiId: entry.apiId,
    name: entry.name,
    supertype: entry.supertype,
    subtypes: entry.subtypes,
    hp: entry.hp,
    types: entry.types,
    regulationMark: entry.regulationMark,
    number: entry.number,
    weaknesses: entry.weaknesses,
    resistances: entry.resistances,
    retreatCost: entry.retreatCost,
    set: { id: setId, name: expansion?.name ?? entry.set, ptcgoCode: entry.set },
    images: { small: "", large: "" },
    attacks: entry.attacks.map((attack) => ({
      name: attack.name,
      damage: attack.damage,
      text: attack.text,
      cost: attack.cost ?? [],
      convertedEnergyCost: attack.convertedEnergyCost ?? attack.cost?.length ?? 0,
    })),
    abilities: entry.abilities.map((ability) => ({
      name: ability.name,
      text: ability.text,
      type: "Ability",
    })),
    rules: entry.trainerRules?.text ? [entry.trainerRules.text] : undefined,
  };
}

async function writeCorpusFiles(corpus: StandardCorpus, outputDir: string): Promise<void> {
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
}

/** Re-fetch selected expansions and merge into the on-disk corpus (fast patch for API blips). */
export async function patchStandardExpansions(
  ptcgoCodes: string[],
  outputDir = "data/standard",
): Promise<StandardCorpus> {
  const codes = new Set(ptcgoCodes.map((code) => code.toUpperCase()));
  const targets = STANDARD_EXPANSIONS.filter((expansion) => codes.has(expansion.ptcgoCode));
  if (targets.length === 0) {
    throw new Error(`No Standard expansions match: ${ptcgoCodes.join(", ")}`);
  }

  const resolvedDir = path.resolve(process.cwd(), outputDir);
  const existingIndex = JSON.parse(
    await readFile(path.join(resolvedDir, "cards-index.json"), "utf8"),
  ) as StandardCardIndex[];

  const kept = existingIndex.filter((entry) => !codes.has(entry.set.toUpperCase()));
  const keptPokemon = kept.filter((entry) => entry.supertype === "Pokémon").map(indexEntryToDefinition);
  const keptTrainers = kept.filter((entry) => entry.supertype === "Trainer").map(indexEntryToDefinition);
  const keptEnergy = kept.filter((entry) => entry.supertype === "Energy").map(indexEntryToDefinition);

  // eslint-disable-next-line no-console
  console.log(`Patching ${targets.map((t) => t.ptcgoCode).join(", ")}…`);
  const patchPokemon = await fetchExpansionCards("Pokémon", targets);
  const patchTrainers = await fetchExpansionCards("Trainer", targets);
  const patchEnergy = await fetchExpansionCards("Energy", targets);

  const corpus = buildCorpus(
    [...keptPokemon, ...patchPokemon],
    [...keptTrainers, ...patchTrainers],
    [...keptEnergy, ...patchEnergy],
  );
  await writeCorpusFiles(corpus, outputDir);
  return corpus;
}

/** Fetch one supertype set-by-set (reliable on the public API). */
async function fetchAllStandardCards(supertype: CardDefinition["supertype"]): Promise<CardDefinition[]> {
  const byId = new Map<string, CardDefinition>();
  const ingest = (cards: CardDefinition[]) => {
    for (const card of cards) {
      if (supertype === "Energy" || isStandardRegulationMark(card.regulationMark)) {
        byId.set(card.apiId, card);
      }
    }
  };

  const fetchSet = async (expansion: (typeof STANDARD_EXPANSIONS)[number]) => {
    const query = `supertype:${supertype} set.id:${expansion.id}`;
    ingest(await fetchQueryPages(query));
  };

  const failed: (typeof STANDARD_EXPANSIONS)[number][] = [];
  for (const expansion of STANDARD_EXPANSIONS) {
    try {
      // eslint-disable-next-line no-console
      console.log(`  fetching ${supertype} — ${expansion.ptcgoCode} (${expansion.id})`);
      await fetchSet(expansion);
    } catch {
      failed.push(expansion);
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  const stillFailed: (typeof STANDARD_EXPANSIONS)[number][] = [];
  for (const expansion of failed) {
    try {
      // eslint-disable-next-line no-console
      console.log(`  retry ${supertype} — ${expansion.ptcgoCode}`);
      await fetchSet(expansion);
    } catch {
      stillFailed.push(expansion);
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  for (const expansion of stillFailed) {
    try {
      // eslint-disable-next-line no-console
      console.log(`  retry² ${supertype} — ${expansion.ptcgoCode}`);
      await fetchSet(expansion);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`  skipped ${expansion.ptcgoCode} after retry:`, (err as Error).message);
    }
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS * 2));
  }

  return [...byId.values()];
}

async function fetchAllStandardPokemon(): Promise<CardDefinition[]> {
  return fetchAllStandardCards("Pokémon");
}

async function fetchAllStandardTrainers(): Promise<CardDefinition[]> {
  return fetchAllStandardCards("Trainer");
}

async function fetchAllStandardEnergies(): Promise<CardDefinition[]> {
  return fetchAllStandardCards("Energy");
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
      types: card.types,
      weaknesses: card.weaknesses,
      resistances: card.resistances,
      retreatCost: card.retreatCost,
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
  const pokemonCards = await fetchAllStandardPokemon();
  const trainerCards = await fetchAllStandardTrainers();
  const energyCards = await fetchAllStandardEnergies();
  const corpus = buildCorpus(pokemonCards, trainerCards, energyCards);
  await writeCorpusFiles(corpus, outputDir);
  return corpus;
}
