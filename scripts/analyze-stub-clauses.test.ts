import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseAbilityText, parseAttackText } from "../src/lib/engine/effects/parseText";
import type { EffectTextRecord } from "../src/lib/format/prepareStandardCorpus";

describe("analyze stub clauses", () => {
  it("prints top stub clause texts", () => {
    const records = JSON.parse(
      readFileSync("data/standard/effect-texts.json", "utf8"),
    ) as EffectTextRecord[];
    const clauseCounts = new Map<string, number>();
    for (const record of records) {
      const effects =
        record.kind === "attack"
          ? parseAttackText(record.text)
          : parseAbilityText({ name: "x", type: "Ability", text: record.text }).effects;
      for (const effect of effects) {
        if (effect.kind !== "generic_effect_stub") continue;
        clauseCounts.set(effect.text, (clauseCounts.get(effect.text) ?? 0) + record.cardCount);
      }
    }
    const top = [...clauseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log("\nTop stub clauses:");
    for (const [text, count] of top) {
      console.log(`[${count}] ${text}`);
    }
  });
});
