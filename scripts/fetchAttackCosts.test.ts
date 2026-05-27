/**
 * Wrapper test that runs the fetchAttackCosts batch job and writes the
 * results to data/standard/attack-costs.json. Hits the public Pokémon TCG
 * API, so it's only run on demand:
 *
 *   npx vitest run scripts/fetchAttackCosts.test.ts
 *
 * Generous timeout — there are usually 60–100 unique Pokémon across all
 * tournament decks, ~250ms each = 15–25s of network time.
 */

import { describe, expect, it } from "vitest";
import { fetchAttackCosts, writeAttackCostsTable } from "./fetchAttackCosts";

describe("fetch attack costs from Pokémon TCG API", () => {
  it("fetches and writes attack costs for every Pokémon in the meta decks", async () => {
    const entries = await fetchAttackCosts();
    expect(entries.length).toBeGreaterThan(20);
    for (const entry of entries) {
      expect(entry.attacks.length).toBeGreaterThan(0);
      for (const attack of entry.attacks) {
        expect(Array.isArray(attack.cost)).toBe(true);
      }
    }
    await writeAttackCostsTable(entries);
  }, 600_000);
});
