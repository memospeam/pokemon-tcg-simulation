import { CardType, EnergyType, PokemonStage, TrainerSubtype } from "./enums";

export interface BaseCard {
  id: string;
  name: string;
  cardType: CardType;
}

export interface PokemonCard extends BaseCard {
  cardType: CardType.Pokemon;
  hp: number;
  stage: PokemonStage;
  energyTypes: EnergyType[];
}

export interface TrainerCard extends BaseCard {
  cardType: CardType.Trainer;
  subtype: TrainerSubtype;
}

export interface EnergyCard extends BaseCard {
  cardType: CardType.Energy;
  energyType: EnergyType;
}

export type Card = PokemonCard | TrainerCard | EnergyCard;

export function createId(): string {
  return crypto.randomUUID();
}

export function cardLabel(card: Card): string {
  return card.name;
}

export function cardDetail(card: Card): string {
  switch (card.cardType) {
    case CardType.Pokemon:
      return `${card.stage} · ${card.hp} HP · ${card.energyTypes.join(", ")}`;
    case CardType.Trainer:
      return card.subtype;
    case CardType.Energy:
      return card.energyType;
  }
}
