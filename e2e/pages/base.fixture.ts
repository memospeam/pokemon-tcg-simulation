import { test as base } from "@playwright/test";
import { CommonPage } from "./common/common.page";
import { BattlePage } from "./battle/battle.page";
import { DecksPage } from "./decks/decks.page";
import { AnalysisPage } from "./analysis/analysis.page";

type baseFixtures = {
  commonPage: CommonPage;
  battlePage: BattlePage;
  decksPage: DecksPage;
  analysisPage: AnalysisPage;
};

export const test = base.extend<baseFixtures>({
  page: async ({ page }, use) => {
    await page.goto("/battle");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await use(page);
  },
  commonPage: async ({ page }, use) => {
    await use(new CommonPage(page));
  },
  battlePage: async ({ page }, use) => {
    await use(new BattlePage(page));
  },
  decksPage: async ({ page }, use) => {
    await use(new DecksPage(page));
  },
  analysisPage: async ({ page }, use) => {
    await use(new AnalysisPage(page));
  },
});
