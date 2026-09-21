import { Page, expect } from "@playwright/test";
import { CommonPage } from "../common/common.page";

export class AnalysisPage {
  public readonly page: Page;
  public readonly commonPage: CommonPage;

  constructor(page: Page) {
    this.page = page;
    this.commonPage = new CommonPage(page);
  }

  private readonly SELECTOR = {
    root: '[data-testid="analysis-lab"]',
    heading: "h2",
    tabWatch: '[data-testid="tab-watch"]',
    tabMatrix: '[data-testid="tab-matrix"]',
    runSimulation: '[data-testid="run-simulation"]',
    runMatrix: '[data-testid="run-matrix"]',
    matchTable: '[data-testid="match-table"]',
    simResult: '[data-testid="sim-result"]',
  };

  get root() {
    return this.page.locator(this.SELECTOR.root);
  }
  get heading() {
    return this.root.locator(this.SELECTOR.heading).filter({ hasText: "Analysis Lab" });
  }
  get tabWatch() {
    return this.page.locator(this.SELECTOR.tabWatch);
  }
  get tabMatrix() {
    return this.page.locator(this.SELECTOR.tabMatrix);
  }
  get runSimulation() {
    return this.page.locator(this.SELECTOR.runSimulation);
  }
  get runMatrix() {
    return this.page.locator(this.SELECTOR.runMatrix);
  }
  get matchTable() {
    return this.page.locator(this.SELECTOR.matchTable);
  }
  get simResult() {
    return this.page.locator(this.SELECTOR.simResult);
  }

  async verifyLabVisible() {
    await expect(this.root).toBeVisible();
    await expect(this.heading).toBeVisible();
    await expect(this.tabWatch).toHaveClass(/tabs__button--active/);
    await expect(this.runSimulation).toBeEnabled();
  }

  async clickWatchTab() {
    await this.tabWatch.click();
    await expect(this.tabWatch).toHaveClass(/tabs__button--active/);
    await expect(this.runSimulation).toBeVisible();
  }

  async clickMatrixTab() {
    await this.tabMatrix.click();
    await expect(this.tabMatrix).toHaveClass(/tabs__button--active/);
    await expect(this.runMatrix).toBeEnabled();
  }

  async clickRunSimulation() {
    await this.runSimulation.click();
    await expect(this.matchTable).toBeVisible({ timeout: 60_000 });
    await expect(this.simResult).toBeVisible();
    await expect(this.runSimulation).toBeEnabled();
    await expect(this.runSimulation).toHaveText("Run Simulation");
  }
}
