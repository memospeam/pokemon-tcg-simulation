import type { Card } from "../models/card";

export interface BoosterPack {
  name: string;
  cardPool: Card[];
  packSize: number;
}

export interface PackOpeningResult {
  packName: string;
  cards: Card[];
}

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  choice<T>(items: T[]): T {
    const index = Math.floor(this.next() * items.length);
    return items[index];
  }
}

export function openBoosterPack(
  pack: BoosterPack,
  rng: Pick<SeededRandom, "choice"> = new SeededRandom(Date.now()),
): PackOpeningResult {
  if (pack.cardPool.length === 0) {
    throw new Error(`Pack '${pack.name}' has an empty card pool`);
  }

  const cards = Array.from({ length: pack.packSize }, () =>
    structuredClone(rng.choice(pack.cardPool)),
  );

  return { packName: pack.name, cards };
}
