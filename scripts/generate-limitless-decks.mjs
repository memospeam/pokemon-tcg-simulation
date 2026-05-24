/**
 * Fetches Limitless tournament decklists and writes Top N JSON.
 * Usage: node scripts/generate-limitless-decks.mjs [tournamentId] [topN] [outputPath]
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const TOURNAMENT_ID = Number(process.argv[2] ?? 535);
const TOP_N = Number(process.argv[3] ?? 16);
const OUT_PATH =
  process.argv[4] ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    `../data/tournaments/${TOURNAMENT_ID}-top${TOP_N}.json`,
  );

const PLACEMENT_TOGGLE_RE =
  /<div class="decklist-toggle"[^>]*>(\d+(?:st|nd|rd|th))\s+([^<]+)<\/div>/;
const DECK_TITLE_RE = /<div class="decklist-title">\s*([^<\n]+?)(?:\s*<|$)/;
const SECTION_HEADING_RE = /<div class="decklist-column-heading">([^<]+)<\/div>/g;
const CARD_RE =
  /<div class="decklist-card"([^>]*)>[\s\S]*?<span class="card-count">(\d+)<\/span>\s*<span class="card-name">([^<]+)<\/span>/g;

function parseCardAttributes(raw) {
  const setMatch = raw.match(/data-set="([^"]+)"/);
  const numberMatch = raw.match(/data-number="([^"]+)"/);
  return {
    setCode: setMatch?.[1]?.toUpperCase(),
    number: numberMatch?.[1],
  };
}

function buildLimitlessText(block) {
  const sections = [];
  const headingRe = new RegExp(SECTION_HEADING_RE.source, "g");
  const headings = [...block.matchAll(headingRe)].map((match) => match[1].trim());

  const parts = block.split(/<div class="decklist-column-heading">/);
  parts.shift();

  for (let i = 0; i < parts.length; i += 1) {
    const heading = headings[i] ?? "Pokémon (0)";
    const normalizedHeading = heading.replace(/\((\d+)\)/, ": $1");
    const lines = [normalizedHeading];
    const cardRe = new RegExp(CARD_RE.source, "g");
    let cardMatch;
    while ((cardMatch = cardRe.exec(parts[i])) !== null) {
      const count = Number(cardMatch[2]);
      const name = cardMatch[3].trim();
      const { setCode, number } = parseCardAttributes(cardMatch[1] ?? "");
      const suffix = setCode && number ? ` ${setCode} ${number}` : setCode ? ` ${setCode}` : "";
      lines.push(`${count} ${name}${suffix}`);
    }
    if (lines.length > 1) sections.push(...lines, "");
  }

  return sections.join("\n").trim();
}

function parseDecklistBlock(block) {
  const toggleMatch = block.match(PLACEMENT_TOGGLE_RE);
  if (!toggleMatch) return null;

  const placement = parseInt(toggleMatch[1], 10);
  const player = toggleMatch[2].trim();
  const titleMatch = block.match(DECK_TITLE_RE);
  const deckName = titleMatch?.[1]?.trim() ?? "Unknown";
  const text = buildLimitlessText(block);

  if (!text) return null;

  return { placement, player, deckName, text };
}

function parseTournamentDecklists(html) {
  const sectionMatch = html.match(
    /<section class="tournament-decklists">([\s\S]*?)<\/section>/,
  );
  if (!sectionMatch) return [];

  const section = sectionMatch[1];
  const blocks = section.split(/<div class="tournament-decklist">/).slice(1);
  const decks = [];

  for (const block of blocks) {
    const deck = parseDecklistBlock(block);
    if (!deck) continue;
    if (deck.placement > TOP_N) break;
    decks.push(deck);
    if (decks.length >= TOP_N) break;
  }

  return decks.sort((a, b) => a.placement - b.placement);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const url = `https://limitlesstcg.com/tournaments/${TOURNAMENT_ID}/decklists`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const html = await response.text();
  const decks = parseTournamentDecklists(html);

  if (decks.length < TOP_N) {
    console.warn(`Warning: only parsed ${decks.length} decks (expected ${TOP_N})`);
  }

  const output = {
    tournamentId: TOURNAMENT_ID,
    name: `Limitless tournament ${TOURNAMENT_ID}`,
    date: new Date().toISOString().slice(0, 10),
    sourceUrl: `https://limitlesstcg.com/tournaments/${TOURNAMENT_ID}`,
    decks: decks.map((deck) => ({
      ...deck,
      id: `limitless-${TOURNAMENT_ID}-${deck.placement}-${slugify(deck.player)}`,
      label: `#${deck.placement} ${deck.player} — ${deck.deckName}`,
    })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${output.decks.length} decks to ${OUT_PATH}`);
  for (const deck of output.decks) {
    console.log(`  ${deck.label} (${deck.text.split("\n").length} lines)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
