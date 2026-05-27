/**
 * Hardcoded attack-cost overrides for meta-relevant Pokémon.
 *
 * Why this exists: the standard corpus index (`data/standard/cards-index.json`)
 * was built without preserving the `cost` field from the Pokémon TCG API.
 * As a fallback, `corpusDeckBuilder.buildAttacks` invents a 1-of-primary-type
 * cost for every attack — which means:
 *   - Dragapult ex's Phantom Dive (real cost: 2 Psychic + 1 Colorless) is
 *     treated as needing just 1 Psychic, so the AI thinks Dragapult is
 *     "fully loaded" after a single energy attach.
 *   - Team Rocket's Articuno's Dark Frost (real cost: 1 Water) is treated as
 *     1 Colorless because the deck has no Water energy, so any single energy
 *     can fuel it.
 *
 * Until the corpus is rebuilt with proper cost data, this lookup table
 * provides the authoritative costs for cards we know about. Keys are matched
 * against the Pokémon name (case-insensitive substring), then the attack
 * name (case-insensitive exact).
 */

export interface KnownAttackCost {
  cost: string[];
  /** Optional explicit converted cost; otherwise derived from cost.length. */
  convertedEnergyCost?: number;
}

const KNOWN: Record<string, Record<string, KnownAttackCost>> = {
  // ─── Dragapult ──────────────────────────────────────────────────────────
  "dragapult ex": {
    "Phantom Dive": { cost: ["Psychic", "Psychic", "Colorless"] },
    "Jet Headbutt": { cost: ["Colorless", "Colorless"] },
  },
  "drakloak": {
    "Shadow Mist": { cost: ["Psychic", "Colorless"] },
  },
  "dreepy": {
    "Dragon Headbutt": { cost: ["Colorless"] },
  },

  // ─── Lopunny ────────────────────────────────────────────────────────────
  "mega lopunny ex": {
    "Gale Thrust": { cost: ["Colorless", "Colorless"] },
    "Bouncy Punch": { cost: ["Colorless", "Colorless", "Colorless"] },
  },
  "buneary": {
    "Tackle": { cost: ["Colorless"] },
  },

  // ─── Rocket's Honchkrow ────────────────────────────────────────────────
  "team rocket's honchkrow": {
    "Rocket Feathers": { cost: ["Darkness", "Colorless"] },
  },
  "team rocket's murkrow": {
    "Skill Dive": { cost: ["Darkness"] },
    "Peck": { cost: ["Colorless"] },
  },
  "team rocket's articuno": {
    // The reason this file exists — real card requires 1 Water energy.
    "Dark Frost": { cost: ["Water"] },
  },
  "team rocket's porygon": {
    "Conversion": { cost: ["Colorless"] },
  },
  "team rocket's porygon2": {
    "Trick Gift": { cost: ["Colorless", "Colorless"] },
  },

  // ─── Cynthia's Garchomp ─────────────────────────────────────────────────
  "cynthia's garchomp ex": {
    "Dragon Stride": { cost: ["Fighting", "Fighting", "Colorless"] },
    "Linear Attack": { cost: ["Fighting"] },
  },
  "cynthia's gabite": {
    "Bite": { cost: ["Fighting"] },
  },
  "cynthia's gible": {
    "Take Down": { cost: ["Fighting"] },
  },

  // ─── N's Zoroark ────────────────────────────────────────────────────────
  "n's zoroark ex": {
    "Boss's Rage": { cost: ["Darkness", "Colorless"] },
  },
  "n's zorua": {
    "Scratch": { cost: ["Colorless"] },
  },
  "n's zekrom": {
    "Lightning Strike": { cost: ["Lightning", "Lightning"] },
  },

  // ─── Greninja ───────────────────────────────────────────────────────────
  "greninja ex": {
    "Mist Slash": { cost: ["Water"] },
    "Big Wave Splash": { cost: ["Water", "Water", "Colorless"] },
  },
  "frogadier": {
    "Aqua Edge": { cost: ["Water", "Colorless"] },
    "Summoning Jutsu": { cost: ["Water"] },
  },
  "froakie": {
    "Bubble Drain": { cost: ["Water"] },
  },
  "mega froslass ex": {
    "Resentful Refrain": { cost: ["Water"] },
  },

  // ─── Hydrapple ──────────────────────────────────────────────────────────
  "hydrapple ex": {
    "Apple Drum": { cost: ["Grass", "Grass"] },
    "Syrupy Splash": { cost: ["Grass", "Colorless"] },
  },
  "dipplin": {
    "Sticky Sap": { cost: ["Grass"] },
  },

  // ─── Alakazam ──────────────────────────────────────────────────────────
  "alakazam": {
    "Powerful Hand": { cost: ["Psychic", "Colorless"] },
  },
  "kadabra": {
    "Confuse Ray": { cost: ["Psychic", "Colorless"] },
  },

  // ─── Ogerpon Box (multi-attacker) ───────────────────────────────────────
  "teal mask ogerpon ex": {
    "Leafy Fall": { cost: ["Grass"] },
    "Teal Strike": { cost: ["Grass", "Colorless"] },
  },
  "wellspring mask ogerpon ex": {
    "Sparkling Riptide": { cost: ["Water", "Colorless"] },
  },
  "lillie's clefairy ex": {
    "Full Moon Rondo": { cost: ["Psychic", "Colorless"] },
  },
  "mega kangaskhan ex": {
    "Mega Punch": { cost: ["Colorless", "Colorless", "Colorless"] },
  },

  // ─── Common bench utility ──────────────────────────────────────────────
  "munkidori": {
    "Goodnight, Babies": { cost: ["Psychic"] },
  },
  "fezandipiti ex": {
    "Flip the Script": { cost: ["Darkness", "Colorless"] },
  },
  "latias ex": {
    "Eon Blade": { cost: ["Psychic", "Colorless", "Colorless"] },
  },
};

/**
 * Look up the canonical cost for a (pokemonName, attackName) pair.
 * Returns `null` if the attack is not in the override table — the caller
 * should fall back to its default cost-inference logic.
 */
export function lookupAttackCost(
  pokemonName: string,
  attackName: string,
): KnownAttackCost | null {
  const nameKey = pokemonName.toLowerCase();
  for (const [keyword, attacks] of Object.entries(KNOWN)) {
    if (nameKey.includes(keyword)) {
      const found = attacks[attackName];
      if (found) return found;
    }
  }
  return null;
}
