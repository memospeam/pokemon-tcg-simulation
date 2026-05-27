/**
 * Hardcoded attack-cost overrides for meta-relevant Pokémon.
 *
 * BACKGROUND
 * The standard corpus index (`data/standard/cards-index.json`) is generated
 * without preserving the `cost` array from the Pokémon TCG API. As a result,
 * `corpusDeckBuilder.buildAttacks` invents a coarse fallback cost of one
 * energy of the inferred primary type, which is wrong for:
 *   - multi-energy attacks (e.g. Phantom Dive — 1 Psychic + 1 Fire)
 *   - cross-type attacks (e.g. Dark Frost on a non-Water inferred Pokémon)
 *
 * This file lets us layer authoritative costs on top of that fallback for
 * specific cards we know about.
 *
 * AUTHORITY
 * Entries are split into two tiers:
 *
 *   1. VERIFIED — confirmed by the user or by direct visual reference to
 *      the printed/promo card. Safe to rely on.
 *
 *   2. UNVERIFIED — best-effort entries we have NOT yet checked against
 *      the real cards. They may be wrong. Treat them as approximations
 *      until someone with the API key (POKEMONTCG_API_KEY) re-fetches the
 *      corpus with `cost` preserved.
 *
 * The right long-term fix is to update `prepareStandardCorpus.ts` to keep
 * the cost field and re-run the corpus build — at which point this file
 * becomes redundant.
 */

export interface KnownAttackCost {
  cost: string[];
  /** Optional explicit converted cost; otherwise derived from cost.length. */
  convertedEnergyCost?: number;
  /** Mark unverified entries clearly so future audits can prioritise them. */
  unverified?: true;
}

// ─── VERIFIED — user-confirmed or directly checked against the card ────────
const VERIFIED: Record<string, Record<string, KnownAttackCost>> = {
  "dragapult ex": {
    // User-corrected 2026-05-29: 1 Psychic + 1 Fire (2 energy total).
    "Phantom Dive": { cost: ["Psychic", "Fire"] },
  },
  "alakazam": {
    // User-corrected 2026-05-29: 1 Psychic only (1 energy total).
    // Note: substring match — also matches "Alakazam ex" if added later.
    "Powerful Hand": { cost: ["Psychic"] },
  },
  "team rocket's articuno": {
    // Confirmed cost from the user's original bug report — Dark Frost
    // requires 1 Water Energy.
    "Dark Frost": { cost: ["Water"] },
  },
};

// ─── UNVERIFIED — best-effort approximations, mark with `unverified: true` ─
// These entries cover meta cards whose real costs we have NOT yet confirmed.
// They're better than the 1-energy default (which silently breaks the
// energy AI's "fully loaded" check), but should not be trusted as accurate.
// Audit and either confirm-and-move-to-VERIFIED or correct as data lands.
const UNVERIFIED: Record<string, Record<string, KnownAttackCost>> = {
  "dragapult ex": {
    "Jet Headbutt": { cost: ["Colorless", "Colorless"], unverified: true },
  },
  "mega lopunny ex": {
    "Gale Thrust": { cost: ["Colorless", "Colorless"], unverified: true },
  },
  "team rocket's honchkrow": {
    "Rocket Feathers": { cost: ["Darkness", "Colorless"], unverified: true },
  },
  "greninja ex": {
    "Mist Slash": { cost: ["Water"], unverified: true },
  },
};

/**
 * Look up the canonical cost for a (pokemonName, attackName) pair.
 * Returns `null` if the attack is not in the override tables — the caller
 * should fall back to its default cost-inference logic.
 *
 * VERIFIED entries take precedence over UNVERIFIED.
 */
export function lookupAttackCost(
  pokemonName: string,
  attackName: string,
): KnownAttackCost | null {
  const nameKey = pokemonName.toLowerCase();

  // 1. Check the verified table first.
  for (const [keyword, attacks] of Object.entries(VERIFIED)) {
    if (nameKey.includes(keyword)) {
      const found = attacks[attackName];
      if (found) return found;
    }
  }

  // 2. Fall back to unverified entries.
  for (const [keyword, attacks] of Object.entries(UNVERIFIED)) {
    if (nameKey.includes(keyword)) {
      const found = attacks[attackName];
      if (found) return found;
    }
  }

  return null;
}
