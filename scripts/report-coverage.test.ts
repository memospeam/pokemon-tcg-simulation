import { describe, it } from "vitest";
import { runReport } from "../src/lib/format/reportCoverage";

describe("standard effect coverage report", () => {
  it("prints parser coverage from cached corpus", async () => {
    await runReport();
  }, 30_000);
});
