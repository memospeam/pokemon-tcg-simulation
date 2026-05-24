import type { CardDefinition } from "@/lib/models/definition";
import { isStadium, isSupporter, isTool } from "@/lib/models/definition";
import { getTrainerEffectText } from "@/lib/engine/effects/trainerText";

export function getTrainerHint(def: CardDefinition): string {
  const catalogText = getTrainerEffectText(def);
  if (catalogText) return catalogText;

  const name = def.name.toLowerCase();
  if (isTool(def)) return "Attach this Tool to one of your Pokémon in play.";
  if (isStadium(def)) return "Place this Stadium in play.";
  if (isSupporter(def)) {
    return "Play once per turn as a Supporter. The player who goes first cannot play Supporters on Turn 1.";
  }
  if (name.includes("risky ruins")) return "When a Basic is put on Bench, it takes 10 damage.";
  return "Play this Trainer card.";
}

export function getTrainerCategory(def: CardDefinition): string {
  if (isSupporter(def)) return "Supporter";
  if (isStadium(def)) return "Stadium";
  if (isTool(def)) return "Tool";
  return "Item";
}

export function getPendingPrompt(pending: import("@/lib/engine").PendingAction): string | null {
  if (!pending) return null;
  switch (pending.type) {
    case "ULTRA_BALL_DISCARD":
      return `Ultra Ball: choose ${2 - pending.selectedIds.length} more card(s) to discard from your hand.`;
    case "SEARCH_DECK":
      if (pending.filter === "POFFIN") {
        return "Buddy-Buddy Poffin: choose a Pokémon to put on your Bench.";
      }
      if (pending.filter === "POKEMON_NO_RULE_BOX") {
        return "Poké Pad: choose a Pokémon without a Rule Box from your deck.";
      }
      if (pending.filter === "SUPPORTER_HAND") {
        return "Choose a Supporter from your deck.";
      }
      if (pending.filter === "POKEGEAR_TOP7") {
        return "Pokégear 3.0: choose a Supporter from the top 7 cards of your deck.";
      }
      if (pending.filter === "TOOL_HAND") {
        return `Treasure Tracker: choose up to ${pending.slotsRemaining ?? 1} Tool card(s) from your deck.`;
      }
      if (pending.filter === "TYPED_POKEMON_MAX_HP_HAND") {
        const type = pending.searchMeta?.typeFilter ?? "Pokémon";
        const maxHp = pending.searchMeta?.maxHp ?? 100;
        return `Fan Call: choose up to ${pending.slotsRemaining ?? 1} ${type} Pokémon with ${maxHp} HP or less.`;
      }
      if (pending.filter === "NAMED_POKEMON_BENCH") {
        return `Choose matching Pokémon for your Bench (${pending.options.length} found).`;
      }
      if (pending.slotsRemaining && pending.slotsRemaining > 1) {
        return `Choose cards from your deck (${pending.options.length} found, up to ${pending.slotsRemaining}).`;
      }
      return `Choose a card from your deck (${pending.options.length} found).`;
    case "HILDA":
      return pending.step === "EVOLUTION"
        ? "Hilda: choose an Evolution Pokémon from your deck."
        : "Hilda: choose an Energy card from your deck.";
    case "RECON_DIRECTIVE":
      return "Recon Directive: choose 1 of the top 2 cards of your deck.";
    case "PICK_DISCARD":
      return "Night Stretcher: choose a Pokémon from your discard pile (up to 3).";
    case "RARE_CANDY":
      return "Rare Candy: choose a Basic Pokémon in play to evolve.";
    case "CRUSHING_HAMMER":
      return "Crushing Hammer (heads): choose an Energy to discard.";
    case "ENHANCED_HAMMER":
      return pending.step === "POKEMON"
        ? "Enhanced Hammer: choose an opponent's Pokémon."
        : "Enhanced Hammer: choose Energy to discard.";
    case "ENERGY_SWITCH":
      return pending.step === "SOURCE"
        ? "Energy Switch: choose a Pokémon to move Basic Energy from."
        : "Energy Switch: choose a Pokémon to move Basic Energy to.";
    case "WALLYS_COMPASSION":
      return "Wally's Compassion: choose a Pokémon to heal and shuffle into your deck.";
    case "CRISPIN_ATTACH":
      return "Crispin: choose a Basic Pokémon to attach the Energy.";
    case "CRISPIN_DISCARD":
      return "Crispin (optional): discard 1 card to draw 2, or skip.";
    case "DRAW_UNTIL_HAND":
      return `You may draw until you have ${pending.targetCount} cards in your hand.`;
    case "TOOL_SCRAPPER":
      return `Tool Scrapper: choose ${pending.discardRemaining} Tool(s) to discard.`;
    case "GRAND_TREE":
      if (pending.step === "BASIC") return "Grand Tree: choose a Basic Pokémon to evolve.";
      if (pending.step === "STAGE1") return "Grand Tree: choose a Stage 1 from your deck.";
      return "Grand Tree: choose a Stage 2 from your deck, or skip.";
    case "ROTO_STICK":
      return "Roto-Stick: choose Supporter(s) from the top 4 cards of your deck.";
    case "MIRACLE_HEADSET":
      return `Miracle Headset: choose up to ${pending.maxPicks} Supporter(s) from your discard pile.`;
    case "BUG_CATCHING_SET":
      return `Bug Catching Set: choose up to ${pending.maxPicks} [G] Pokémon or Basic [G] Energy from the top 7 cards.`;
    case "SECRET_BOX":
      if (pending.step === "DISCARD") {
        return `Secret Box: discard ${3 - (pending.discardIds?.length ?? 0)} more card(s) from your hand.`;
      }
      return `Secret Box: choose a ${pending.step.toLowerCase()} card from your deck.`;
    default:
      return null;
  }
}
