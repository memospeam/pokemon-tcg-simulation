import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => ParsedEffect | ParsedEffect[] };

const BULK6_RULES: Rule[] = [
  {
    pattern: /^this attack does (\d+) damage to each of your opponent's pok[ée]mon ex\.?$/i,
    build: (m) => ({ kind: "damage_each_opponent_tag", amount: parseInt(m[1]!, 10), tag: "ex" }),
  },
  {
    pattern:
      /^knock out 1 of your opponent's pok[ée]mon that has exactly (\d+) damage counters on it\.?$/i,
    build: (m) => ({ kind: "ko_if_exact_counters_on_opponent", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^devolve each of your opponent's evolved pok[ée]mon by shuffling the highest stage evolution card on it into your opponent's deck\.?$/i,
    build: () => ({ kind: "devolve_each_opponent" }),
  },
  {
    pattern: /^discard all energy from this pok[ée]mon, and take a prize card\.?$/i,
    build: () => [
      { kind: "discard_all_energy", from: "self_active" },
      { kind: "bonus_prize_on_coin_heads" },
    ],
  },
  {
    pattern: /^if you can't discard (\d+) cards in this way, this attack does nothing\.?$/i,
    build: () => ({ kind: "attack_fails_if_hand_count_mismatch" }),
  },
  {
    pattern: /^choose 1 of your opponent's pok[ée]mon (\d+) times\.?$/i,
    build: (m) => ({ kind: "damage_choose_opponent_repeat", times: parseInt(m[1]!, 10), amount: 20 }),
  },
  {
    pattern: /^this pok[ée]mon recovers from all special conditions\.?$/i,
    build: () => ({ kind: "clear_self_special_conditions" }),
  },
  {
    pattern: /^reveal the top (\d+) cards of your opponent's deck\.?$/i,
    build: (m) => ({ kind: "reveal_opponent_deck_top", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if you have (\d+) or more basic (\w+) energy cards in your discard pile, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_discard_energy_at_least",
      minCount: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
      amount: parseInt(m[3]!, 10),
    }),
  },
  {
    pattern: /^discard a (\w+) energy from your opponent's active pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_energy", count: 1, from: "opponent_active" }),
  },
  {
    pattern: /^if either of them is heads, your opponent's active pok[ée]mon is now (\w+)\.?$/i,
    build: (m) => ({ kind: "status", status: cap(m[1]!), target: "opponent_active" }),
  },
  {
    pattern: /^discard all (\w+) energy from this pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_all_energy", from: "self_active" }),
  },
  {
    pattern: /^put 1 of your benched pok[ée]mon and all attached cards into your hand\.?$/i,
    build: () => ({ kind: "return_bench_to_hand" }),
  },
  {
    pattern:
      /^move all damage counters from 1 of your benched pok[ée]mon to 1 of your opponent's pok[ée]mon\.?$/i,
    build: () => ({ kind: "move_counters_bench_to_opponent" }),
  },
  {
    pattern:
      /^this attack does (\d+) less damage for each colorless in your opponent's active pok[ée]mon's retreat cost\.?$/i,
    build: (m) => ({ kind: "damage_less_per_retreat_colorless", perCost: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage to 1 of your opponent's pok[ée]mon for each energy attached to this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_on_self", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if (\w+) is on your bench, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_bench_name",
      nameFilter: m[1]!.trim(),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern:
      /^during your next turn, this pok[ée]mon's (.+?) attack's base damage is (\d+)\.?$/i,
    build: (m) => ({ kind: "set_named_attack_base_next_turn", attackName: m[1]!.trim(), baseDamage: parseInt(m[2]!, 10) }),
  },
  {
    pattern: /^put a number of cards up to the number of heads from your discard pile into your hand\.?$/i,
    build: () => ({ kind: "recover_from_discard_per_heads" }),
  },
  {
    pattern:
      /^discard the top (\d+) cards of your deck, and this attack does (\d+) damage for each basic (\w+) energy card that you discarded in this way\.?$/i,
    build: (m) => [
      { kind: "mill_self_deck", count: parseInt(m[1]!, 10) },
      { kind: "damage_per_typed_energy_in_discard", counters: parseInt(m[2]!, 10) / 10, energyType: cap(m[3]!) },
    ],
  },
  {
    pattern:
      /^choose a pok[ée]mon in play \(yours or your opponent's\) that has the least hp remaining, except for this pok[ée]mon, and it is knocked out\.?$/i,
    build: () => ({ kind: "ko_lowest_hp_in_play" }),
  },
  {
    pattern: /^if you have exactly (\d+) prize cards remaining, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_exact_prizes",
      prizes: parseInt(m[1]!, 10),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern:
      /^your opponent reveals their hand, and this attack does (\d+) damage for each energy card you find there\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_in_opponent_hand", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^for each heads, search your deck for up to (\d+) basic energy cards and attach them to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "search_attach_energy_any", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if any of your (.+?) pok[ée]mon were knocked out by damage from an attack during your opponent's last turn, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_named_ko_last_turn", nameFilter: m[1]!.trim(), amount: parseInt(m[2]!, 10) }),
  },
  {
    pattern:
      /^choose basic (\w+) energy cards from your discard pile up to the amount of energy attached to all of your opponent's pok[ée]mon and attach them to your (\w+) pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "attach_discard_energy_match_opponent", energyType: cap(m[1]!), nameFilter: `${m[2]!.trim()}'s` }),
  },
  {
    pattern: /^knock out each of your opponent's pok[ée]mon that has (\d+) hp or less remaining\.?$/i,
    build: (m) => ({ kind: "ko_opponent_at_hp_or_less", maxHp: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^reveal any number of (.+?), (.+?), and (.+?) from your hand, and this attack does (\d+) damage for each card you revealed in this way\.?$/i,
    build: (m) => ({ kind: "damage_per_revealed_from_hand", perCard: parseInt(m[4]!, 10) }),
  },
  {
    pattern:
      /^choose 1 of your opponent's pok[ée]mon and flip a coin for each of your pok[ée]mon in play that has "(.+?)" in its name\.?$/i,
    build: () => ({ kind: "coin_multi_damage", perHeads: 50, coinCount: 1, bonusOnly: false }),
  },
  {
    pattern: /^this attack does (\d+) damage to the chosen pok[ée]mon for each heads\.?$/i,
    build: (m) => ({ kind: "coin_multi_damage", perHeads: parseInt(m[1]!, 10), coinCount: 1, bonusOnly: false }),
  },
  {
    pattern: /^if any of them are heads, your opponent reveals their hand\.?$/i,
    build: () => ({ kind: "reveal_opponent_hand" }),
  },
  {
    pattern: /^for each heads, choose a card you find there and shuffle it into your opponent's deck\.?$/i,
    build: () => ({ kind: "shuffle_revealed_to_deck" }),
  },
  {
    pattern:
      /^attacks used by your (.+?) pok[ée]mon do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "team_typed_damage_bonus", nameFilter: m[1]!.trim(), amount: parseInt(m[2]!, 10) }),
  },
  {
    pattern:
      /^if your active pok[ée]mon has the festival lead ability, you may search your deck for a card and put it into your hand\.?$/i,
    build: () => ({ kind: "search_any_to_hand" }),
  },
  {
    pattern:
      /^as long as you have at least 1 other (.+?) in play, all of your basic (\w+) pok[ée]mon take (\d+) less damage from attacks from your opponent's pok[ée]mon \(after applying weakness and resistance\)\.?$/i,
    build: (m) => ({
      kind: "damage_reduction_passive_typed",
      nameFilter: m[1]!.trim(),
      typeFilter: cap(m[2]!),
      amount: parseInt(m[3]!, 10),
    }),
  },
  {
    pattern: /^if you healed any damage in this way, discard all energy from that pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_energy_after_heal_evolution" }),
  },
  {
    pattern:
      /^attacks used by this pok[ée]mon cost (\w+) less for each of your opponent's benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "attack_cost_reduction_per_opponent_bench", energyType: cap(m[1]!) }),
  },
  {
    pattern: /^each of your evolved pok[ée]mon can use any attack from its previous evolutions\.?$/i,
    build: () => ({ kind: "evolved_can_use_previous_attacks" }),
  },
  {
    pattern:
      /^whenever your opponent attaches an energy card from their hand to 1 of their pok[ée]mon, put (\d+) damage counters on that pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "counter_on_opponent_energy_attach", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if you drew any cards in this way, shuffle this pok[ée]mon and all attached cards into your deck\.?$/i,
    build: () => ({ kind: "shuffle_self_to_deck_if_drew" }),
  },
  {
    pattern: /^move 1 damage counter from 1 of your (.+?) pok[ée]mon to another of your pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "move_counters_between_yours", nameFilter: m[1]!.trim() }),
  },
  {
    pattern:
      /^if you have (\w+) in play, this pok[ée]mon can evolve during your first turn or the turn you play it\.?$/i,
    build: (m) => ({ kind: "can_evolve_if_name_in_play", nameFilter: m[1]!.trim() }),
  },
  {
    pattern: /^you must discard a basic (\w+) energy card from your hand in order to use this ability\.?$/i,
    build: (m) => ({ kind: "require_hand_energy_in_active", energyType: cap(m[1]!) }),
  },
  {
    pattern: /^this pok[ée]mon gets \+(\d+) hp for each (\w+) energy attached to it\.?$/i,
    build: (m) => ({ kind: "hp_bonus_per_typed_energy", perEnergy: parseInt(m[1]!, 10), energyType: cap(m[2]!) }),
  },
  {
    pattern:
      /^your opponent reveals their hand, and you put a basic pok[ée]mon with (\d+) hp or less that you find there onto your opponent's bench\.?$/i,
    build: (m) => ({ kind: "put_basic_opponent_bench_from_hand", maxHp: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^when this pok[ée]mon moves from the active spot to your bench, you may use this ability\.?$/i,
    build: () => ({ kind: "trigger_on_retreat_to_bench" }),
  },
  {
    pattern:
      /^if you have (\w+) in play, you may discard a basic (\w+) energy card from your hand in order to use this ability\.?$/i,
    build: (m) => ({ kind: "require_hand_energy_if_name", nameFilter: m[1]!.trim(), energyType: cap(m[2]!) }),
  },
  {
    pattern:
      /^if your active (\w+) pok[ée]mon is damaged by an attack from your opponent's pok[ée]mon \(even if your active (\w+) pok[ée]mon is knocked out\), place 1 damage counter on the attacking pok[ée]mon\.?$/i,
    build: () => ({ kind: "retaliate_damage_counters", counters: 1 }),
  },
  {
    pattern: /^if you have any (\w+) mega evolution pok[ée]mon ex in play, you may use this ability\.?$/i,
    build: () => ({ kind: "ability_only_while_active" }),
  },
  {
    pattern:
      /^this pok[ée]mon takes (\d+) less damage from attacks from your opponent's (\w+) or (\w+) pok[ée]mon \(after applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "damage_reduction_passive", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if you attached energy to a pok[ée]mon in this way, place (\d+) damage counters on that pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "poison_on_attach_energy", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if you played (.+?) from your hand this turn, you may use this ability\.?$/i,
    build: () => ({ kind: "ability_only_while_active" }),
  },
  {
    pattern:
      /^whenever your opponent's active pok[ée]mon moves to the bench during their turn, place (\d+) damage counters on that pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "counter_on_opponent_switch", counters: parseInt(m[1]!, 10) }),
  },
];

export function matchBulk6Clause(clause: string): ParsedEffect[] | null {
  for (const rule of BULK6_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    return Array.isArray(built) ? built : [built];
  }
  return null;
}
