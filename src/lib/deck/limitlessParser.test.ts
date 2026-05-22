import { describe, expect, it } from "vitest";
import { parseLimitlessDeckList } from "./limitlessParser";

const SAMPLE = `Pokémon: 18
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130

Trainer: 32
4 Ultra Ball MEG 131

Energy: 10
4 Psychic Energy MEE 5`;

describe("parseLimitlessDeckList", () => {
  it("parses sections and card lines", () => {
    const parsed = parseLimitlessDeckList(SAMPLE);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.sections.Pokémon).toBe(18);
    expect(parsed.lines).toHaveLength(5);
    expect(parsed.lines[0]).toMatchObject({
      count: 4,
      name: "Dreepy",
      setCode: "TWM",
      number: "128",
      section: "Pokémon",
    });
  });

  it("accepts name-only lines", () => {
    const parsed = parseLimitlessDeckList(`Trainer: 1\n1 Boss's Orders`);
    expect(parsed.lines[0]?.name).toBe("Boss's Orders");
  });

  it("accepts Limitless section headers with spaces before colon", () => {
    const parsed = parseLimitlessDeckList(`Pokémon : 18
4 Dreepy TWM 128

Trainer : 32
4 Ultra Ball MEG 131

Energy : 10
4 Psychic Energy MEE 5`);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.sections.Pokémon).toBe(18);
    expect(parsed.lines).toHaveLength(3);
  });
});
