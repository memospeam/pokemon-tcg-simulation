/**
 * One-time migration: patch cards-index.json with real HP values from pokemontcg.io API.
 * Run: node scripts/patch-cards-hp.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardsPath = join(__dirname, "../data/standard/cards-index.json");

const cards = JSON.parse(readFileSync(cardsPath, "utf8"));
const pokemon = cards.filter((c) => c.supertype === "Pokémon");

console.log(`Total Pokémon cards: ${pokemon.length}`);
const missing = pokemon.filter((c) => !c.hp);
console.log(`Cards missing HP: ${missing.length}`);

if (missing.length === 0) {
  console.log("All cards already have HP. Nothing to do.");
  process.exit(0);
}

const BATCH_SIZE = 100;
const DELAY_MS = 600;
const API_BASE = "https://api.pokemontcg.io/v2";
const apiKey = process.env.POKEMONTCG_API_KEY;

const hpMap = {};
let fetched = 0;

for (let i = 0; i < missing.length; i += BATCH_SIZE) {
  const batch = missing.slice(i, i + BATCH_SIZE);
  const query = batch.map((c) => `id:${c.apiId}`).join(" OR ");
  const url = `${API_BASE}/cards?q=${encodeURIComponent(query)}&select=id,hp&pageSize=${BATCH_SIZE}`;

  const headers = { Accept: "application/json" };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    for (const card of data.data ?? []) {
      if (card.hp) hpMap[card.id] = card.hp;
    }
    fetched += batch.length;
    process.stdout.write(`\rFetched ${fetched}/${missing.length} (${Object.keys(hpMap).length} with HP)   `);
  } catch (err) {
    console.error(`\nBatch ${i}–${i + BATCH_SIZE} failed:`, err.message);
  }

  if (i + BATCH_SIZE < missing.length) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

console.log(`\nPatching ${Object.keys(hpMap).length} cards...`);

let patched = 0;
for (const card of cards) {
  if (card.supertype === "Pokémon" && hpMap[card.apiId]) {
    card.hp = hpMap[card.apiId];
    patched += 1;
  }
}

writeFileSync(cardsPath, JSON.stringify(cards, null, 2));
console.log(`Done. Patched HP for ${patched} Pokémon cards.`);

const stillMissing = cards.filter((c) => c.supertype === "Pokémon" && !c.hp);
if (stillMissing.length > 0) {
  console.warn(`Warning: ${stillMissing.length} cards still have no HP (API returned no data for them).`);
}
