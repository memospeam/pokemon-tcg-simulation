import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildCriMetaReadinessReport,
  formatCriMetaReadinessReport,
  type BuildCriMetaReadinessReportOptions,
  type CriMetaReadinessReport,
} from "./metaReadinessReport";
import type { DeckTierEntry } from "./playtestRunner";

export interface RunCriPlaytestOptions extends BuildCriMetaReadinessReportOptions {
  /** When set, writes formatted markdown to this path. */
  writeReportPath?: string;
}

export interface CriPlaytestResult {
  report: CriMetaReadinessReport;
  markdown: string;
  deckTierList: DeckTierEntry[];
}

/** Single entry point for CRI static analysis + auto-play batch metrics. */
export function runCriPlaytest(options: RunCriPlaytestOptions = {}): CriPlaytestResult {
  const report = buildCriMetaReadinessReport(options);
  const markdown = formatCriMetaReadinessReport(report);

  if (options.writeReportPath) {
    mkdirSync(dirname(options.writeReportPath), { recursive: true });
    writeFileSync(options.writeReportPath, markdown, "utf8");
  }

  return {
    report,
    markdown,
    deckTierList: report.deckTierList,
  };
}
