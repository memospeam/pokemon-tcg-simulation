import { describe, expect, it } from "vitest";
import { normalizeSetCode } from "../catalog/setCodeMap";
import { findCorpusCard } from "../deck/corpusDeckBuilder";
import {
  CHAOS_RISING_SIGNATURES,
  CRI_POKEMON_CORPUS_COUNT,
  CRI_SET_PRINTED_TOTAL,
  CRI_SPECIAL_ENERGY_NUMBERS,
  FOCUS_EXPANSION,
  STANDARD_FORMAT,
  countStandardCardsBySet,
  getStandardCardsBySet,
  getStandardEffectText,
  isStandardRegulationMark,
  summarizeFocusExpansion,
} from "./index";

describe("Standard format focus — Chaos Rising", () => {
  it("declares Chaos Rising as the focus expansion", () => {
    expect(STANDARD_FORMAT.focusExpansion.ptcgoCode).toBe("CRI");
    expect(STANDARD_FORMAT.focusExpansion.name).toBe("Chaos Rising");
    expect(FOCUS_EXPANSION.releaseDate).toBe("2026-05-22");
  });

  it("maps Limitless set codes CRI and ME4 to Chaos Rising", () => {
    expect(normalizeSetCode("CRI")).toBe("CRI");
    expect(normalizeSetCode("ME4")).toBe("CRI");
  });

  it("indexes the complete Chaos Rising set, including the Special Energies", () => {
    const criCards = getStandardCardsBySet("CRI");
    expect(criCards.length).toBe(CRI_SET_PRINTED_TOTAL);
    const energies = criCards.filter((card) => card.supertype === "Energy");
    expect(energies.map((card) => card.number).sort()).toEqual([...CRI_SPECIAL_ENERGY_NUMBERS]);
    expect(energies.every((card) => card.subtypes.includes("Special"))).toBe(true);
    expect(criCards.length - energies.length).toBe(CRI_POKEMON_CORPUS_COUNT);
    const withMark = criCards.filter((card) => card.regulationMark);
    expect(withMark.length).toBeGreaterThan(0);
    expect(withMark.every((card) => isStandardRegulationMark(card.regulationMark))).toBe(true);
    expect(countStandardCardsBySet("CRI")).toBe(criCards.length);
  });

  it("lists CRI signature cards that resolve from the corpus", () => {
    for (const sig of CHAOS_RISING_SIGNATURES) {
      const match = findCorpusCard("CRI", sig.number, sig.card);
      expect(match?.name).toBe(sig.card);
      expect(match?.attacks.some((attack) => attack.name === sig.attack)).toBe(true);
      if ("ability" in sig && sig.ability) {
        expect(match?.abilities.some((ability) => ability.name === sig.ability)).toBe(true);
      }
    }
  });

  it("resolves Mega Greninja ex from a Chaos Rising deck line", () => {
    const match = findCorpusCard("CRI", "22", "Mega Greninja ex");
    expect(match?.name).toBe("Mega Greninja ex");
    expect(match?.attacks.some((attack) => attack.name === "Ninja Spinner")).toBe(true);
    expect(match?.abilities.some((ability) => ability.name === "Mortal Shuriken")).toBe(true);
  });

  it("implements Mortal Shuriken in the engine (no longer a focus gap)", () => {
    const summary = summarizeFocusExpansion();
    expect(summary.expansion.ptcgoCode).toBe("CRI");
    const mortal = summary.signatureGaps.find((gap) => gap.effectName === "Mortal Shuriken");
    expect(mortal).toBeUndefined();

    const record = getStandardEffectText("ability-4a376364");
    expect(record?.coverage).toBe("full");
    expect(record?.implementationCoverage).toBe("implemented");
    expect(record?.exampleCards).toContain("Mega Greninja ex");
  });

  it("parses Ninja Spinner from the corpus effect text", () => {
    const record = getStandardEffectText("attack-b926f76f");
    expect(record?.exampleCards).toContain("Mega Greninja ex");
    expect(record?.coverage).toBe("full");
    expect(record?.implementationCoverage).toBe("implemented");
    expect(record?.parsedEffects).toEqual([
      { kind: "return_typed_energy_to_hand", energyType: "Water" },
      { kind: "damage_per_discarded_basic_energy", perCard: 80 },
    ]);
  });
});
