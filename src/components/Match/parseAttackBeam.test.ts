import { describe, expect, it } from "vitest";
import { parseAttackBeam } from "@/components/Match/parseAttackBeam";

describe("parseAttackBeam", () => {
  it("maps attacker on self active to self-to-opp beam", () => {
    const beam = parseAttackBeam(
      "Dragapult ex used Phantom Dive for 200 damage to Active.",
      "Dragapult ex",
      "Charizard ex",
      1,
    );
    expect(beam?.direction).toBe("self-to-opp");
  });

  it("maps attacker on opponent active to opp-to-self beam", () => {
    const beam = parseAttackBeam(
      "Charizard ex used Burning Attack for 180 damage to Active.",
      "Dragapult ex",
      "Charizard ex",
      2,
    );
    expect(beam?.direction).toBe("opp-to-self");
  });

  it("returns null for non-attack logs", () => {
    expect(parseAttackBeam("Coin flip: heads.", "A", "B", 3)).toBeNull();
  });
});
