import { describe, expect, it } from "vitest";
import {
  getArchetypeEnergyPriority,
  STRATEGY_PROFILES,
  type Archetype,
} from "./deckStrategy";

/**
 * The energy-attachment AI uses `archPriority >= 85` to detect a deck's
 * primary attacker and grant it a boosted score (see pickBestEnergyTarget
 * in utrechtGameRunner.ts). This file locks in the contract: every known
 * meta archetype must have at least one Pokémon that crosses the threshold,
 * otherwise the primary-attacker bonus silently no-ops for that deck.
 *
 * If a new archetype is added with a primary attacker below 85, this test
 * will fail and force the author to either (a) raise its energyPriority,
 * or (b) lower the threshold in utrechtGameRunner.ts.
 */

const PRIMARY_THRESHOLD = 85;

const ARCHETYPES_WITH_PRIMARY: Archetype[] = [
  "dragapult",
  "dragapult-dusknoir",
  "lopunny",
  "honchkrow",
  "ogerpon-box",
  "garchomp",
  "zoroark",
  "greninja",
  "hydrapple",
  "alakazam",
];

describe("Energy AI — primary attacker coverage", () => {
  it.each(ARCHETYPES_WITH_PRIMARY)(
    "%s deck has at least one Pokémon with energyPriority >= 85",
    (archetype) => {
      const profile = STRATEGY_PROFILES[archetype];
      const primaries = profile.attackerRoles.filter(
        (role) => role.energyPriority >= PRIMARY_THRESHOLD,
      );
      expect(primaries.length).toBeGreaterThan(0);
    },
  );

  it.each(ARCHETYPES_WITH_PRIMARY)(
    "%s deck's role marked 'primary' clears the threshold",
    (archetype) => {
      const profile = STRATEGY_PROFILES[archetype];
      const primaryRole = profile.attackerRoles.find((role) => role.role === "primary");
      expect(primaryRole, `${archetype} should have a role marked 'primary'`).toBeDefined();
      expect(primaryRole!.energyPriority).toBeGreaterThanOrEqual(PRIMARY_THRESHOLD);
    },
  );

  it.each(ARCHETYPES_WITH_PRIMARY)(
    "getArchetypeEnergyPriority returns >= 85 for the %s primary attacker",
    (archetype) => {
      const profile = STRATEGY_PROFILES[archetype];
      const primary = profile.attackerRoles.find((role) => role.role === "primary")!;
      const priority = getArchetypeEnergyPriority(
        archetype,
        primary.pokemonName.toLowerCase(),
      );
      expect(priority).toBeGreaterThanOrEqual(PRIMARY_THRESHOLD);
    },
  );

  it("'unknown' archetype has no primary — primary-attacker bonus correctly no-ops", () => {
    // The 'unknown' archetype is the fallback when we can't detect the deck.
    // Without strategy data we can't reliably pick a primary, so the boost
    // is intentionally skipped. This test documents that behaviour.
    const profile = STRATEGY_PROFILES.unknown;
    expect(profile.attackerRoles).toEqual([]);
    // Any name through getArchetypeEnergyPriority on 'unknown' yields the
    // default value (currently 30), which is below the 85 threshold.
    expect(getArchetypeEnergyPriority("unknown", "any pokemon")).toBeLessThan(PRIMARY_THRESHOLD);
  });
});
