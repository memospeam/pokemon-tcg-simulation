import { describe, expect, it } from "vitest";
import { normalizeSetCode } from "../catalog/setCodeMap";

describe("set code map", () => {
  it("normalizes Chaos Rising aliases to CRI", () => {
    expect(normalizeSetCode("cri")).toBe("CRI");
    expect(normalizeSetCode("ME4")).toBe("CRI");
  });
});
