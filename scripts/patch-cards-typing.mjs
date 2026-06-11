/**
 * One-time migration: patch cards-index.json with real types / weaknesses /
 * resistances / retreatCost from pokemontcg.io (the corpus never fetched these,
 * so Weakness ×2 and Resistance −30 silently never applied in simulation).
 * Future corpus regenerations include these fields natively (prepareStandardCorpus).
 * Run: node scripts/patch-cards-typing.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardsPath = join(__dirname, "../data/standard/cards-index.json");

const cards = JSON.parse(readFileSync(cardsPath, "utf8"));
const pokemon = cards.filter((c) => c.supertype === "Pokémon");
console.log(`Total Pokémon cards in index: ${pokemon.length}`);

const API_BASE = "https://api.pokemontcg.io/v2";
const QUERY = "supertype:Pokémon (regulationMark:H OR regulationMark:I OR regulationMark:J)";
const PAGE_SIZE = 250;
const apiKey = process.env.POKEMONTCG_API_KEY;
const headers = { Accept: "application/json" };
if (apiKey) headers["X-Api-Key"] = apiKey;

const map = {};
let page = 1;
let totalCount = Infinity;
let seen = 0;

while (seen < totalCount) {
  const params = new URLSearchParams({
    q: QUERY,
    page: String(page),
    pageSize: String(PAGE_SIZE),
    select: "id,types,weaknesses,resistances,retreatCost",
    orderBy: "set.releaseDate",
  });
  const res = await fetch(`${API_BASE}/cards?${params}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  const data = await res.json();
  totalCount = data.totalCount ?? 0;
  for (const card of data.data ?? []) {
    map[card.id] = {
      types: card.types,
      weaknesses: card.weaknesses,
      resistances: card.resistances,
      retreatCost: card.retreatCost,
    };
  }
  seen += (data.data ?? []).length;
  process.stdout.write(`\rFetched ${seen}/${totalCount}   `);
  if ((data.data ?? []).length === 0) break;
  page += 1;
  await new Promise((r) => setTimeout(r, 400));
}
console.log();

let patched = 0;
let withWeak = 0;
let withRes = 0;
const unmatched = [];
for (const card of cards) {
  if (card.supertype !== "Pokémon") continue;
  const info = map[card.apiId];
  if (!info) {
    unmatched.push(card.apiId);
    continue;
  }
  if (info.types) card.types = info.types;
  if (info.weaknesses) card.weaknesses = info.weaknesses;
  if (info.resistances) card.resistances = info.resistances;
  if (info.retreatCost) card.retreatCost = info.retreatCost;
  patched += 1;
  if (info.weaknesses?.length) withWeak += 1;
  if (info.resistances?.length) withRes += 1;
}

writeFileSync(cardsPath, `${JSON.stringify(cards, null, 2)}\n`);
console.log(`Patched ${patched}/${pokemon.length} Pokémon (${withWeak} with weaknesses, ${withRes} with resistances).`);
if (unmatched.length > 0) {
  console.warn(`No API data for ${unmatched.length} cards: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? "…" : ""}`);
}

const samples = ["Mega Lopunny ex", "Dragapult ex", "N's Zoroark ex", "Cynthia's Garchomp ex"];
for (const name of samples) {
  const c = cards.find((x) => x.name === name && x.types);
  if (c) console.log(`  ${c.name}: types=${JSON.stringify(c.types)} weak=${JSON.stringify(c.weaknesses)} resist=${JSON.stringify(c.resistances)}`);
}
