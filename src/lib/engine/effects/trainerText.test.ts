import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { parseTrainerText } from "./trainerText";

function mockTrainer(name: string, rules: string[], subtypes: string[] = ["Supporter"]): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Trainer",
    subtypes,
    rules,
    set: { id: "test", name: "Test" },
    number: "1",
    images: { small: "", large: "" },
  };
}

describe("parseTrainerText", () => {
  it("parses Hilda from catalog rules text", () => {
    const def = mockTrainer("Hilda", [
      "Search your deck for an Evolution Pokémon and an Energy card, reveal them, and put them into your hand. Then, shuffle your deck.",
      "You may play only 1 Supporter card during your turn.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects).toEqual([{ kind: "trainer_hilda" }]);
    expect(parsed.implementationCoverage).toBe("implemented");
  });

  it("parses Lillie's Determination with prize conditional draw", () => {
    const def = mockTrainer("Lillie's Determination", [
      "Shuffle your hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8 cards instead.",
      "You may play only 1 Supporter card during your turn.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({
      kind: "trainer_shuffle_hand_draw",
      baseDraw: 6,
      sixPrizeDraw: 8,
    });
  });

  it("parses Professor's Research", () => {
    const def = mockTrainer("Professor's Research", [
      "Discard your hand and draw 7 cards.",
      "You may play only 1 Supporter card during your turn.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_discard_hand_draw", drawCount: 7 });
  });

  it("parses Ultra Ball with discard cost", () => {
    const def = mockTrainer("Ultra Ball", [
      "Discard 2 cards from your hand. Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    ], ["Item"]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_ultra_ball" });
  });

  it("filters Supporter boilerplate from rules", () => {
    const def = mockTrainer("Boss's Orders", [
      "Switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",
      "You may play only 1 Supporter card during your turn.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.text).not.toContain("You may play only 1 Supporter");
    expect(parsed.effects[0]).toEqual({ kind: "trainer_boss_orders" });
  });

  it("parses Iono prize-based draw", () => {
    const def = mockTrainer("Iono", [
      "Each player puts a card from their hand on the bottom of their deck. Then each player shuffles their deck and draws a card. If you have more Prize cards remaining than your opponent, you draw 3 cards instead of 1 card.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_iono" });
  });

  it("parses Dawn evolution line search", () => {
    const def = mockTrainer("Dawn", [
      "Search your deck for a Basic Pokémon, a Stage 1 Pokémon, and a Stage 2 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_dawn" });
  });

  it("parses Team Rocket's Ariana draw effect", () => {
    const def = mockTrainer("Team Rocket's Ariana", [
      "Draw cards until you have 5 cards in your hand. If all of your Pokémon in play are Team Rocket's Pokémon, draw cards until you have 8 cards in your hand instead.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_ariana" });
  });

  it("parses Battle Cage stadium", () => {
    const def = mockTrainer(
      "Battle Cage",
      [
        "Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of attacks and Abilities from the opponent's Pokémon.",
      ],
      ["Stadium"],
    );
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "stadium_battle_cage" });
  });

  it("parses Team Rocket's Petrel trainer search", () => {
    const def = mockTrainer("Team Rocket's Petrel", [
      "Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck.",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_petrel" });
  });

  it("parses Premium Power Pro fighting bonus", () => {
    const def = mockTrainer(
      "Premium Power Pro",
      [
        "During this turn, attacks used by your Fighting Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      ],
      ["Item"],
    );
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_premium_power_pro", amount: 30 });
  });

  it("parses Black Belt's Training", () => {
    const def = mockTrainer("Black Belt's Training", [
      "During this turn, attacks used by your Pokémon do 40 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).",
    ]);
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "trainer_black_belt_training", amount: 40 });
  });

  it("parses Gravity Mountain stadium", () => {
    const def = mockTrainer(
      "Gravity Mountain",
      ["Each Stage 2 Pokémon in play (both yours and your opponent's) gets -30 HP."],
      ["Stadium"],
    );
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "stadium_gravity_mountain" });
  });

  it("parses Lumiose City stadium", () => {
    const def = mockTrainer(
      "Lumiose City",
      [
        "Once during each player's turn, that player may search their deck for a Basic Pokémon and put it onto their Bench. Then, that player shuffles their deck. If a player searches their deck in this way, their turn ends.",
      ],
      ["Stadium"],
    );
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "stadium_lumiose_city" });
  });

  it("parses Grand Tree stadium", () => {
    const def = mockTrainer(
      "Grand Tree",
      [
        "Once during each player's turn, that player may search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon and put it onto that Basic Pokémon to evolve it. If they do, they may search their deck for a Stage 2 Pokémon that evolves from that Stage 1 Pokémon and put it onto that Stage 1 Pokémon to evolve it. Then, that player shuffles their deck.",
      ],
      ["Stadium"],
    );
    const parsed = parseTrainerText(def);
    expect(parsed.effects[0]).toEqual({ kind: "stadium_grand_tree" });
  });

  it("parses batch-5 meta trainers", () => {
    expect(
      parseTrainerText(
        mockTrainer("Roto-Stick", [
          "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
        ], ["Item"]),
      ).effects[0],
    ).toEqual({ kind: "trainer_roto_stick" });

    expect(
      parseTrainerText(
        mockTrainer("Miracle Headset", ["Put up to 2 Supporter cards from your discard pile into your hand."], ["Item"]),
      ).effects[0],
    ).toEqual({ kind: "trainer_miracle_headset", count: 2 });

    expect(
      parseTrainerText(
        mockTrainer("Bug Catching Set", [
          "Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of [G] Pokémon and Basic [G] Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
        ], ["Item"]),
      ).effects[0],
    ).toEqual({ kind: "trainer_bug_catching_set", count: 2 });

    expect(
      parseTrainerText(
        mockTrainer("N's Castle", ["N's Pokémon in play (both yours and your opponent's) have no Retreat Cost."], ["Stadium"]),
      ).effects[0],
    ).toEqual({ kind: "stadium_ns_castle" });
  });
});
