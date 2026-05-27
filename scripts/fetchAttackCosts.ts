/**
 * Batch-fetch authoritative attack costs for every Pokémon used in any of
 * the Utrecht (and beyond) meta decks. Output is written to
 * `data/standard/attack-costs.json` so it can be consumed by
 * `knownAttackCosts.ts` without further API round-trips.
 *
 * Run with: npx vitest run scripts/fetchAttackCosts.test.ts
 *
 * No API key required for this many cards — the public rate limit is
 * generous enough; we pace requests at 250ms.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadStandardCorpus } from "../src/lib/format/loadStandardCorpus";

interface DeckPreset {
  player: string;
  deckName: string;
  text: string;
  id: string;
}

interface TournamentFile {
  decks: DeckPreset[];
}

interface ApiAttack {
  name: string;
  cost?: string[];
  convertedEnergyCost?: number;
  damage?: string;
}

interface ApiCard {
  id: string;
  name: string;
  supertype: string;
  attacks?: ApiAttack[];
}

export interface AttackCostEntry {
  /** Lower-cased Pokémon name as it appears on the card. */
  pokemonName: string;
  /** API id (e.g. "sv6-128"). */
  apiId: string;
  /** Set ptcgo code + number for human-readable cross-reference. */
  set: string;
  number: string;
  attacks: {
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
  }[];
}

const TOURNAMENTS = [
  "535-top16.json",
  "worlds-2025.json",
  "la-regionals-2026.json",
];

const API_BASE = "https://api.pokemontcg.io/v2/cards";

/** Extract every Pokémon (set, number) pair referenced in the deck text. */
function extractPokemonRefs(deckText: string): { name: string; set: string; number: string }[] {
  // The pokemon section starts after "Pokémon" and ends before "Trainer" or "Energy".
  // Each line: "<count> <name> <SET> <number>"  e.g. "4 Dreepy TWM 128"
  const lines = deckText.split(/\r?\n/);
  let inPokemon = false;
  const out: { name: string; set: string; number: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("Pokémon")) {
      inPokemon = true;
      continue;
    }
    if (line.startsWith("Trainer") || line.startsWith("Energy")) {
      inPokemon = false;
      continue;
    }
    if (!inPokemon) continue;

    // Pattern: "<count> <name...> <SET> <number>"
    const match = line.match(/^\d+\s+(.+?)\s+([A-Z]{2,4})\s+(\d+[a-z]?)$/);
    if (!match) continue;
    out.push({ name: match[1]!, set: match[2]!, number: match[3]! });
  }
  return out;
}

async function loadAllRefs(): Promise<{ name: string; set: string; number: string }[]> {
  const all: { name: string; set: string; number: string }[] = [];
  for (const tournament of TOURNAMENTS) {
    const p = path.resolve(process.cwd(), "data/tournaments", tournament);
    try {
      const raw = await readFile(p, "utf8");
      const data = JSON.parse(raw) as TournamentFile;
      for (const deck of data.decks ?? []) {
        all.push(...extractPokemonRefs(deck.text));
      }
    } catch {
      // file may not exist
    }
  }
  return all;
}

/** Resolve a (set, number) ref to the API id using the local corpus index. */
function resolveApiId(ref: { name: string; set: string; number: string }, corpus: ReturnType<typeof loadStandardCorpus>): string | null {
  const setUpper = ref.set.toUpperCase();
  const card = corpus.cards.find(
    (c) => c.set === setUpper && c.number === ref.number,
  );
  return card?.apiId ?? null;
}

async function fetchCard(apiId: string): Promise<ApiCard | null> {
  const apiKey = process.env.POKEMONTCG_API_KEY ?? process.env.VITE_POKEMONTCG_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  // Per-request timeout via AbortController — caps each attempt at 8s.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${API_BASE}/${apiId}`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 504 || res.status === 502 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as { data: ApiCard };
      return data.data;
    } catch {
      clearTimeout(timeoutId);
      // network error / timeout — small backoff before retry
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

const OUT_PATH = path.resolve(process.cwd(), "data/standard/attack-costs.json");

async function loadExistingResults(): Promise<AttackCostEntry[]> {
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    return JSON.parse(raw) as AttackCostEntry[];
  } catch {
    return [];
  }
}

async function writeResults(results: AttackCostEntry[]): Promise<void> {
  const sorted = [...results].sort((a, b) =>
    a.pokemonName.localeCompare(b.pokemonName) || a.apiId.localeCompare(b.apiId),
  );
  await writeFile(OUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

export async function fetchAttackCosts(): Promise<AttackCostEntry[]> {
  const corpus = loadStandardCorpus();
  const refs = await loadAllRefs();

  // Deduplicate by (set, number) — the same card appears across many decks.
  const seen = new Set<string>();
  const uniqueRefs = refs.filter((r) => {
    const key = `${r.set}-${r.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Resume support: skip anything already in the existing output file.
  const results = await loadExistingResults();
  const existingIds = new Set(results.map((e) => e.apiId));

  // eslint-disable-next-line no-console
  console.log(
    `Resolving ${uniqueRefs.length} unique Pokémon refs — ${results.length} already cached, ${uniqueRefs.length - existingIds.size} to fetch.`,
  );

  let resolved = 0;
  let skipped = 0;
  let trainerOrEnergy = 0;
  let added = 0;

  for (let i = 0; i < uniqueRefs.length; i += 1) {
    const ref = uniqueRefs[i]!;
    const apiId = resolveApiId(ref, corpus);
    if (!apiId) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`  [${i + 1}/${uniqueRefs.length}] ⊘ ${ref.name} ${ref.set} ${ref.number} (no apiId)`);
      continue;
    }
    if (existingIds.has(apiId)) {
      resolved += 1; // already cached
      continue;
    }

    const card = await fetchCard(apiId);
    await new Promise((r) => setTimeout(r, 400));

    if (!card) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`  [${i + 1}/${uniqueRefs.length}] ✗ ${ref.name} (${apiId}) — fetch failed (will retry next run)`);
      continue;
    }

    if (card.supertype !== "Pokémon" || !card.attacks?.length) {
      trainerOrEnergy += 1;
      continue;
    }

    results.push({
      pokemonName: card.name.toLowerCase(),
      apiId: card.id,
      set: ref.set.toUpperCase(),
      number: ref.number,
      attacks: card.attacks.map((a) => ({
        name: a.name,
        cost: a.cost ?? [],
        convertedEnergyCost: a.convertedEnergyCost ?? (a.cost?.length ?? 0),
        damage: a.damage ?? "",
      })),
    });
    existingIds.add(apiId);
    resolved += 1;
    added += 1;
    // eslint-disable-next-line no-console
    console.log(`  [${i + 1}/${uniqueRefs.length}] ✓ ${card.name} (${apiId}) — ${card.attacks.length} attack(s)`);

    // Persist after every successful fetch so a timeout/crash never loses progress.
    if (added % 3 === 0) {
      await writeResults(results);
    }
  }

  // Final flush.
  await writeResults(results);

  // eslint-disable-next-line no-console
  console.log(`\nResolved ${resolved} Pokémon, skipped ${skipped}, ${trainerOrEnergy} were trainers/energy.`);
  // eslint-disable-next-line no-console
  console.log(`Added ${added} new entries this run. Total cached: ${results.length}.`);

  return results;
}

export async function writeAttackCostsTable(entries: AttackCostEntry[]): Promise<void> {
  await writeResults(entries);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${entries.length} entries to ${OUT_PATH}`);
}
