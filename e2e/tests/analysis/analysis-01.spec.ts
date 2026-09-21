import { test } from "../../pages/base.fixture";

test.describe("Analysis Lab", () => {
  test.beforeEach(async ({ commonPage }) => {
    await commonPage.gotoAnalysis();
  });

  test("TC-ANALYSIS-01  Watch match tab shows Run Simulation", async ({ analysisPage }) => {
    await analysisPage.verifyLabVisible();
  });

  test("TC-ANALYSIS-02  Batch matrix tab shows Run matrix", async ({ analysisPage }) => {
    await analysisPage.clickMatrixTab();
  });

  test("TC-ANALYSIS-03  Run Simulation loads a match table", async ({ analysisPage }) => {
    test.setTimeout(90_000);
    await analysisPage.clickRunSimulation();
  });
});
