import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import { capturePresetSimulation } from "./simulationCapture";

describe("decision trace on captured frames", () => {
  it("attaches real heuristic scores (best-first) to trainer/ability/attack frames", () => {
    const a = getTournamentDeckById("utrecht-1-miloslav-posledni")!;
    const b = getTournamentDeckById("utrecht-2-hasan-kunukcu")!;
    const frames = capturePresetSimulation(a, b, { seed: 1 });

    const traced = frames.filter((f) => f.decision && f.decision.length > 0);
    expect(traced.length).toBeGreaterThan(0);

    for (const f of traced) {
      // best-first ordering
      for (let i = 1; i < f.decision!.length; i += 1) {
        expect(f.decision![i - 1]!.score).toBeGreaterThanOrEqual(f.decision![i]!.score);
      }
      // every candidate has a label and a positive score
      for (const c of f.decision!) {
        expect(c.label.length).toBeGreaterThan(0);
        expect(c.score).toBeGreaterThan(0);
      }
      // at most 4 candidates surfaced
      expect(f.decision!.length).toBeLessThanOrEqual(4);
    }

    // A multi-option trainer turn should expose more than one candidate somewhere.
    expect(traced.some((f) => f.category === "trainer" && f.decision!.length >= 2)).toBe(true);
  });
});
