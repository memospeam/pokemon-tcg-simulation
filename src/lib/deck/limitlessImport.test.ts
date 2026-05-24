import { describe, expect, it } from "vitest";
import { UTRECHT_535_TOP16 } from "./tournamentPresets";
import {
  filterLimitlessDecks,
  mergeLimitlessIntoPresets,
  summarizeLimitlessImport,
  validateLimitlessPreset,
} from "./limitlessImport";
import { CRI_PLAYTEST_DECKS } from "./criDeckPresets";

describe("limitlessImport", () => {
  it("filters tournament decks by set code substring", () => {
    const criLike = filterLimitlessDecks(UTRECHT_535_TOP16, { setCode: "MEG" });
    expect(criLike.length).toBeGreaterThan(0);
    expect(criLike.every((deck) => deck.text.includes(" MEG "))).toBe(true);
  });

  it("validates imported deck text against the corpus", () => {
    const deck = UTRECHT_535_TOP16.decks[0]!;
    const result = validateLimitlessPreset(deck);
    expect(result.corpus.pokemonResolved).toBeGreaterThan(0);
  });

  it("summarizes import health for a tournament bundle", () => {
    const summary = summarizeLimitlessImport(UTRECHT_535_TOP16);
    expect(summary.matchedDecks).toBe(UTRECHT_535_TOP16.decks.length);
    expect(summary.gaps.length + summary.fullyResolved).toBe(summary.matchedDecks);
  });

  it("merges imported presets without duplicate ids", () => {
    const merged = mergeLimitlessIntoPresets(CRI_PLAYTEST_DECKS, UTRECHT_535_TOP16.decks);
    expect(merged.length).toBe(CRI_PLAYTEST_DECKS.length + UTRECHT_535_TOP16.decks.length);
    expect(new Set(merged.map((deck) => deck.id)).size).toBe(merged.length);
  });
});
