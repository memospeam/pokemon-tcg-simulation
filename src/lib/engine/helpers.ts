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
  // The old code did `rngSeed += 1; createRng(rngSeed).next() >= 0.5`, taking
  // the FIRST output of an LCG freshly seeded with a small integer. rngSeed
  // stays small all game (shuffles only += 1), and an LCG's first output for
  // small sequential seeds sits at ~0.237 (top bit always 0) → every coin flip
  // came up tails, silently breaking Crushing Hammer, Triple Smash, etc.
  //
  // Fix: advance + persist the stream state, then derive the coin from a
  // Murmur3 finalizer so the bit is unbiased even for a small starting seed
  // (the LCG's raw high bits are not).
  const rng = createRng(state.rngSeed);
  const advanced = (rng.next() * 0x100000000) >>> 0;
  state.rngSeed = advanced;
  let h = advanced;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  const heads = (h & 1) === 0;
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
