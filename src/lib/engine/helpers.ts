import { createRng } from "./rng";
import { getPlayer, type EngineState } from "./types";
import type { PlayerId } from "../models/enums";
import { Zone } from "../models/enums";

export function logMessage(state: EngineState, message: string): void {
  state.log.push(message);
}

export function shufflePlayerDeck(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  state.rngSeed += 1;
  const rng = createRng(state.rngSeed + player.deck.length);
  player.deck = rng.shuffle(player.deck);
}

export function flipCoin(state: EngineState): boolean {
  state.rngSeed += 1;
  const rng = createRng(state.rngSeed);
  const heads = rng.next() >= 0.5;
  logMessage(state, heads ? "Coin flip: heads." : "Coin flip: tails.");
  return heads;
}

export function flipCoins(state: EngineState, count: number): number {
  let heads = 0;
  for (let i = 0; i < count; i += 1) {
    if (flipCoin(state)) heads += 1;
  }
  return heads;
}

export function shuffleHandIntoDeck(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const returned = [...player.hand];
  player.hand = [];
  for (const card of returned) {
    card.zone = Zone.Deck;
    player.deck.push(card);
  }
  shufflePlayerDeck(state, playerId);
}
