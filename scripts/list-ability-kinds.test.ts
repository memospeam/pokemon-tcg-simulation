import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseAbilityText } from "../src/lib/engine/effects/parseText";

describe("ability kind inventory", () => {
  it("lists parsed ability effect kinds", () => {
    const records = JSON.parse(readFileSync("data/standard/effect-texts.json", "utf8"));
    const kinds = new Map<string, number>();
    let unknown = 0;

    for (const record of records) {
      if (record.kind !== "ability" || !record.text) continue;
      const effects = parseAbilityText({ name: "x", type: "Ability", text: record.text }).effects;
      for (const effect of effects) {
        kinds.set(effect.kind, (kinds.get(effect.kind) ?? 0) + 1);
        if (effect.kind === "unknown") unknown += 1;
      }
    }

    console.log("unknown effects:", unknown);
    console.log("unique kinds:", kinds.size);
    for (const [kind, count] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`${count}\t${kind}`);
    }
  });
});
