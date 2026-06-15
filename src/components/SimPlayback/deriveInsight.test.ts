import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "@/lib/deck/tournamentPresets";
import { capturePresetSimulation } from "@/lib/deck/simulationCapture";
import { deriveInsight } from "./deriveInsight";

describe("deriveInsight", () => {
  it("always produces a non-empty reasoning for every frame", () => {
    const a = getTournamentDeckById("utrecht-13-constantin-geisb-sch")!;
    const b = getTournamentDeckById("utrecht-1-miloslav-posledni")!;
    const frames = capturePresetSimulation(a, b, { seed: 3 });
    for (let i = 0; i < frames.length; i += 1) {
      const ins = deriveInsight(frames[i - 1]?.state, frames[i]!.state, frames[i]!.category, frames[i]!.label, frames[i]!.logDelta);
      expect(ins.reasoning.length).toBeGreaterThan(0);
    }
  });

  it("surfaces KO and prize badges from a knockout frame's log", () => {
    const ins = deriveInsight(
      undefined,
      { log: [], currentPlayerId: "p1" } as never,
      "attack",
      "Dragapult ex used Phantom Dive for 200 damage to Active.",
      [
        "Dragapult ex used Phantom Dive for 200 damage to Active.",
        "Cynthia's Gabite was Knocked Out! Hasan took 1 prize card(s).",
      ],
    );
    expect(ins.reasoning).toContain("Phantom Dive");
    expect(ins.badges.some((b) => b.text.includes("KO") && b.text.includes("Cynthia's Gabite"))).toBe(true);
    expect(ins.badges.some((b) => b.text.includes("ไพรซ์"))).toBe(true);
  });

  it("reads the attack name from logDelta even when the headline label is a follow-up prompt", () => {
    const ins = deriveInsight(
      undefined,
      { log: [], currentPlayerId: "p1" } as never,
      "attack",
      "Player must promote a benched Pokémon.",
      [
        "Cynthia's Garchomp ex used Draconic Buster for 260 damage to Active.",
        "Mega Lopunny ex was Knocked Out! Cynthia took 2 prize card(s).",
        "Player must promote a benched Pokémon.",
      ],
    );
    expect(ins.reasoning).toContain("Draconic Buster");
    expect(ins.badges.some((b) => b.text.includes("เก็บ 2 ไพรซ์"))).toBe(true);
  });

  it("describes a Crushing Hammer play as energy denial", () => {
    const ins = deriveInsight(undefined, { log: [], currentPlayerId: "p1" } as never, "trainer", "Hasan played Crushing Hammer.", ["Hasan played Crushing Hammer."]);
    expect(ins.reasoning).toContain("พลังงาน");
  });
});
