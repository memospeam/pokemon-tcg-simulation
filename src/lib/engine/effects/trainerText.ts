import type { CardDefinition } from "../../models/definition";
import { isStadium, isTool } from "../../models/definition";
import { parseEffectClauses } from "./parseText";
import { parseStadiumFullText, parseTrainerClause, parseTrainerFullText } from "./parseTextTrainer";
import type { ParsedEffect } from "./types";
import { analyzeTrainerEffects } from "./trainerCoverage";
import type { ImplementationCoverage, ParseCoverage } from "../../format/effectCoverage";

const BOILERPLATE_PATTERNS = [
  /you may play only 1 supporter card during your turn/i,
  /you can't have more than 1 ace spec card in your deck/i,
  /you can't have more than 1 .* card in your deck/i,
  /\(.* rule\)/i,
  /this card can only be attached/i,
];

export function getTrainerEffectText(def: CardDefinition): string | null {
  if (def.supertype !== "Trainer" || isTool(def) || isStadium(def)) return null;
  if (!def.rules?.length) return null;

  const effectRules = def.rules.filter((rule) => !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(rule)));
  if (effectRules.length === 0) return null;
  return effectRules.join(" ");
}

export interface TrainerParseResult {
  text: string;
  effects: ParsedEffect[];
  unknownClauses: string[];
  parseCoverage: ParseCoverage;
  implementationCoverage: ImplementationCoverage;
}

function splitClauses(text: string): string[] {
  return text
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(/(?<=[.!])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function coverageFromEffects(effects: ParsedEffect[], unknownClauses: string[]): ParseCoverage {
  if (effects.length === 0 && unknownClauses.length === 0) return "empty";
  if (unknownClauses.length === 0) return "full";
  if (effects.length === 0) return "none";
  return "partial";
}

function implementationFromEffects(effects: ParsedEffect[]): ImplementationCoverage {
  const { hasTrainerEffects, allImplemented } = analyzeTrainerEffects(effects);
  if (effects.length === 0) return "empty";
  if (!hasTrainerEffects) return "unknown";
  return allImplemented ? "implemented" : "partial_stub";
}

export function parseTrainerText(def: CardDefinition): TrainerParseResult {
  if (isStadium(def)) {
    const text = def.rules?.join(" ") ?? "";
    const stadium = parseStadiumFullText(text);
    const effects = stadium ? [stadium as ParsedEffect] : [];
    return {
      text,
      effects,
      unknownClauses: stadium ? [] : [text || def.name],
      parseCoverage: stadium ? "full" : text ? "none" : "empty",
      implementationCoverage: stadium ? "implemented" : effects.length === 0 ? "empty" : "unknown",
    };
  }

  const text = getTrainerEffectText(def);
  if (!text) {
    return {
      text: "",
      effects: [],
      unknownClauses: [],
      parseCoverage: "empty",
      implementationCoverage: "empty",
    };
  }

  const fullMatch = parseTrainerFullText(text);
  if (fullMatch) {
    return {
      text,
      effects: fullMatch,
      unknownClauses: [],
      parseCoverage: "full",
      implementationCoverage: implementationFromEffects(fullMatch),
    };
  }

  const clauses = splitClauses(text);
  const effects: ParsedEffect[] = [];
  const unknownClauses: string[] = [];

  for (const clause of clauses) {
    const trainerMatch = parseTrainerClause(clause);
    if (trainerMatch) {
      effects.push(...trainerMatch.filter((effect) => effect.kind !== "generic_effect_stub"));
      continue;
    }

    const generic = parseEffectClauses(clause);
    const usable = generic.filter(
      (effect) => effect.kind !== "unknown" && effect.kind !== "generic_effect_stub",
    );
    if (usable.length > 0) {
      effects.push(...usable);
    } else {
      unknownClauses.push(clause);
    }
  }

  return {
    text,
    effects,
    unknownClauses,
    parseCoverage: coverageFromEffects(effects, unknownClauses),
    implementationCoverage: implementationFromEffects(effects),
  };
}
