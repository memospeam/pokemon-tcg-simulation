import type { CardDefinition } from "../models/definition";
import type { PokemonTcgApiCard } from "./types";

export function mapApiCard(card: PokemonTcgApiCard): CardDefinition {
  return {
    apiId: card.id,
    name: card.name,
    supertype: card.supertype as CardDefinition["supertype"],
    subtypes: card.subtypes ?? [],
    hp: card.hp,
    types: card.types,
    attacks: card.attacks,
    abilities: card.abilities,
    weaknesses: card.weaknesses,
    resistances: card.resistances,
    retreatCost: card.retreatCost,
    convertedRetreatCost: card.convertedRetreatCost,
    rules: card.rules,
    regulationMark: card.regulationMark,
    set: {
      id: card.set.id,
      name: card.set.name,
      ptcgoCode: card.set.ptcgoCode,
    },
    number: card.number,
    images: card.images,
    evolvesFrom: card.evolvesFrom,
  };
}
