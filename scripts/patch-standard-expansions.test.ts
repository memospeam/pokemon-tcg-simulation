import { describe, expect, it } from "vitest";
import { patchStandardExpansions } from "../src/lib/format/prepareStandardCorpus";

describe("patch Standard expansions", () => {
  it("re-fetches missing expansions and merges into the corpus", async () => {
    const corpus = await patchStandardExpansions(["SSP", "BLK"]);
    expect(corpus.manifest.totalCards).toBeGreaterThan(2000);
  }, 600_000);
});
