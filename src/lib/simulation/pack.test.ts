import { describe, expect, it } from "vitest";
import { openSamplePack } from "./index";

describe("openSamplePack", () => {
  it("returns 10 cards", () => {
    const result = openSamplePack(42);
    expect(result.cards).toHaveLength(10);
    expect(result.packName).toBeTruthy();
  });

  it("is reproducible with the same seed", () => {
    const first = openSamplePack(123);
    const second = openSamplePack(123);
    expect(first.cards.map((c) => c.name)).toEqual(second.cards.map((c) => c.name));
  });
});
