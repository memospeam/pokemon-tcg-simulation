import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => ParsedEffect | ParsedEffect[] };

const BULK5_RULES: Rule[] = [
  {
    pattern: /^this attack does (\d+) damage for each future card you find there\.?$/i,
    build: (m) => ({ kind: "damage_per_trainer_in_revealed", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^then, discard those future cards and shuffle the other cards back into your deck\.?$/i,
    build: () => [],
  },
  {
    pattern: /^this attack does (\d+) damage for each of your (.+?) and (.+?) in play\.?$/i,
    build: (m) => ({
      kind: "damage_per_named_in_play",
      perPokemon: parseInt(m[1]!, 10),
      nameFilter: m[2]!.trim(),
    }),
  },
  {
    pattern: /^this attack also does (\d+) damage to each of your (.+?) and (.+?)\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10),
      target: "your_pokemon",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern:
      /^if your opponent has (\d+) or fewer prize cards remaining, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_opponent_prize_at_most",
      maxPrizes: parseInt(m[1]!, 10),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern: /^choose (\d+) of your opponent's benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "choose_opponent_bench", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if you do, shuffle all of your opponent's benched pok[ée]mon that you didn't choose, and all cards attached to those pok[ée]mon, into their deck\.?$/i,
    build: () => ({ kind: "shuffle_unchosen_opponent_bench" }),
  },
  {
    pattern: /^if you have any (\w+) pok[ée]mon on your bench, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_bench_type",
      typeFilter: cap(m[1]!),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern: /^if your opponent's active pok[ée]mon isn't (\w+), this attack does nothing\.?$/i,
    build: (m) => ({ kind: "attack_fails_unless_opponent_status", status: cap(m[1]!) }),
  },
  {
    pattern: /^discard up to (\d+) energy cards from your hand\.?$/i,
    build: (m) => ({ kind: "discard_hand_energy_optional", max: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage to 1 of your opponent's pok[ée]mon for each energy card you discarded in this way\.?$/i,
    build: (m) => ({ kind: "damage_per_discarded_basic_energy", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon is a (\w+) pok[ée]mon, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_opponent_type",
      typeFilter: cap(m[1]!),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern: /^look at the top (\d+) cards of your deck\.?$/i,
    build: (m) => ({ kind: "reveal_deck_top", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^attach a basic (\w+) energy card from your discard pile to each of your benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "attach_energy_each_bench", energyType: cap(m[1]!) }),
  },
  {
    pattern:
      /^if you played an ancient supporter card from your hand during this turn, discard (\d+) more cards in this way\.?$/i,
    build: () => [],
  },
  {
    pattern: /^this attack does (\d+) more damage for each ancient card in your discard pile\.?$/i,
    build: (m) => ({
      kind: "damage_per_named_in_discard",
      nameFilter: "Ancient",
      perCard: parseInt(m[1]!, 10),
    }),
  },
  {
    pattern: /^this attack does (\d+) damage to the new active pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10),
      target: "opponent_active",
      applyWeaknessRes: true,
    }),
  },
  {
    pattern: /^put up to (\d+) basic pok[ée]mon you find there onto your opponent's bench\.?$/i,
    build: (m) => ({ kind: "put_basic_opponent_bench", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^you may put (\d+) energy attached to your opponent's active pok[ée]mon into their hand\.?$/i,
    build: (m) => ({ kind: "return_opponent_active_energy_to_hand", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^discard up to (\d+) pok[ée]mon tools from your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "discard_opponent_tools", max: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) damage for each special energy card attached to this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_special_energy_on_self", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if all of your benched pok[ée]mon have at least 1 damage counter on them, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_all_bench_damaged", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^at the end of your opponent's next turn, the defending pok[ée]mon will be knocked out\.?$/i,
    build: () => ({ kind: "delayed_ko_defender" }),
  },
  {
    pattern:
      /^this attack does (\d+) damage for each (\w+) energy attached to all of your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage_per_opponent_typed_energy",
      energyType: cap(m[2]!),
      perEnergy: parseInt(m[1]!, 10),
    }),
  },
  {
    pattern: /^put up to (\d+) pok[ée]mon from your discard pile into your hand\.?$/i,
    build: (m) => ({ kind: "recover_pokemon_from_discard", count: parseInt(m[1]!, 10), nameFilter: "Pokémon" }),
  },
  {
    pattern: /^discard the top card of each player's deck\.?$/i,
    build: () => ({ kind: "mill_both_decks", count: 1 }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each energy card discarded in this way\.?$/i,
    build: (m) => ({ kind: "damage_per_discarded_basic_energy", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^discard a card you find there\.?$/i,
    build: () => [],
  },
  {
    pattern:
      /^during your next turn, attacks used by this pok[ée]mon do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "self_attack_bonus_next_turn", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^shuffle 1 of your benched pok[ée]mon and all attached cards into your deck\.?$/i,
    build: () => ({ kind: "shuffle_self_bench_to_deck" }),
  },
  {
    pattern:
      /^if any of your pok[ée]mon in play are the same type as any of your opponent's pok[ée]mon in play, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_shared_type", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^your opponent can't play any supporter cards from their hand during their next turn\.?$/i,
    build: () => ({ kind: "block_opponent_supporters_next_turn" }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon has a pok[ée]mon tool attached, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_opponent_has_tool", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if you have more prize cards remaining than your opponent, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_more_prizes", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if any of your pok[ée]mon were knocked out by damage from an attack during your opponent's last turn, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_ko_last_turn", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^attach a basic energy card from your hand to 1 of your pok[ée]mon\.?$/i,
    build: () => ({
      kind: "attach_basic_energy_from_hand",
      energyType: "Any",
      target: "your_pokemon",
    }),
  },
  {
    pattern: /^discard this pok[ée]mon and all attached cards\.?$/i,
    build: () => ({ kind: "discard_self_and_attached" }),
  },
  {
    pattern: /^you may turn 1 of your face-down prize cards face up\.?$/i,
    build: () => ({ kind: "reveal_prize_card" }),
  },
  {
    pattern: /^if you do, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "optional_damage_bonus", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^\(that prize card remains face up for the rest of the game\.\)?$/i,
    build: () => [],
  },
  {
    pattern: /^attach a basic energy card from your discard pile to 1 of your benched pok[ée]mon\.?$/i,
    build: () => ({
      kind: "attach_energy_from_discard",
      count: 1,
      energyType: "Any",
      target: "benched",
    }),
  },
  {
    pattern: /^search your deck for a basic energy card and attach it to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "search_attach_energy_to_self", count: 1, energyType: "Any" }),
  },
  {
    pattern:
      /^this attack does (\d+) damage for each special condition affecting your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_opponent_status_count", perStatus: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^search your deck for up to (\d+) basic (\w+) energy cards and up to (\d+) basic (\w+) energy cards and attach them to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "search_attach_dual_energy",
      countA: parseInt(m[1]!, 10),
      typeA: cap(m[2]!),
      countB: parseInt(m[3]!, 10),
      typeB: cap(m[4]!),
    }),
  },
  {
    pattern:
      /^if you don't have the same number of cards in your hand as your opponent, this attack does nothing\.?$/i,
    build: () => ({ kind: "attack_fails_if_hand_count_mismatch" }),
  },
  {
    pattern:
      /^put damage counters on your opponent's active pok[ée]mon until its remaining hp is (\d+)\.?$/i,
    build: (m) => ({ kind: "damage_until_hp_remaining", hp: parseInt(m[1]!, 10), target: "opponent_active" }),
  },
  {
    pattern: /^search your deck for a pok[ée]mon tool card, reveal it, and put it into your hand\.?$/i,
    build: () => ({ kind: "search_tool_to_hand" }),
  },
  {
    pattern: /^move all energy from this pok[ée]mon to 1 of your benched pok[ée]mon\.?$/i,
    build: () => ({ kind: "move_energy_to_bench", count: 999 }),
  },
  {
    pattern:
      /^attach up to (\d+) basic energy cards from your discard pile to 1 of your benched pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "attach_energy_from_discard",
      count: parseInt(m[1]!, 10),
      energyType: "Any",
      target: "benched",
    }),
  },
  {
    pattern: /^discard all special energy from all of your opponent's pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_special_energy_opponent_all" }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each energy card in your discard pile\.?$/i,
    build: (m) => ({
      kind: "damage_per_energy_in_self_discard",
      perEnergy: parseInt(m[1]!, 10),
      bonusOnly: true,
    }),
  },
  {
    pattern: /^if your opponent's active pok[ée]mon is a (\w+) pok[ée]mon, it is now (\w+)\.?$/i,
    build: (m) => [
      { kind: "damage_bonus_if_opponent_type", typeFilter: cap(m[1]!), amount: 0 },
      { kind: "status", status: cap(m[2]!), target: "opponent_active" },
    ],
  },
  {
    pattern:
      /^if heads, your opponent's active pok[ée]mon is now (\w+), and discard an energy from that pok[ée]mon\.?$/i,
    build: (m) => [
      { kind: "status", status: cap(m[1]!), target: "opponent_active" },
      { kind: "discard_energy", count: 1, from: "opponent_active" },
    ],
  },
  {
    pattern:
      /^attach up to (\d+) basic (\w+) energy cards from your hand to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "attach_hand_energy_typed",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
    }),
  },
  {
    pattern: /^if you don't have (.+?) and (.+?) on your bench, this attack does nothing\.?$/i,
    build: (m) => ({
      kind: "attack_fails_unless_bench_names",
      names: [m[1]!.trim(), m[2]!.trim()],
    }),
  },
  {
    pattern:
      /^this attack does (\d+) more damage for each damage counter on all of your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_all_opponent_counters", perCounter: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^put damage counters on each of your opponent's benched pok[ée]mon until its remaining hp is (\d+)\.?$/i,
    build: (m) => ({ kind: "damage_until_hp_remaining", hp: parseInt(m[1]!, 10), target: "opponent_bench_each" }),
  },
  {
    pattern:
      /^during your next turn, the defending pok[ée]mon takes (\d+) more damage from attacks \(after applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "defending_damage_increase_next_turn", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage to each of your opponent's pok[ée]mon ex and pok[ée]mon v\.?$/i,
    build: (m) => ({ kind: "damage_each_opponent_tag", amount: parseInt(m[1]!, 10), tag: "ex" }),
  },
];

export function matchBulk5Clause(clause: string): ParsedEffect[] | null {
  for (const rule of BULK5_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    if (Array.isArray(built) && built.length === 0) return [];
    return Array.isArray(built) ? built : [built];
  }
  return null;
}
