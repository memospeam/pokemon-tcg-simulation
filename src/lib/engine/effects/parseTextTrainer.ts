import type { ParsedEffect } from "./types";

function normalize(text: string): string {
  return text
    .replace(/\u2019/g, "'")
    .replace(/\{[^}]+\}/g, (token) => {
      const map: Record<string, string> = {
        "{C}": "colorless",
        "{F}": "fighting",
        "{G}": "grass",
        "{D}": "darkness",
        "{R}": "fire",
        "{W}": "water",
        "{L}": "lightning",
        "{P}": "psychic",
      };
      return map[token] ?? token.replace(/[{}]/g, "").toLowerCase();
    })
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type TrainerPattern = {
  test: RegExp;
  build: (match: RegExpMatchArray) => ParsedEffect;
};

const FULL_TEXT_PATTERNS: TrainerPattern[] = [
  {
    test: /shuffle your hand into your deck\. then, draw 6 cards\. if you have exactly 6 prize cards remaining, draw 8 cards instead/,
    build: () => ({ kind: "trainer_shuffle_hand_draw", baseDraw: 6, sixPrizeDraw: 8 }),
  },
  {
    test: /discard your hand and draw 7 cards/,
    build: () => ({ kind: "trainer_discard_hand_draw", drawCount: 7 }),
  },
  {
    test: /each player shuffles their hand into their deck and draws 4 cards/,
    build: () => ({ kind: "trainer_judge" }),
  },
  {
    test: /each player puts a card from their hand on the bottom of their deck\. then each player shuffles their deck and draws a card\. if you have more prize cards remaining than your opponent, you draw 3 cards instead of 1 card/,
    build: () => ({ kind: "trainer_iono" }),
  },
  {
    test: /switch 1 of your opponent's benched pok[ée]mon with their active pok[ée]mon/,
    build: () => ({ kind: "trainer_boss_orders" }),
  },
  {
    test: /(?:you can use this card only if you )?discard 2 (?:other )?cards from your hand\.\s*search your deck for a pok[ée]mon, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_ultra_ball" }),
  },
  {
    test: /search your deck for a pok[ée]mon that doesn't have a rule box, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_search_no_rule_box" }),
  },
  {
    test: /search your deck for up to 2 basic pok[ée]mon with 70 hp or less and put them onto your bench\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_poffin", maxHp: 70, count: 2 }),
  },
  {
    test: /put a pok[ée]mon or a basic energy card from your discard pile into your hand/,
    build: () => ({ kind: "trainer_night_stretcher", count: 1 }),
  },
  {
    test: /put up to 3 pok[ée]mon from your discard pile into your hand/,
    build: () => ({ kind: "trainer_night_stretcher", count: 3 }),
  },
  {
    test: /flip a coin\. if heads, discard an energy from 1 of your opponent's pok[ée]mon/,
    build: () => ({ kind: "trainer_crushing_hammer" }),
  },
  {
    test: /discard 2 energy from 1 of your opponent's pok[ée]mon/,
    build: () => ({ kind: "trainer_enhanced_hammer" }),
  },
  {
    test: /choose 1 of your basic pok[ée]mon in play.*stage 2.*evolves from that pok[ée]mon/,
    build: () => ({ kind: "trainer_rare_candy" }),
  },
  {
    // Unfair Stamp (TWM 165): play only if own Pokémon KO'd last turn; both shuffle, player +5, opponent +2
    test: /you can use this card only if any of your pok[ée]mon were knocked out during your opponent's last turn\.\s*each player shuffles their hand into their deck\. then, you draw 5 cards, and your opponent draws 2 cards/,
    build: () => ({ kind: "trainer_unfair_stamp" }),
  },
  {
    test: /you can use this card only if your opponent has 3 or fewer prize cards remaining\.\s*your opponent shuffles their hand and puts it on the bottom of their deck\. if they put any cards on the bottom of their deck in this way, they draw 3 cards/,
    build: () => ({ kind: "trainer_special_red_card" }),
  },
  {
    test: /search your deck for up to 2 basic energy cards of different types.*put 1 of them into your hand.*attach the other to 1 of your pok[ée]mon/,
    build: () => ({ kind: "trainer_crispin_sv" }),
  },
  {
    test: /search your deck for a basic energy card and attach it to 1 of your basic pok[ée]mon\. then, shuffle your deck.*you may discard a card.*draw 2 cards/,
    build: () => ({ kind: "trainer_crispin" }),
  },
  {
    test: /search your deck for an evolution pok[ée]mon and an energy card, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_hilda" }),
  },
  {
    test: /look at the top 7 cards of your deck\. you may reveal a supporter card you find there and put it into your hand\. shuffle the other cards back into your deck/,
    build: () => ({ kind: "trainer_pokegear" }),
  },
  {
    test: /search your deck for a supporter card, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_search_supporter" }),
  },
  {
    // Wally's Compassion (MEG 132): heal ALL damage; if healed, put energy into hand; Pokémon stays in play
    test: /heal all damage from 1 of your mega evolution pok[ée]mon ex\. if you healed any damage in this way, put all energy attached to that pok[ée]mon into your hand/,
    build: () => ({ kind: "trainer_wallys_compassion" }),
  },
  {
    test: /switch in 1 of your opponent's benched pok[ée]mon to the active spot\. if you do, switch your active pok[ée]mon with 1 of your benched pok[ée]mon/,
    build: () => ({ kind: "trainer_prime_catcher" }),
  },
  {
    test: /search your deck for a mega evolution pok[ée]mon ex, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_mega_signal" }),
  },
  {
    test: /your opponent reveals their hand, and you discard up to 2 item cards you find there/,
    build: () => ({ kind: "trainer_eri" }),
  },
  {
    test: /discard your hand and draw 5 cards/,
    build: () => ({ kind: "trainer_carmine" }),
  },
  {
    test: /choose up to 2 of your darkness pok[ée]mon\. for each of those pok[ée]mon, search your deck for a basic darkness energy card and attach it to that pok[ée]mon\. then, shuffle your deck\. if you attached energy to your active pok[ée]mon in this way, it is now poisoned/,
    build: () => ({ kind: "trainer_janine_secret_art" }),
  },
  {
    test: /choose up to 2 of your benched colorless pok[ée]mon and attach a basic energy card from your discard pile to each of them/,
    build: () => ({ kind: "trainer_glass_trumpet" }),
  },
  {
    test: /heal all damage from 1 of your pok[ée]mon that has 30 hp or less remaining/,
    build: () => ({ kind: "trainer_bianca_devotion" }),
  },
  {
    test: /look at the top 6 cards of your deck and put 2 of them into your hand\. discard the other cards/,
    build: () => ({ kind: "trainer_explorers_guidance" }),
  },
  {
    test: /draw a card for each of your opponent's benched pok[ée]mon/,
    build: () => ({ kind: "trainer_mortys_conviction" }),
  },
  {
    test: /search your deck for a card that has no abilities and evolves from 1 of your pok[ée]mon, and put it onto that pok[ée]mon to evolve it\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_salvatore" }),
  },
  {
    test: /reveal up to 2 pok[ée]mon in your hand and put them into your deck\. if you do, search your deck for up to that many pok[ée]mon, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_perrin" }),
  },
  {
    test: /search your deck for a pok[ée]mon, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_master_ball" }),
  },
  {
    test: /search your deck for up to 5 pok[ée]mon tool cards, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_treasure_tracker", count: 5 }),
  },
  {
    test: /switch your active pok[ée]mon with 1 of your benched pok[ée]mon/,
    build: () => ({ kind: "trainer_switch_active_bench" }),
  },
  {
    test: /move a basic energy from 1 of your pok[ée]mon to another of your pok[ée]mon/,
    build: () => ({ kind: "trainer_energy_switch" }),
  },
  {
    test: /search your deck for a basic pok[ée]mon, a stage 1 pok[ée]mon, and a stage 2 pok[ée]mon, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_dawn" }),
  },
  {
    test: /draw cards until you have 5 cards in your hand\. if all of your pok[ée]mon in play are team rocket's pok[ée]mon, draw cards until you have 8 cards in your hand instead/,
    build: () => ({ kind: "trainer_ariana" }),
  },
  {
    test: /you can use this card only if any of your team rocket's pok[ée]mon were knocked out during your opponent's last turn\.\s*each player shuffles their hand into their deck\. then, you draw 5 cards, and your opponent draws 3 cards/,
    build: () => ({ kind: "trainer_archer" }),
  },
  {
    test: /switch your active team rocket's pok[ée]mon with 1 of your benched team rocket's pok[ée]mon\. if you do, switch in 1 of your opponent's benched pok[ée]mon to the active spot/,
    build: () => ({ kind: "trainer_giovanni" }),
  },
  {
    test: /if you go first, you may use this card during your first turn\.\s*search your deck for up to 3 basic team rocket's pok[ée]mon, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_proton", count: 3 }),
  },
  {
    test: /search your deck for a trainer card, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_petrel" }),
  },
  {
    test: /search your deck for up to 3 pok[ée]mon ex, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_cyrano", count: 3 }),
  },
  {
    test: /search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order/,
    build: () => ({ kind: "trainer_ciphermaniac", count: 2 }),
  },
  {
    test: /search your deck for a basic \[?f\]? energy card or a basic \[?f\]? pok[ée]mon, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_fighting_gong" }),
  },
  {
    test: /search your deck for a stadium card and an energy card, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_colress_tenacity" }),
  },
  {
    test: /attach a basic energy card from your discard pile to 1 of your benched n's pok[ée]mon/,
    build: () => ({ kind: "trainer_ns_pp_up" }),
  },
  {
    test: /choose up to 2 pok[ée]mon tool cards attached to pok[ée]mon in play \(yours or your opponent's\) and discard them/,
    build: () => ({ kind: "trainer_tool_scrapper", count: 2 }),
  },
  {
    test: /during this turn, attacks used by your fighting pok[ée]mon do 30 more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)/,
    build: () => ({ kind: "trainer_premium_power_pro", amount: 30 }),
  },
  {
    test: /during this turn, attacks used by your pok[ée]mon do 40 more damage to your opponent's active pok[ée]mon ex \(before applying weakness and resistance\)/,
    build: () => ({ kind: "trainer_black_belt_training", amount: 40 }),
  },
  {
    test: /discard a pok[ée]mon tool and a special energy from 1 of your opponent's pok[ée]mon/,
    build: () => ({ kind: "trainer_ruffian" }),
  },
  {
    test: /choose a basic pok[ée]mon in your discard pile and switch it with 1 of your basic pok[ée]mon in play/,
    build: () => ({ kind: "trainer_transformation_tome" }),
  },
  {
    // Energy Retrieval: up to 2 Basic Energy from discard to hand.
    test: /put up to 2 basic energy cards from your discard pile into your hand/,
    build: () => ({ kind: "trainer_recover_typed_to_hand", energyType: "", count: 2 }),
  },
  {
    // Tarragon: up to 4 Fighting Pokémon / Basic Fighting Energy from discard to hand.
    test: /put up to 4 in any combination of fighting pok[ée]mon and basic fighting energy cards from your discard pile into your hand/,
    build: () => ({ kind: "trainer_recover_typed_to_hand", energyType: "Fighting", count: 4 }),
  },
  {
    // Great Haul Net: shuffle up to 3 Water Pokémon and/or Basic Water Energy from discard to deck.
    test: /shuffle up to 3 water pok[ée]mon from your discard pile into your deck.*shuffle up to 3 basic water energy/s,
    build: () => ({ kind: "trainer_shuffle_typed_to_deck", energyType: "Water", count: 3 }),
  },
  {
    // Xerosic's Machinations: opponent discards down to 3.
    test: /your opponent discards cards from their hand until they have 3 cards in their hand/,
    build: () => ({ kind: "discard_hand_until_count", targetCount: 3 }),
  },
  {
    // Hand Trimmer: each player discards down to 5 (opponent first).
    test: /each player discards cards from their hand until they have 5 cards in their hand/,
    build: () => ({ kind: "trainer_both_discard_hand_until", targetCount: 5 }),
  },
  {
    // Emma: opponent reveals hand, draw a card per Pokémon found.
    test: /your opponent reveals their hand, and you draw a card for each pok[ée]mon you find there/,
    build: () => ({ kind: "trainer_draw_per_opp_pokemon" }),
  },
  {
    // Larry's Skill: discard hand, search a Pokémon + Supporter + Basic Energy.
    test: /discard your hand and search your deck for a pok[ée]mon, a supporter card, and a basic energy card/,
    build: () => ({ kind: "trainer_discard_hand_search_three" }),
  },
  {
    // Strange Timepiece: devolve one of your evolved Psychic Pokémon.
    test: /devolve 1 of your evolved psychic pok[ée]mon by putting any number of evolution cards on it into your hand/,
    build: () => ({ kind: "trainer_devolve_own_typed", pokemonType: "Psychic" }),
  },
  {
    // Anthea & Concordia: +3 prizes on KO by your N's Pokémon (gated on six specific N's in play).
    test: /you can use this card only if you have n's darmanitan, n's zoroark ex, n's vanilluxe, n's klinklang, n's reshiram, and n's zekrom in play/,
    build: () => ({
      kind: "trainer_extra_prizes_if_team",
      names: ["n's darmanitan", "n's zoroark ex", "n's vanilluxe", "n's klinklang", "n's reshiram", "n's zekrom"],
      prizes: 3,
    }),
  },
  {
    // Tool Scrapper reprint variant (other printing already matched elsewhere).
    test: /choose up to 2 pok[ée]mon tools attached to pok[ée]mon \(yours or your opponent's\) and discard them/,
    build: () => ({ kind: "trainer_tool_scrapper", count: 2 }),
  },
  {
    test: /put up to 3 in any combination of pok[ée]mon that don't have a rule box and basic energy cards from your discard pile into your hand/,
    build: () => ({ kind: "trainer_lanas_aid", count: 3 }),
  },
  {
    test: /search your deck for up to 2 basic pok[ée]mon or 1 evolution pok[ée]mon, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_brocks_scouting" }),
  },
  {
    test: /you can use this card only if you have more prize cards remaining than your opponent\.\s*attach up to 2 basic energy cards from your discard pile to 1 of your stage 2 pok[ée]mon/,
    build: () => ({ kind: "trainer_rosas_encouragement", count: 2 }),
  },
  {
    test: /you can use this card only if your opponent has exactly 2 prize cards remaining\.\s*during this turn, if your opponent's active pok[ée]mon is knocked out by damage from an attack used by your tera pok[ée]mon, take 1 more prize card/,
    build: () => ({ kind: "trainer_briar" }),
  },
  {
    test: /switch your active pok[ée]mon with 1 of your benched pok[ée]mon\. if you do, draw cards until you have 5 cards in your hand/,
    build: () => ({ kind: "trainer_surfer" }),
  },
  {
    // Sacred Ash: "shuffle up to 5 Pokémon" — "up to" is optional in text
    test: /shuffle (?:up to )?5 pok[ée]mon from your discard pile into your deck/,
    build: () => ({ kind: "trainer_sacred_ash", count: 5 }),
  },
  {
    test: /search your deck for a supporter card that has "team rocket" in its name, reveal it, and put it into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_team_rocket_transceiver" }),
  },
  {
    test: /look at the top 4 cards of your deck\. you may reveal any number of supporter cards you find there and put them into your hand\. shuffle the other cards back into your deck/,
    build: () => ({ kind: "trainer_roto_stick" }),
  },
  {
    test: /put up to 2 supporter cards from your discard pile into your hand/,
    build: (_match: RegExpMatchArray) => ({ kind: "trainer_miracle_headset", count: 2 }),
  },
  {
    test: /you can use this card only if you discard 3 other cards from your hand\.\s*search your deck for an item card, a pok[ée]mon tool card, a supporter card, and a stadium card, reveal them, and put them into your hand\. then, shuffle your deck/,
    build: () => ({ kind: "trainer_secret_box" }),
  },
  {
    test: /look at the top 7 cards of your deck\. you may reveal up to 2 in any combination of \[?g\]? pok[ée]mon and basic \[?g\]? energy cards you find there and put them into your hand\. shuffle the other cards back into your deck/,
    build: (_match: RegExpMatchArray) => ({ kind: "trainer_bug_catching_set", count: 2 }),
  },
];

const STADIUM_PATTERNS: { test: RegExp; kind: ParsedEffect["kind"] }[] = [
  {
    test: /prevent all damage counters from being placed on benched pok[ée]mon \(both yours and your opponent's\) by effects of attacks and abilities from the opponent's pok[ée]mon/,
    kind: "stadium_battle_cage",
  },
  {
    test: /whenever any player puts a basic non-(?:\[?d\]?|darkness) pok[ée]mon onto their bench during their turn, place 2 damage counters on that pok[ée]mon/,
    kind: "stadium_risky_ruins",
  },
  {
    test: /\[?c\]? pok[ée]mon in play \(both yours and your opponent's\) have no abilities/,
    kind: "stadium_watchtower",
  },
  {
    test: /each player's \[?g\]? pok[ée]mon can evolve into \[?g\]? pok[ée]mon during the turn they play those pok[ée]mon, except during their first turn/,
    kind: "stadium_forest_vitality",
  },
  {
    test: /each player who has any tera pok[ée]mon in play can have up to 8 pok[ée]mon on their bench/,
    kind: "stadium_area_zero",
  },
  {
    test: /each stage 2 pok[ée]mon in play \(both yours and your opponent's\) gets -30 hp/,
    kind: "stadium_gravity_mountain",
  },
  {
    test: /once during each player's turn, that player may search their deck for a stage 1 pok[ée]mon that evolves from 1 of their basic pok[ée]mon and put it onto that (?:basic )?pok[ée]mon to evolve it/,
    kind: "stadium_grand_tree",
  },
  {
    test: /once during each player's turn, that player may search their deck for a basic pok[ée]mon and put it onto their bench\. then, that player shuffles their deck\. if a player searches their deck in this way, their turn ends/,
    kind: "stadium_lumiose_city",
  },
  {
    test: /once during each player's turn, if they played a supporter card from their hand this turn, they may heal 10 damage from each of their pok[ée]mon/,
    kind: "stadium_community_center",
  },
  {
    test: /once during each player's turn, if they played a supporter card that has "team rocket" in its name from their hand this turn, they may draw 2 cards/,
    kind: "stadium_team_rocket_factory",
  },
  {
    test: /n's pok[ée]mon in play \(both yours and your opponent's\) have no retreat cost/,
    kind: "stadium_ns_castle",
  },
  {
    test: /each pok[ée]mon that has any energy attached recovers from all special conditions and can't be affected by any special conditions/,
    kind: "stadium_festival_grounds",
  },
  {
    test: /prevent all damage done to pok[ée]mon that don't have a rule box \(both yours and your opponent's\) by attacks from the opponent's pok[ée]mon ex and pok[ée]mon v/,
    kind: "stadium_neutralization_zone",
  },
  {
    test: /once during each player's turn, that player may discard 2 cards from their hand in order to draw a card/,
    kind: "stadium_prism_tower",
  },
  {
    test: /once during each player's turn, that player may discard an energy card from their hand in order to draw cards until they have as many cards in their hand as they have psychic pok[ée]mon in play/,
    kind: "stadium_mystery_garden",
  },
  {
    test: /confused pok[ée]mon \(both yours and your opponent's\) don't recover from that special condition when they evolve or devolve/,
    kind: "stadium_dizzying_valley",
  },
  {
    test: /once during each player's turn, that player may put a card from their hand on top of their deck/,
    kind: "stadium_academy_at_night",
  },
  {
    test: /once during each player's turn, that player may put up to 2 basic lightning energy cards from their discard pile into their hand/,
    kind: "stadium_levincia",
  },
  {
    test: /once during each player's turn, that player may search their deck for a marnie's pok[ée]mon/,
    kind: "stadium_spikemuth_gym",
  },
  {
    test: /once during each player's turn, that player may switch their active water pok[ée]mon with 1 of their benched water pok[ée]mon/,
    kind: "stadium_surfing_beach",
  },
  {
    test: /each mega floette ex in play \(both yours and your opponent's\) gets \+150 hp/,
    kind: "stadium_ange_floette",
  },
  {
    test: /attacks used by each tera pok[ée]mon in play \(both yours and your opponent's\) cost colorless more/,
    kind: "stadium_nighttime_mine",
  },
  {
    test: /during pok[ée]mon checkup, put 2 more damage counters on each poisoned non-darkness pok[ée]mon \(both yours and your opponent's\)/,
    kind: "stadium_perilous_jungle",
  },
];

export function parseTrainerFullText(text: string): ParsedEffect[] | null {
  const normalized = normalize(text);
  for (const pattern of FULL_TEXT_PATTERNS) {
    const match = normalized.match(pattern.test);
    if (match) return [pattern.build(match)];
  }
  return null;
}

export function parseStadiumFullText(text: string): { kind: ParsedEffect["kind"] } | null {
  const normalized = normalize(text);
  for (const pattern of STADIUM_PATTERNS) {
    if (pattern.test.test(normalized)) return { kind: pattern.kind };
  }
  return null;
}

export function parseTrainerClause(clause: string): ParsedEffect[] | null {
  const normalized = normalize(clause);
  for (const pattern of FULL_TEXT_PATTERNS) {
    const match = normalized.match(pattern.test);
    if (match) return [pattern.build(match)];
  }
  return null;
}

export function isTrainerEffectKind(kind: ParsedEffect["kind"]): boolean {
  return kind.startsWith("trainer_") || kind.startsWith("stadium_");
}

export function isStadiumEffectKind(kind: ParsedEffect["kind"]): boolean {
  return kind.startsWith("stadium_");
}
