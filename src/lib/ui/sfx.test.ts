import { describe, expect, it } from "vitest";
import { sfxCueForLine, sfxCueForLines } from "./sfx";

describe("match sound cues", () => {
  it("maps the log lines players hear", () => {
    expect(sfxCueForLine("Coin flip: heads")).toBe("coin");
    expect(sfxCueForLine("Dragapult ex used Phantom Dive for 200 damage to Active.")).toBe("attack");
    expect(sfxCueForLine("Dreepy was Knocked Out! AI took 1 prize card(s).")).toBe("ko");
    expect(sfxCueForLine("You placed Dreepy on the bench.")).toBe("play");
    expect(sfxCueForLine("Placed 1 damage counter on Munkidori (5 remaining).")).toBe("damage");
    expect(sfxCueForLine("You wins the game!")).toBe("win");
  });

  it("keeps one sound when a single action logs several lines", () => {
    expect(
      sfxCueForLines([
        "Dragapult ex used Phantom Dive for 200 damage to Active.",
        "Dreepy was Knocked Out! AI took 1 prize card(s).",
      ]),
    ).toBe("ko");
  });
});
