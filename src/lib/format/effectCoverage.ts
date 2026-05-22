import type { ParsedEffect } from "../engine/effects/types";

export type ParseCoverage = "full" | "partial" | "none" | "empty";
export type ImplementationCoverage = "implemented" | "stub" | "partial_stub" | "unknown" | "empty";

export interface EffectAnalysis {
  parseCoverage: ParseCoverage;
  implementationCoverage: ImplementationCoverage;
  unknownClauses: string[];
  stubClauses: string[];
  effectKinds: ParsedEffect["kind"][];
}

const STUB_KIND: ParsedEffect["kind"] = "generic_effect_stub";

export function analyzeParsedEffects(effects: ParsedEffect[]): EffectAnalysis {
  if (effects.length === 0) {
    return {
      parseCoverage: "empty",
      implementationCoverage: "empty",
      unknownClauses: [],
      stubClauses: [],
      effectKinds: [],
    };
  }

  const unknownClauses = effects
    .filter((effect): effect is Extract<ParsedEffect, { kind: "unknown" }> => effect.kind === "unknown")
    .map((effect) => effect.text);
  const stubClauses = effects
    .filter(
      (effect): effect is Extract<ParsedEffect, { kind: "generic_effect_stub" }> =>
        effect.kind === STUB_KIND,
    )
    .map((effect) => effect.text);

  let parseCoverage: ParseCoverage;
  if (unknownClauses.length === 0) parseCoverage = "full";
  else if (unknownClauses.length === effects.length) parseCoverage = "none";
  else parseCoverage = "partial";

  let implementationCoverage: ImplementationCoverage;
  if (effects.length === 0) {
    implementationCoverage = "empty";
  } else if (unknownClauses.length > 0) {
    implementationCoverage = stubClauses.length > 0 ? "partial_stub" : "unknown";
  } else if (stubClauses.length === 0) {
    implementationCoverage = "implemented";
  } else if (stubClauses.length === effects.length) {
    implementationCoverage = "stub";
  } else {
    implementationCoverage = "partial_stub";
  }

  return {
    parseCoverage,
    implementationCoverage,
    unknownClauses,
    stubClauses,
    effectKinds: effects.map((effect) => effect.kind),
  };
}

export interface StubPatternRecord {
  id: string;
  kind: "attack" | "ability" | "trainer";
  text: string;
  parseCoverage: ParseCoverage;
  implementationCoverage: ImplementationCoverage;
  stubClauses: string[];
  cardCount: number;
  exampleCards: string[];
}

export interface ImplementationStats {
  implemented: number;
  stub: number;
  partial_stub: number;
  unknown: number;
  empty: number;
}

export function countImplementationStats(records: { implementationCoverage: ImplementationCoverage }[]): ImplementationStats {
  const stats: ImplementationStats = {
    implemented: 0,
    stub: 0,
    partial_stub: 0,
    unknown: 0,
    empty: 0,
  };
  for (const record of records) {
    stats[record.implementationCoverage] += 1;
  }
  return stats;
}
