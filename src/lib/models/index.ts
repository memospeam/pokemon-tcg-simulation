import {
  CardType,
  EnergyType,
  GamePhase,
  PokemonStage,
  TrainerSubtype,
} from "./enums";
import { createId, type Card, type EnergyCard, type PokemonCard, type TrainerCard } from "./card";
import { Deck } from "./deck";
import { GameState } from "./game";
import { Player } from "./player";

export function createSampleDeck(name: string): Deck {
  const deck = new Deck(name);

  for (let i = 0; i < 20; i += 1) {
    const card: PokemonCard = {
      id: createId(),
      name: `Sample Pokémon ${i + 1}`,
      cardType: CardType.Pokemon,
      hp: 60 + (i % 3) * 20,
      stage: PokemonStage.Basic,
      energyTypes: [i % 2 === 0 ? EnergyType.Fire : EnergyType.Water],
    };
    deck.add(card);
  }

  for (let i = 0; i < 20; i += 1) {
    const card: EnergyCard = {
      id: createId(),
      name: `Basic Energy ${i + 1}`,
      cardType: CardType.Energy,
      energyType: EnergyType.Colorless,
    };
    deck.add(card);
  }

  for (let i = 0; i < 20; i += 1) {
    const card: TrainerCard = {
      id: createId(),
      name: `Sample Trainer ${i + 1}`,
      cardType: CardType.Trainer,
      subtype: i % 2 === 0 ? TrainerSubtype.Item : TrainerSubtype.Supporter,
    };
    deck.add(card);
  }

  return deck;
}

export function createSamplePlayer(name: string): Player {
  return new Player(name, createSampleDeck(name));
}

export function setupGame(player1: Player, player2: Player): GameState {
  const state = new GameState(player1, player2);

  for (const player of state.players) {
    player.deck.shuffle();
    player.setupPrizes();
    player.drawToHand(7);
  }

  state.phase = GamePhase.Active;
  state.logEvent(`Game started: ${player1.name} vs ${player2.name}`);
  return state;
}

export type { Card, EnergyCard, PokemonCard, TrainerCard };
