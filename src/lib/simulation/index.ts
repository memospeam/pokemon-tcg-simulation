import { createSampleDeck } from "../models";
import { openBoosterPack, SeededRandom, type BoosterPack, type PackOpeningResult } from "./pack";

export function createSampleBoosterPack(name = "Sample Booster"): BoosterPack {
  return {
    name,
    cardPool: createSampleDeck("pool").cards,
    packSize: 10,
  };
}

export function openSamplePack(seed?: number): PackOpeningResult {
  const rng = seed === undefined ? new SeededRandom(Date.now()) : new SeededRandom(seed);
  return openBoosterPack(createSampleBoosterPack(), rng);
}

export type { BoosterPack, PackOpeningResult };
