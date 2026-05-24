import { describe, expect, it } from "vitest";
import { loadStandardCorpus, getStandardEffectText } from "../src/lib/format/loadStandardCorpus";

describe("Standard effect corpus", () => {
  it("loads prepared corpus from data/standard", () => {
    const corpus = loadStandardCorpus();
    expect(corpus.manifest.totalCards).toBeGreaterThan(2000);
    expect(corpus.manifest.format.regulationMarks).toEqual(["H", "I", "J"]);
    expect(corpus.effectTexts.length).toBe(
      corpus.manifest.uniqueAttackTexts +
        corpus.manifest.uniqueAbilityTexts +
        (corpus.manifest.uniqueTrainerTexts ?? 0),
    );
  });

  it("includes parsed Recon Directive ability", () => {
    const matches = loadStandardCorpus().effectTexts.filter((entry) =>
      entry.text.includes("look at the top 2 cards of your deck"),
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.coverage).toBe("full");
    expect(matches[0]?.parsedEffects[0]).toMatchObject({ kind: "recon_directive" });
  });

  it("indexes effect texts by id", () => {
    const corpus = loadStandardCorpus();
    const sample = corpus.effectTexts[0];
    expect(sample).toBeDefined();
    expect(getStandardEffectText(sample!.id)).toEqual(sample);
  });
});
