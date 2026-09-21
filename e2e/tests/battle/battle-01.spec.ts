import { test } from "../../pages/base.fixture";
import { expect } from "@playwright/test";

test.describe("Battle setup", () => {
  test.beforeEach(async ({ commonPage }) => {
    await commonPage.gotoBattle();
  });

  test("TC-BATTLE-01  Battle setup is visible and Continue stays disabled without decks", async ({
    battlePage,
  }) => {
    await battlePage.verifySetupVisible();
  });

  test("TC-BATTLE-02  Display name fill and Heuristic AI stay self-asserted", async ({
    battlePage,
  }) => {
    await battlePage.fillPlayerName("Ash");
    await battlePage.selectAiKind("heuristic");
    await expect(battlePage.continueVs).toBeDisabled();
  });

  test("TC-BATTLE-03  Mode tabs switch Battle / Decks / Analysis", async ({
    commonPage,
    battlePage,
    decksPage,
    analysisPage,
  }) => {
    await commonPage.clickNavDecks();
    await decksPage.verifyBuilderVisible();
    await commonPage.clickNavAnalysis();
    await analysisPage.verifyLabVisible();
    await commonPage.clickNavBattle();
    await battlePage.verifySetupVisible();
  });

  test("TC-BATTLE-04  Quick Dragapult continues to VS and starts the match", async ({
    battlePage,
  }) => {
    await battlePage.clickQuickDragapult();
    await battlePage.clickContinueToVs();
    await expect(battlePage.vsScreen).toContainText("Dragapult");
    await battlePage.clickStartBattle();
  });
});
