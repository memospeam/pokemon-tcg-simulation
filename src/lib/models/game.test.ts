import { describe, expect, it } from "vitest";
import { GamePhase } from "../models/enums";
import { createSamplePlayer, setupGame } from "../models";

describe("setupGame", () => {
  it("initializes players with hands and prize cards", () => {
    const p1 = createSamplePlayer("Alice");
    const p2 = createSamplePlayer("Bob");
    const state = setupGame(p1, p2);

    expect(state.phase).toBe(GamePhase.Active);
    expect(p1.hand).toHaveLength(7);
    expect(p2.hand).toHaveLength(7);
    expect(p1.prizesRemaining).toBe(6);
    expect(p2.prizesRemaining).toBe(6);
    expect(state.log.length).toBeGreaterThanOrEqual(1);
  });

  it("builds a standard 60-card sample deck", () => {
    const player = createSamplePlayer("Test");
    expect(player.deck.size).toBe(60);
    expect(player.deck.isValidStandard()).toBe(true);
  });
});
