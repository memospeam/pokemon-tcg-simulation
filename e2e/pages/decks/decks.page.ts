import { Page, expect } from "@playwright/test";
import { CommonPage } from "../common/common.page";

export class DecksPage {
  public readonly page: Page;
  public readonly commonPage: CommonPage;

  constructor(page: Page) {
    this.page = page;
    this.commonPage = new CommonPage(page);
  }

  private readonly SELECTOR = {
    root: '[data-testid="deck-builder"]',
    heading: "h2",
    deckName: '[data-testid="deck-name"]',
    textarea: '[data-testid="deck-textarea"]',
    resolve: '[data-testid="resolve-deck"]',
  };

  get root() {
    return this.page.locator(this.SELECTOR.root);
  }
  get heading() {
    return this.root.locator(this.SELECTOR.heading).filter({ hasText: "Deck Builder" });
  }
  get deckName() {
    return this.page.locator(this.SELECTOR.deckName);
  }
  get textarea() {
    return this.page.locator(this.SELECTOR.textarea);
  }
  get resolve() {
    return this.page.locator(this.SELECTOR.resolve);
  }

  async verifyBuilderVisible() {
    await expect(this.root).toBeVisible();
    await expect(this.heading).toBeVisible();
    await expect(this.resolve).toBeEnabled();
    await expect(this.textarea).not.toHaveValue("");
  }

  async fillDeckName(name: string) {
    await this.deckName.clear();
    await this.deckName.fill(name);
    await expect(this.deckName).toHaveValue(name);
  }
}
