import { describe, expect, it } from "vitest";
import { flipCoin, flipCoins } from "./helpers";
import type { EngineState } from "./types";

function stateWithSeed(seed: number): EngineState {
  return { log: [], rngSeed: seed } as unknown as EngineState;
}

describe("flipCoin distribution + determinism", () => {
  it("is roughly fair over many flips from a normal small seed", () => {
    // Regression: the old reseed-from-+1-integer flip returned tails on every
    // flip for small sequential seeds.
    const state = stateWithSeed(1);
    let heads = 0;
    const N = 2000;
    for (let i = 0; i < N; i += 1) if (flipCoin(state)) heads += 1;
    const ratio = heads / N;
    expect(ratio).toBeGreaterThan(0.42);
    expect(ratio).toBeLessThan(0.58);
  });

  it("is not biased to tails across many different starting seeds", () => {
    // One flip per seed, mirroring real games where each flip starts from a
    // freshly-advanced rngSeed. The old code returned tails for all of these.
    let heads = 0;
    const N = 500;
    for (let seed = 1; seed <= N; seed += 1) {
      if (flipCoin(stateWithSeed(seed))) heads += 1;
    }
    const ratio = heads / N;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it("is deterministic for a given seed", () => {
    const seq = (seed: number) => {
      const s = stateWithSeed(seed);
      return Array.from({ length: 10 }, () => flipCoin(s));
    };
    expect(seq(12345)).toEqual(seq(12345));
  });

  it("flipCoins counts heads consistently with flipCoin", () => {
    const a = stateWithSeed(777);
    const viaCount = flipCoins(a, 8);
    const b = stateWithSeed(777);
    let viaSingle = 0;
    for (let i = 0; i < 8; i += 1) if (flipCoin(b)) viaSingle += 1;
    expect(viaCount).toBe(viaSingle);
  });
});
