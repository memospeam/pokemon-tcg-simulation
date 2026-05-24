import { getTrainerRulesTextByCardName } from "../format/loadStandardCorpus";

/** Fallback rules when a card name is missing from effect-texts.json (legacy staples). */
const FALLBACK_TRAINER_RULES: Record<string, string> = {
  "Professor's Research":
    "Discard your hand and draw 7 cards. You may play only 1 Supporter card during your turn.",
  "Boss's Orders":
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. You may play only 1 Supporter card during your turn.",
  Crispin:
    "Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand. Attach the other to 1 of your Benched Pokémon. Then, shuffle your deck.",
  "Night Stretcher":
    "Put a Pokémon or a Basic Energy card from your discard pile into your hand. You may play any number of Item cards during your turn.",
};

export function resolveTrainerRulesText(cardName: string): string[] | undefined {
  const fromCorpus = getTrainerRulesTextByCardName(cardName);
  const text = fromCorpus ?? FALLBACK_TRAINER_RULES[cardName];
  if (!text) return undefined;
  return [text];
}
