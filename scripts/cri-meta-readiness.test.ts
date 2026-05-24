import { describe, it } from "vitest";
import { runCriPlaytest } from "../src/lib/deck/criPlaytestRunner";

describe("CRI meta readiness report", () => {
  it("prints the consolidated playtest report", () => {
    const { markdown } = runCriPlaytest();
    // eslint-disable-next-line no-console
    console.log("\n" + markdown);
  }, 120_000);
});
