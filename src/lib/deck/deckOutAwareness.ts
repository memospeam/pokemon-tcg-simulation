/**
 * Deck-out awareness helpers for the AI.
 *
 * When our deck is shrinking, every "draw N" / "search the deck" action
 * brings us closer to losing by failing to draw. These helpers down-rank
 * deck-draining plays in two windows (critical / low) and up-rank plays
 * that put cards BACK into the deck (Iono, Lillie's Determination).
 *
 * Pure functions — easy to unit test in isolation.
 */

/**
 * Trainer names that REMOVE cards from the deck (draw / search) without
 * returning anything to it.
 *
 * NOT in this list — and intentionally so:
 *   - Iono / Lillie's Determination: shuffle hand into deck BEFORE drawing.
 *     Net deck change is usually near zero or positive; literally buys turns
 *     when our deck is short.
 *   - Boss's Orders / Crushing Hammer / Pokémon Catcher / stadiums:
 *     do not interact with the deck.
 *   - Night Stretcher / Sacred Ash: recover from discard, not from deck.
 */
export function isDeckDrainingTrainerName(nameLower: string): boolean {
  return (
    nameLower.includes("professor's research") ||
    nameLower.includes("professor sada") ||
    nameLower.includes("professor turo") ||
    nameLower.includes("hilda") ||
    nameLower.includes("ultra ball") ||
    nameLower.includes("nest ball") ||
    nameLower.includes("buddy-buddy poffin") ||
    nameLower.includes("poffin") ||
    nameLower.includes("pokégear") ||
    nameLower.includes("pokegear") ||
    nameLower.includes("crispin") ||
    nameLower.includes("dawn") ||
    nameLower.includes("colress")
  );
}

/** Active-ability names that draw or search from the deck. */
const DRAW_ABILITY_KEYWORDS = [
  "trade",            // N's Zoroark ex
  "recon directive",  // Drakloak
  "run errand",       // Mega Kangaskhan ex
  "run away draw",    // Dudunsparce
  "psychic draw",     // Kadabra
  "flip the script",  // Fezandipiti ex
  "fan call",         // (various)
] as const;

export function isDeckDrainingAbilityName(abilityLower: string): boolean {
  return DRAW_ABILITY_KEYWORDS.some((k) => abilityLower.includes(k));
}

/**
 * Apply deck-out awareness to a trainer's score.
 *
 * Tiers (by remaining deck size):
 *   • ≤ 4 cards (critical) — drain trainers go to -1 (we'd lose next turn);
 *     Iono / Lillie's are boosted to ≥ 90 because reshuffling our hand back
 *     literally extends the game.
 *   • ≤ 10 cards (low) — drain trainers take a flat -35 penalty; Iono /
 *     Lillie's get a small +10 boost.
 *   • Otherwise — no change.
 *
 * Returns the adjusted score.
 */
export function applyDeckOutTrainerPenalty(
  baseScore: number,
  trainerNameLower: string,
  deckSize: number,
): number {
  const critical = deckSize <= 4;
  const low      = deckSize <= 10;

  let score = baseScore;

  if (isDeckDrainingTrainerName(trainerNameLower)) {
    if (critical) {
      score = -1;
    } else if (low) {
      score = score - 35;
    }
  }

  if (trainerNameLower.includes("iono") || trainerNameLower.includes("lillie")) {
    if (critical) {
      // Reshuffles hand into deck before drawing — buy turns.
      score = Math.max(score, 90);
    } else if (low) {
      score = score + 10;
    }
  }

  return score;
}

/**
 * Apply deck-out awareness to an activated-ability score.
 *
 * Tiers (by remaining deck size):
 *   • ≤ 3 cards — drain ability → -1 (never burn our own deck flat).
 *   • ≤ 7 cards — flat -35 penalty (yield to other plays).
 *   • ≤ 13 cards — flat -18 penalty (yield earlier so a pure-draw ability
 *     doesn't mill into the danger zone before the hard penalty applies).
 *   • Otherwise — no change.
 */
export function applyDeckOutAbilityPenalty(
  baseScore: number,
  abilityNameLower: string,
  deckSize: number,
): number {
  if (!isDeckDrainingAbilityName(abilityNameLower)) return baseScore;
  if (deckSize <= 3) return -1;
  if (deckSize <= 7) return Math.max(0, baseScore - 35);
  if (deckSize <= 13) return Math.max(0, baseScore - 18);
  return baseScore;
}
