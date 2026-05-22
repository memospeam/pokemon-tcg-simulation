import type { CardDefinition } from "@/lib/models/definition";
import { isStadium, isSupporter } from "@/lib/models/definition";

export function getTrainerHint(def: CardDefinition): string {
  const name = def.name.toLowerCase();

  if (name.includes("lillie")) {
    return "Shuffle your hand into your deck, then draw 6 cards (8 if you have exactly 6 Prize cards left).";
  }
  if (name.includes("professor")) return "Discard your hand and draw 7 cards.";
  if (name.includes("crispin")) {
    return "Search a Basic Energy and attach it to a Basic Pokémon. You may discard 1 card to draw 2.";
  }
  if (name.includes("ultra ball")) return "Discard 2 cards, then search your deck for a Pokémon.";
  if (name.includes("poké pad") || name.includes("poke pad")) {
    return "Search your deck for a Pokémon without a Rule Box and put it into your hand.";
  }
  if (name.includes("poffin")) {
    return "Search up to 2 Basic Pokémon (70 HP or less) and put them onto your Bench.";
  }
  if (name === "judge") return "Both players shuffle hands into deck and draw 4.";
  if (name.includes("boss")) return "Switch 1 of your opponent's Benched Pokémon with their Active.";
  if (name.includes("night stretcher")) return "Put a Pokémon from your discard pile into your hand.";
  if (name.includes("crushing hammer")) return "Flip a coin. If heads, discard an Energy from opponent's Pokémon.";
  if (name.includes("rare candy")) {
    return "Evolve a Basic Pokémon using a Stage 2 from your hand (skip Stage 1).";
  }
  if (name.includes("unfair stamp")) {
    return "If opponent has ≤3 Prize cards, they shuffle hand into deck and draw 4.";
  }
  if (name.includes("risky ruins")) return "When a Basic is put on Bench, it takes 10 damage.";
  if (isStadium(def)) return "Place this Stadium in play.";
  if (isSupporter(def)) {
    return "Play once per turn as a Supporter. The player who goes first cannot play Supporters on Turn 1.";
  }
  return "Play this Trainer card.";
}

export function getTrainerCategory(def: CardDefinition): string {
  if (isSupporter(def)) return "Supporter";
  if (isStadium(def)) return "Stadium";
  if (def.subtypes.includes("Tool")) return "Tool";
  return "Item";
}

export function getPendingPrompt(pending: import("@/lib/engine").PendingAction): string | null {
  if (!pending) return null;
  switch (pending.type) {
    case "ULTRA_BALL_DISCARD":
      return `Ultra Ball: choose ${2 - pending.selectedIds.length} more card(s) to discard from your hand.`;
    case "SEARCH_DECK":
      return pending.filter === "POFFIN"
        ? "Buddy-Buddy Poffin: choose a Pokémon to put on your Bench."
        : pending.filter === "POKEMON_NO_RULE_BOX"
          ? "Poké Pad: choose a Pokémon without a Rule Box from your deck."
          : "Choose a card from your deck search results.";
    case "RECON_DIRECTIVE":
      return "Recon Directive: choose 1 of the top 2 cards of your deck.";
    case "PICK_DISCARD":
      return "Night Stretcher: open your discard pile and choose a Pokémon.";
    case "RARE_CANDY":
      return "Rare Candy: choose a Basic Pokémon in play to evolve.";
    case "CRUSHING_HAMMER":
      return "Crushing Hammer (heads): choose an Energy to discard.";
    case "CRISPIN_ATTACH":
      return "Crispin: choose a Basic Pokémon to attach the Energy.";
    case "CRISPIN_DISCARD":
      return "Crispin (optional): discard 1 card to draw 2, or skip.";
    default:
      return null;
  }
}
