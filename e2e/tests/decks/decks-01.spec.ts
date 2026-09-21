import { test } from "../../pages/base.fixture";

test.describe("Deck Builder", () => {
  test.beforeEach(async ({ commonPage }) => {
    await commonPage.gotoDecks();
  });

  test("TC-DECKS-01  Deck Builder shows sample list and Resolve stays enabled", async ({
    decksPage,
  }) => {
    await decksPage.verifyBuilderVisible();
  });

  test("TC-DECKS-02  Deck name fill is self-asserted", async ({ decksPage }) => {
    await decksPage.fillDeckName("Test Dragapult");
  });
});
