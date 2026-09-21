import { Page, expect } from "@playwright/test";
import { CommonPage } from "../common/common.page";
import { mockPokemonTcgApi } from "../../utils/mock-pokemon-api";

export class BattlePage {
  public readonly page: Page;
  public readonly commonPage: CommonPage;

  constructor(page: Page) {
    this.page = page;
    this.commonPage = new CommonPage(page);
  }

  private readonly SELECTOR = {
    root: '[data-testid="battle-setup"]',
    heading: "h2",
    playerName: '[data-testid="player-name"]',
    opponentName: '[data-testid="opponent-name"]',
    quickDragapult: '[data-testid="quick-dragapult"]',
    continueVs: '[data-testid="continue-vs"]',
    aiHeuristic: '[data-testid="ai-heuristic"]',
    aiLlm: '[data-testid="ai-llm"]',
    p1Summary: '[data-testid="p1-deck-summary"]',
    p2Summary: '[data-testid="p2-deck-summary"]',
    errorBox: '[data-testid="battle-error"]',
    vsScreen: '[data-testid="vs-screen"]',
    startBattle: '[data-testid="start-battle"]',
    vsBack: '[data-testid="vs-back"]',
    matchTable: '[data-testid="match-table"]',
    concede: '[data-testid="concede"]',
  };

  get root() {
    return this.page.locator(this.SELECTOR.root);
  }
  get heading() {
    return this.root.locator(this.SELECTOR.heading).filter({ hasText: "Battle" });
  }
  get playerName() {
    return this.page.locator(this.SELECTOR.playerName);
  }
  get opponentName() {
    return this.page.locator(this.SELECTOR.opponentName);
  }
  get quickDragapult() {
    return this.page.locator(this.SELECTOR.quickDragapult);
  }
  get continueVs() {
    return this.page.locator(this.SELECTOR.continueVs);
  }
  get aiHeuristic() {
    return this.page.locator(this.SELECTOR.aiHeuristic);
  }
  get aiLlm() {
    return this.page.locator(this.SELECTOR.aiLlm);
  }
  get p1Summary() {
    return this.page.locator(this.SELECTOR.p1Summary);
  }
  get p2Summary() {
    return this.page.locator(this.SELECTOR.p2Summary);
  }
  get vsScreen() {
    return this.page.locator(this.SELECTOR.vsScreen);
  }
  get startBattle() {
    return this.page.locator(this.SELECTOR.startBattle);
  }
  get matchTable() {
    return this.page.locator(this.SELECTOR.matchTable);
  }
  get concede() {
    return this.page.locator(this.SELECTOR.concede);
  }

  async verifySetupVisible() {
    await expect(this.root).toBeVisible();
    await expect(this.heading).toBeVisible();
    await expect(this.quickDragapult).toBeEnabled();
    await expect(this.continueVs).toBeDisabled();
  }

  async fillPlayerName(name: string) {
    await this.playerName.clear();
    await this.playerName.fill(name);
    await expect(this.playerName).toHaveValue(name);
  }

  async selectAiKind(option: "heuristic" | "llm") {
    if (option === "heuristic") {
      await this.aiHeuristic.check();
      await expect(this.aiHeuristic).toBeChecked();
    } else if (option === "llm") {
      await this.aiLlm.check();
      await expect(this.aiLlm).toBeChecked();
    } else {
      throw new Error(`Invalid AI kind: ${option}`);
    }
  }

  async clickQuickDragapult() {
    await mockPokemonTcgApi(this.page);
    await this.quickDragapult.click();
    await expect(this.p1Summary).toContainText("Valid", { timeout: 30_000 });
    await expect(this.p2Summary).toContainText("Valid");
    await expect(this.page.locator(this.SELECTOR.errorBox)).toHaveCount(0);
    await expect(this.continueVs).toBeEnabled();
  }

  async clickContinueToVs() {
    await this.continueVs.click();
    await expect(this.vsScreen).toBeVisible();
    await expect(this.vsScreen).toContainText("Ready to battle");
    await expect(this.startBattle).toBeEnabled();
  }

  async clickStartBattle() {
    await this.startBattle.click();
    await expect(this.matchTable).toBeVisible();
    await expect(this.concede).toBeVisible();
  }
}
