import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import { parseLimitlessDeckList } from "./limitlessParser";
import { WORLDS_2026 } from "./tournamentPresets";

const tournamentJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../data/tournaments/535-top16.json"), "utf8"),
) as { decks: Array<{ label: string; text: string }> };

describe("tournament deck presets", () => {
  it("parses all Tournament Top 16 lists without format errors", () => {
    for (const deck of tournamentJson.decks) {
      const parsed = parseLimitlessDeckList(deck.text);
      expect(parsed.errors, deck.label).toHaveLength(0);
      expect(parsed.lines.length, deck.label).toBeGreaterThan(0);
    }
  });

  it("builds playable 60-card decks for Worlds 2026 Top 8", () => {
    for (const deck of WORLDS_2026.decks) {
      const parsed = parseLimitlessDeckList(deck.text);
      expect(parsed.errors, deck.label).toEqual([]);
      const built = buildPlaytestDeckFromCorpusText(deck.label, deck.text);
      expect(built.resolveErrors, deck.label).toEqual([]);
      expect(built.cards, deck.label).toHaveLength(60);
      expect(built.validation.valid, deck.label).toBe(true);
    }
  });
});
