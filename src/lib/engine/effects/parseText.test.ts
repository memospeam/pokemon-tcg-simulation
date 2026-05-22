import { describe, expect, it } from "vitest";
import { parseAbilityText, parseAttackText } from "./parseText";

describe("parseAttackText", () => {
  it("parses Dragapult ex Phantom Dive bench distribute", () => {
    const effects = parseAttackText(
      "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.",
    );
    expect(effects).toEqual([{ kind: "distribute_bench_counters", counters: 6 }]);
  });

  it("parses bench spread damage", () => {
    const effects = parseAttackText(
      "This attack also does 20 damage to each of your opponent's Benched Pokémon.",
    );
    expect(effects[0]).toMatchObject({
      kind: "damage",
      amount: 20,
      target: "opponent_bench_each",
    });
  });

  it("parses status effect", () => {
    const effects = parseAttackText("Your opponent's Active Pokémon is now Confused.");
    expect(effects[0]).toMatchObject({ kind: "status", status: "Confused" });
  });

  it("parses Budew Itchy Pollen item lock", () => {
    const effects = parseAttackText(
      "During your opponent's next turn, they can't play any Item cards from their hand.",
    );
    expect(effects).toEqual([{ kind: "block_opponent_items_next_turn" }]);
  });

  it("parses draw a card", () => {
    expect(parseAttackText("Draw a card.")).toEqual([{ kind: "draw", count: 1, target: "self" }]);
  });

  it("parses cant attack next turn", () => {
    expect(parseAttackText("During your next turn, this Pokémon can't attack.")).toEqual([
      { kind: "cant_attack_next_owner_turn" },
    ]);
  });

  it("parses cant retreat defending", () => {
    expect(
      parseAttackText("During your opponent's next turn, the Defending Pokémon can't retreat."),
    ).toEqual([{ kind: "cant_retreat_defending_next_turn" }]);
  });

  it("parses self recoil", () => {
    expect(parseAttackText("This Pokémon also does 10 damage to itself.")).toEqual([
      { kind: "self_recoil", amount: 10 },
    ]);
  });

  it("parses discard energy from self", () => {
    expect(parseAttackText("Discard 2 Energy from this Pokémon.")).toEqual([
      { kind: "discard_energy", count: 2, from: "self_active" },
    ]);
    expect(parseAttackText("Discard an Energy from this Pokémon.")).toEqual([
      { kind: "discard_energy", count: 1, from: "self_active" },
    ]);
    expect(parseAttackText("Discard all Energy from this Pokémon.")).toEqual([
      { kind: "discard_all_energy", from: "self_active" },
    ]);
  });

  it("parses coin flip patterns", () => {
    expect(parseAttackText("Flip a coin. If tails, this attack does nothing.")).toEqual([
      { kind: "coin_attack_fails_on_tails" },
    ]);
    expect(parseAttackText("Flip a coin. If heads, this attack does 20 more damage.")).toEqual([
      { kind: "coin_damage_bonus", amount: 20 },
    ]);
    expect(parseAttackText("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.")).toEqual([
      {
        kind: "coin_flip",
        heads: [{ kind: "status", status: "Paralyzed", target: "opponent_active" }],
        tails: [],
      },
    ]);
  });

  it("parses damage reduction", () => {
    expect(
      parseAttackText(
        "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([{ kind: "damage_reduction_next_opponent_turn", amount: 30 }]);
  });

  it("parses search basic to bench", () => {
    expect(
      parseAttackText(
        "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      ),
    ).toEqual([{ kind: "search_basic_to_bench", count: 2 }]);
    expect(
      parseAttackText(
        "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      ),
    ).toEqual([{ kind: "search_basic_to_bench", count: 1 }]);
  });

  it("parses round 2 patterns", () => {
    expect(parseAttackText("Move an Energy from this Pokémon to 1 of your Benched Pokémon.")).toEqual([
      { kind: "move_energy_to_bench" },
    ]);
    expect(parseAttackText("You may draw cards until you have 6 cards in your hand.")).toEqual([
      { kind: "draw_until_hand", targetCount: 6, optional: true },
    ]);
    expect(parseAttackText("During your next turn, this Pokémon can't use attacks.")).toEqual([
      { kind: "cant_attack_next_owner_turn" },
    ]);
    expect(parseAttackText("Discard a random card from your opponent's hand.")).toEqual([
      { kind: "discard_random_opponent_hand", count: 1 },
    ]);
    expect(parseAttackText("Discard an Energy from your opponent's Active Pokémon.")).toEqual([
      { kind: "discard_energy", count: 1, from: "opponent_active" },
    ]);
    expect(parseAttackText("Discard the top card of your opponent's deck.")).toEqual([
      { kind: "mill_opponent_deck", count: 1 },
    ]);
    expect(parseAttackText("This attack does 20 damage for each damage counter on this Pokémon.")).toEqual([
      { kind: "damage_per_self_counter", perCounter: 20 },
    ]);
    expect(parseAttackText("Flip 2 coins. This attack does 10 damage for each heads.")).toEqual([
      { kind: "coin_multi_damage", perHeads: 10, coinCount: 2, bonusOnly: false },
    ]);
  });

  it("parses passive damage reduction ability text", () => {
    const parsed = parseAbilityText({
      name: "Solid Body",
      type: "Ability",
      text: "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
    });
    expect(parsed.effects).toEqual([{ kind: "damage_reduction_passive", amount: 30 }]);
  });

  it("parses round 3 patterns", () => {
    expect(
      parseAttackText("This attack does 30 more damage for each Energy attached to both Active Pokémon."),
    ).toEqual([{ kind: "damage_per_energy_both_actives", perEnergy: 30 }]);
    expect(
      parseAttackText(
        "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage.",
      ),
    ).toEqual([{ kind: "damage_bonus_if_special_condition", amount: 120 }]);
    expect(parseAttackText("Your opponent reveals their hand.")).toEqual([
      { kind: "reveal_opponent_hand" },
    ]);
    expect(parseAttackText("Flip 3 coins. This attack does 10 damage for each heads.")).toEqual([
      { kind: "coin_multi_damage", perHeads: 10, coinCount: 3, bonusOnly: false },
    ]);
    expect(
      parseAttackText(
        "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([{ kind: "search_basic_energy_to_hand", count: 2 }]);
    expect(
      parseAttackText(
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-Colorless Pokémon.",
      ),
    ).toEqual([{ kind: "prevent_damage_from_basic_non_colorless" }]);
  });

  it("parses survive KO and attach grass ability", () => {
    const survive = parseAbilityText({
      name: "Sturdy",
      type: "Ability",
      text: "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.",
    });
    expect(survive.effects).toEqual([{ kind: "survive_ko_full_hp" }]);

    const attach = parseAbilityText({
      name: "Leaf Charge",
      type: "Ability",
      text: "Once during your turn, you may attach a Basic Grass Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card.",
    });
    expect(attach.frequency).toBe("once_per_turn");
    expect(attach.effects).toEqual([
      {
        kind: "attach_basic_energy_from_hand",
        energyType: "Grass",
        target: "self",
        drawOnAttach: true,
      },
    ]);
  });

  it("parses round 4 patterns", () => {
    expect(parseAttackText("You may discard any amount of Basic Energy from your Pokémon.")).toEqual([
      { kind: "discard_basic_energy_optional" },
    ]);
    expect(parseAttackText("This attack does 60 more damage for each card you discarded in this way.")).toEqual([
      { kind: "damage_per_discarded_basic_energy", perCard: 60 },
    ]);
    expect(parseAttackText("Choose a random card from your opponent's hand.")).toEqual([
      { kind: "shuffle_random_opponent_hand_to_deck" },
    ]);
    expect(
      parseAttackText(
        "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it.",
      ),
    ).toEqual([{ kind: "search_evolution_from_deck" }]);
    expect(
      parseAttackText(
        "Search your deck for a Supporter card, reveal it, and put it into your hand.",
      ),
    ).toEqual([{ kind: "search_supporter_to_hand" }]);
    expect(
      parseAttackText(
        "If Festival Grounds is in play, this Pokémon may use an attack it has twice.",
      ),
    ).toEqual([{ kind: "festival_grounds_double_attack" }]);
    expect(
      parseAttackText(
        "This attack does 10 damage for each Pokémon Tool attached to all of your Pokémon.",
      ),
    ).toEqual([{ kind: "damage_per_tools_on_your_pokemon", perTool: 10 }]);
  });

  it("parses unlimited attach Lightning ability", () => {
    const parsed = parseAbilityText({
      name: "Sparkling Charge",
      type: "Ability",
      text: "As often as you like during your turn, you may attach a Basic Lightning Energy card from your hand to 1 of your Iono's Pokémon.",
    });
    expect(parsed.frequency).toBe("unlimited");
    expect(parsed.effects).toEqual([
      {
        kind: "attach_basic_energy_from_hand",
        energyType: "Lightning",
        target: "your_pokemon",
        nameFilter: "iono's",
      },
    ]);
  });

  it("parses round 5 patterns", () => {
    expect(
      parseAttackText(
        "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.",
      ),
    ).toEqual([{ kind: "copy_benched_attack", nameFilter: "n's" }]);

    const bloodMoon = parseAbilityText({
      name: "Seasoned Skill",
      type: "Ability",
      text: "Blood Moon used by this Pokémon costs Colorless less for each Prize card your opponent has taken.",
    });
    expect(bloodMoon.frequency).toBe("passive");
    expect(bloodMoon.effects).toEqual([
      {
        kind: "attack_cost_reduction_per_opponent_prize",
        attackName: "Blood Moon",
        energyType: "Colorless",
        perPrize: 1,
      },
    ]);

    const fairyZone = parseAbilityText({
      name: "Fairy Zone",
      type: "Ability",
      text: "The Weakness of each of your opponent's Dragon Pokémon in play is now Psychic. (Apply Weakness as ×2.)",
    });
    expect(fairyZone.frequency).toBe("passive");
    expect(fairyZone.effects).toEqual([
      { kind: "override_opponent_dragon_weakness", weaknessType: "Psychic" },
    ]);

    const cobalt = parseAbilityText({
      name: "Cobalt Command",
      type: "Ability",
      text: "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    });
    expect(cobalt.effects).toEqual([
      {
        kind: "future_pokemon_active_damage_bonus",
        amount: 20,
        excludeName: "iron crown ex",
      },
    ]);

    const trade = parseAbilityText({
      name: "Trade",
      type: "Ability",
      text: "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.",
    });
    expect(trade.conditions).toEqual([{ type: "discard_from_hand_to_use" }]);
    expect(trade.effects).toEqual([{ kind: "draw", count: 2, target: "self" }]);
  });
});

describe("parseAbilityText", () => {
  it("parses Munkidori Adrena-Brain", () => {
    const parsed = parseAbilityText({
      name: "Adrena-Brain",
      type: "Ability",
      text: "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
    });
    expect(parsed.frequency).toBe("once_per_turn");
    expect(parsed.conditions[0]).toMatchObject({ type: "has_energy_type", energyType: "Darkness" });
    expect(parsed.effects[0]).toMatchObject({
      kind: "move_damage",
      maxCounters: 3,
      to: "opponent_pokemon",
    });
  });

  it("parses Drakloak Recon Directive", () => {
    const parsed = parseAbilityText({
      name: "Recon Directive",
      type: "Ability",
      text: "Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck.",
    });
    expect(parsed.frequency).toBe("once_per_turn");
    expect(parsed.effects).toEqual([{ kind: "recon_directive" }]);
  });

  it("parses Ampharos hand-equal passive without stub", () => {
    const parsed = parseAbilityText({
      name: "Static",
      type: "Ability",
      text: "If you have the same number of cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    });
    expect(parsed.effects).toEqual([{ kind: "self_hand_equal_damage_bonus", amount: 80 }]);
  });
});

describe("parseAttackText bulk7 top stubs", () => {
  it("parses benched damage bonus without stub", () => {
    const effects = parseAttackText(
      "If your Benched Pokémon have any damage counters on them, this attack does 120 more damage.",
    );
    expect(effects).toEqual([{ kind: "damage_bonus_if_any_bench_damaged", amount: 120 }]);
  });

  it("parses flip 3 tails discard energy as typed effect", () => {
    const effects = parseAttackText("Flip 3 coins. For each tails, discard an Energy from this Pokémon.");
    expect(effects).toEqual([{ kind: "coin_multi_discard_self_energy", perTails: 1, coinCount: 3 }]);
  });

  it("parses Arboliva repeat damage without stub clause", () => {
    const effects = parseAttackText(
      "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance.",
    );
    expect(effects.some((effect) => effect.kind === "generic_effect_stub")).toBe(false);
    expect(effects).toContainEqual({ kind: "damage_choose_opponent_repeat", times: 6, amount: 20 });
  });
});
