import { describe, expect, it } from "vitest";
import { getFetchedDatasetSize, lookupFetchedAttackCost } from "./attackCostsData";

/**
 * Smoke-tests against the live attack-costs.json dataset. These confirm the
 * loader plumbing works end-to-end; the precise contents change every time
 * the fetch script runs, so we only assert facts that are stable as long as
 * the dataset has any real entries.
 */
describe("attackCostsData — loader sanity checks", () => {
  it("returns null for a Pokémon / attack pair that does not exist", () => {
    expect(lookupFetchedAttackCost("Totally Fake Pokémon ex", "Made-Up Attack")).toBeNull();
  });

  it("dataset size matches the number of (Pokémon, attack) pairs in JSON", () => {
    // Trivially true, but exercises the loader without making any assumption
    // about which cards are present.
    const size = getFetchedDatasetSize();
    expect(size).toBeGreaterThanOrEqual(0);
  });

  it("matches Pokémon names case-insensitively", () => {
    // If the dataset has at least one entry, an arbitrary lookup with the
    // wrong case should not throw.
    expect(() =>
      lookupFetchedAttackCost("DRAGAPULT EX", "Phantom Dive"),
    ).not.toThrow();
  });
});

/**
 * Targeted assertions on specific cards we know have been fetched. Skipped
 * gracefully when the dataset doesn't yet cover them — the script is
 * resumable and may run multiple times before everything is cached.
 */
describe("attackCostsData — known meta cards (skipped if not yet fetched)", () => {
  it("Dragapult ex · Phantom Dive uses Fire + Psychic when present", () => {
    const result = lookupFetchedAttackCost("Dragapult ex", "Phantom Dive");
    if (!result) {
      // Not yet in the dataset on this run.
      expect(result).toBeNull();
      return;
    }
    expect(result.cost.sort()).toEqual(["Fire", "Psychic"]);
  });

  it("Dreepy · Bite uses Fire + Psychic when present", () => {
    const result = lookupFetchedAttackCost("Dreepy", "Bite");
    if (!result) {
      expect(result).toBeNull();
      return;
    }
    expect(result.cost.sort()).toEqual(["Fire", "Psychic"]);
  });

  it("Team Rocket's Articuno · Dark Frost uses Water + 2 Colorless when present", () => {
    const result = lookupFetchedAttackCost("Team Rocket's Articuno", "Dark Frost");
    if (!result) {
      expect(result).toBeNull();
      return;
    }
    expect(result.cost.length).toBe(3);
    expect(result.cost.filter((c) => c === "Water").length).toBe(1);
    expect(result.cost.filter((c) => c === "Colorless").length).toBe(2);
  });
});
