import { describe, expect, it } from "vitest";
import { patchStandardExpansions } from "../src/lib/format/prepareStandardCorpus";

describe("patch 30th Celebration", () => {
  it("fetches 30C and merges it into the Standard corpus", async () => {
    const corpus = await patchStandardExpansions(["30C"]);
    const cards = corpus.cards.filter((card) => card.set === "30C");
    expect(cards.length).toBeGreaterThan(100);
    expect(cards.some((card) => card.name === "Mew ex" || card.name === "Mewtwo ex")).toBe(true);
  }, 600_000);
});
