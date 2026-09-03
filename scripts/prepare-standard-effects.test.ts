import { describe, expect, it } from "vitest";
import { prepareStandardCorpus } from "../src/lib/format/prepareStandardCorpus";

describe("prepare Standard effect corpus", () => {
  it(
    "fetches Standard Pokémon and writes effect text corpus",
    async () => {
      const corpus = await prepareStandardCorpus();
      expect(corpus.manifest.totalCards).toBeGreaterThan(0);
      expect(corpus.effectTexts.length).toBeGreaterThan(0);
      console.log("\nStandard corpus summary:");
      console.log(`  Cards: ${corpus.manifest.totalCards}`);
      console.log(`  Unique attack texts: ${corpus.manifest.uniqueAttackTexts}`);
      console.log(`  Unique ability texts: ${corpus.manifest.uniqueAbilityTexts}`);
      console.log(`  Attack coverage:`, corpus.manifest.attackCoverage);
      console.log(`  Ability coverage:`, corpus.manifest.abilityCoverage);
      console.log(`  Unknown/partial patterns: ${corpus.effectTexts.filter((e) => e.coverage !== "full" && e.coverage !== "empty").length}`);
    },
    7_200_000,
  );
});
