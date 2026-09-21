import { Page, expect } from "@playwright/test";

export class CommonPage {
  public readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly SELECTOR = {
    navBattle: '[data-testid="nav-battle"]',
    navDecks: '[data-testid="nav-decks"]',
    navAnalysis: '[data-testid="nav-analysis"]',
  };

  get navBattle() {
    return this.page.locator(this.SELECTOR.navBattle);
  }
  get navDecks() {
    return this.page.locator(this.SELECTOR.navDecks);
  }
  get navAnalysis() {
    return this.page.locator(this.SELECTOR.navAnalysis);
  }

  async gotoBattle() {
    await this.page.goto("/battle");
    await expect(this.navBattle).toHaveClass(/tabs__button--active/);
  }

  async gotoDecks() {
    await this.page.goto("/decks");
    await expect(this.navDecks).toHaveClass(/tabs__button--active/);
  }

  async gotoAnalysis() {
    await this.page.goto("/analysis");
    await expect(this.navAnalysis).toHaveClass(/tabs__button--active/);
  }

  async clickNavBattle() {
    await this.navBattle.click();
    await expect(this.page).toHaveURL(/\/battle/);
  }

  async clickNavDecks() {
    await this.navDecks.click();
    await expect(this.page).toHaveURL(/\/decks/);
  }

  async clickNavAnalysis() {
    await this.navAnalysis.click();
    await expect(this.page).toHaveURL(/\/analysis/);
  }
}
