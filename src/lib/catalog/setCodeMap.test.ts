import { describe, expect, it } from "vitest";
import { normalizeSetCode } from "../catalog/setCodeMap";

describe("set code map", () => {
  it("normalizes Chaos Rising aliases to CRI", () => {
    expect(normalizeSetCode("cri")).toBe("CRI");
    expect(normalizeSetCode("ME4")).toBe("CRI");
  });

  it("normalizes 30th Celebration aliases to 30C", () => {
    expect(normalizeSetCode("30c")).toBe("30C");
    expect(normalizeSetCode("ME55")).toBe("30C");
  });
});
