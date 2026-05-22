import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAbilityText, parseAttackText } from "../engine/effects/parseText";
import {
  analyzeParsedEffects,
  countImplementationStats,
  type StubPatternRecord,
} from "./effectCoverage";
import type { EffectTextRecord } from "./prepareStandardCorpus";

async function runReport(): Promise<void> {
  const dataDir = path.join(process.cwd(), "data/standard");
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path.join(dataDir, "effect-texts.json"), "utf8");
  const records = JSON.parse(raw) as EffectTextRecord[];

  let attackFull = 0;
  let attackPartial = 0;
  let attackNone = 0;
  let attackEmpty = 0;
  let abilityFull = 0;
  let abilityPartial = 0;
  let abilityNone = 0;
  let abilityEmpty = 0;

  const unknownPatterns: StubPatternRecord[] = [];
  const stubPatterns: StubPatternRecord[] = [];
  const attackImpl: StubPatternRecord[] = [];
  const abilityImpl: StubPatternRecord[] = [];

  for (const record of records) {
    const effects =
      record.kind === "attack"
        ? parseAttackText(record.text)
        : parseAbilityText({ name: "x", type: "Ability", text: record.text }).effects;
    const analysis = analyzeParsedEffects(effects);

    if (record.kind === "attack") {
      if (analysis.parseCoverage === "full") attackFull += 1;
      else if (analysis.parseCoverage === "partial") attackPartial += 1;
      else if (analysis.parseCoverage === "none") attackNone += 1;
      else attackEmpty += 1;
      attackImpl.push({
        id: record.id,
        kind: record.kind,
        text: record.text,
        parseCoverage: analysis.parseCoverage,
        implementationCoverage: analysis.implementationCoverage,
        stubClauses: analysis.stubClauses,
        cardCount: record.cardCount,
        exampleCards: record.exampleCards,
      });
    } else {
      if (analysis.parseCoverage === "full") abilityFull += 1;
      else if (analysis.parseCoverage === "partial") abilityPartial += 1;
      else if (analysis.parseCoverage === "none") abilityNone += 1;
      else abilityEmpty += 1;
      abilityImpl.push({
        id: record.id,
        kind: record.kind,
        text: record.text,
        parseCoverage: analysis.parseCoverage,
        implementationCoverage: analysis.implementationCoverage,
        stubClauses: analysis.stubClauses,
        cardCount: record.cardCount,
        exampleCards: record.exampleCards,
      });
    }

    if (analysis.unknownClauses.length > 0) {
      unknownPatterns.push({
        id: record.id,
        kind: record.kind,
        text: record.text,
        parseCoverage: analysis.parseCoverage,
        implementationCoverage: analysis.implementationCoverage,
        stubClauses: analysis.stubClauses,
        cardCount: record.cardCount,
        exampleCards: record.exampleCards,
      });
    }

    if (analysis.stubClauses.length > 0) {
      stubPatterns.push({
        id: record.id,
        kind: record.kind,
        text: record.text,
        parseCoverage: analysis.parseCoverage,
        implementationCoverage: analysis.implementationCoverage,
        stubClauses: analysis.stubClauses,
        cardCount: record.cardCount,
        exampleCards: record.exampleCards,
      });
    }
  }

  unknownPatterns.sort((a, b) => b.cardCount - a.cardCount);
  stubPatterns.sort((a, b) => b.cardCount - a.cardCount);

  const attackImplementation = countImplementationStats(attackImpl);
  const abilityImplementation = countImplementationStats(abilityImpl);

  console.log("Parse coverage — Attack:", { full: attackFull, partial: attackPartial, none: attackNone, empty: attackEmpty });
  console.log("Parse coverage — Ability:", { full: abilityFull, partial: abilityPartial, none: abilityNone, empty: abilityEmpty });
  console.log(`Unknown patterns: ${unknownPatterns.length}`);
  console.log("Implementation coverage — Attack:", attackImplementation);
  console.log("Implementation coverage — Ability:", abilityImplementation);
  console.log(`Stub patterns (effect texts with ≥1 stub clause): ${stubPatterns.length}`);

  const stubClauseCounts = new Map<string, number>();
  for (const pattern of stubPatterns) {
    for (const clause of pattern.stubClauses) {
      stubClauseCounts.set(clause, (stubClauseCounts.get(clause) ?? 0) + pattern.cardCount);
    }
  }
  const topStubClauses = [...stubClauseCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log("\nTop 20 stub clauses by cardCount:");
  for (const [text, count] of topStubClauses.slice(0, 20)) {
    console.log(`  [${count}] ${text.slice(0, 100)}`);
  }

  console.log("\nTop 20 stub effect texts by cardCount:");
  for (const pattern of stubPatterns.slice(0, 20)) {
    console.log(`  [${pattern.cardCount}] ${pattern.kind}: ${pattern.text.slice(0, 80)}`);
    for (const clause of pattern.stubClauses.slice(0, 3)) {
      console.log(`      · ${clause.slice(0, 90)}`);
    }
  }

  await writeFile(
    path.join(dataDir, "stub-patterns.json"),
    `${JSON.stringify(stubPatterns, null, 2)}\n`,
  );
  console.log(`\nWrote ${stubPatterns.length} entries to data/standard/stub-patterns.json`);
}

export { runReport };

runReport().catch((error) => {
  console.error(error);
  process.exit(1);
});
