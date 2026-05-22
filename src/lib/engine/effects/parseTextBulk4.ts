import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => ParsedEffect | ParsedEffect[] };

const BULK4_RULES: Rule[] = [
  {
    pattern: /^for each heads, discard the top card of your opponent's deck\.?$/i,
    build: () => ({ kind: "mill_opponent_deck", count: 1 }),
  },
  {
    pattern: /^if you do, switch out your opponent's active pok[ée]mon to the bench\.?$/i,
    build: () => ({ kind: "switch_opponent_active_to_bench" }),
  },
  {
    pattern: /^you may switch out your opponent's active pok[ée]mon to the bench\.?$/i,
    build: () => ({ kind: "switch_opponent_active_to_bench" }),
  },
  {
    pattern: /^discard a card from your hand\.?$/i,
    build: () => ({ kind: "require_discard_hand_for_ability" }),
  },
  {
    pattern: /^search your deck for a stadium card, reveal it, and put it into your hand\.?$/i,
    build: () => ({ kind: "search_stadium_to_hand" }),
  },
  {
    pattern:
      /^as long as this pok[ée]mon is in the active spot, it can evolve during your first turn or the turn you play it\.?$/i,
    build: () => ({ kind: "can_evolve_first_turn_while_active" }),
  },
  {
    pattern:
      /^this pok[ée]mon can evolve into any pok[ée]mon ex that evolves from eevee if you play it from your hand onto this pok[ée]mon\.?$/i,
    build: () => ({ kind: "special_evolve_from_eevee" }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon during your turn, you may have your opponent reveal their hand and you put any number of basic pok[ée]mon you find there onto their bench\.?$/i,
    build: () => ({ kind: "evolve_reveal_basic_to_opponent_bench" }),
  },
  {
    pattern:
      /^as long as this pok[ée]mon is in the active spot, your opponent's active pok[ée]mon has no abilities, except for (.+)\.?$/i,
    build: (m) => ({ kind: "disable_opponent_active_abilities", exceptName: m[1]!.trim() }),
  },
  {
    pattern:
      /^attach a basic (\w+) energy card, a basic (\w+) energy card, or 1 of each from your hand to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "attach_dual_type_energy_from_hand", typeA: cap(m[1]!), typeB: cap(m[2]!) }),
  },
  {
    pattern:
      /^during pok[ée]mon checkup, put 1 damage counter on each pok[ée]mon that has an ability \(both yours and your opponent's\), except any (.+)\.?$/i,
    build: (m) => ({ kind: "checkup_counter_on_ability_pokemon", exceptName: m[1]!.trim() }),
  },
  {
    pattern:
      /^if this pok[ée]mon is in the active spot, you may look at the top (\d+) cards of your deck, reveal a supporter card you find there, and put it into your hand\.?$/i,
    build: (m) => ({ kind: "look_deck_supporter_to_hand", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon during your turn, you may switch in 1 of your opponent's benched pok[ée]mon that has (\d+) hp or less remaining to the active spot\.?$/i,
    build: (m) => ({ kind: "evolve_switch_low_hp_opponent_bench", maxHp: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon, if you have any tera pok[ée]mon in play, you may search your deck for up to (\d+) trainer cards, reveal them, and put them into your hand\.?$/i,
    build: (m) => ({ kind: "evolve_search_trainers_if_tera", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^attach up to (\d+) basic energy cards from your discard pile to your (\w+) pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "attach_energy_from_discard",
      count: parseInt(m[1]!, 10),
      energyType: "Any",
      target: "benched_named",
      nameFilter: `${m[2]!.trim()}'s`,
    }),
  },
  {
    pattern:
      /^if this pok[ée]mon is in the active spot and is damaged by an attack from your opponent's pok[ée]mon \(even if this pok[ée]mon is knocked out\), put (\d+) damage counters on the attacking pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "retaliate_damage_counters", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if this pok[ée]mon is in the active spot and is damaged by an attack from your opponent's pok[ée]mon \(even if this pok[ée]mon is knocked out\), place (\d+) damage counters on the attacking pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "retaliate_damage_counters", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^as long as this pok[ée]mon is on your bench, prevent all damage from and effects of attacks from your opponent's pok[ée]mon done to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "prevent_damage_on_bench" }),
  },
  {
    pattern:
      /^as long as this pok[ée]mon is in the active spot, pok[ée]mon with a rule box in play \(both yours and your opponent's\) have no abilities, except for future pok[ée]mon\.?$/i,
    build: () => ({ kind: "disable_rule_box_abilities_except_future" }),
  },
  {
    pattern: /^if this pok[ée]mon has any darkness energy attached and is damaged by an attack, flip a coin\.?$/i,
    build: () => ({ kind: "if_damaged_flip_coin" }),
  },
  {
    pattern:
      /^if this pok[ée]mon has any darkness energy attached, it gets \+(\d+) hp, and the attacks it uses do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "darkness_energy_boost", hpBonus: parseInt(m[1]!, 10), damageBonus: parseInt(m[2]!, 10) }),
  },
  {
    pattern:
      /^if this pok[ée]mon is in the active spot and is damaged by an attack from your opponent's pok[ée]mon \(even if this pok[ée]mon is knocked out\), the attacking pok[ée]mon is now burned\.?$/i,
    build: () => ({ kind: "burn_attacker_when_damaged_from_opponent" }),
  },
  {
    pattern: /^put (\d+) damage counters on 1 of your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10) * 10,
      target: "opponent_bench_choose",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern:
      /^if this pok[ée]mon is knocked out by damage from an attack from your opponent's pok[ée]mon, and if you have any (.+?) in play, your opponent takes 1 fewer prize card\.?$/i,
    build: (m) => ({ kind: "reduce_prize_when_named_ko_by_ex", nameFilter: m[1]!.trim() }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon during your turn, you may heal all damage from each of your evolution pok[ée]mon\.?$/i,
    build: () => ({ kind: "evolve_heal_all_evolution" }),
  },
  {
    pattern: /^if you healed any damage in this way, discard all energy from those pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_energy_after_heal_evolution" }),
  },
  {
    pattern: /^all of your pok[ée]mon that have (\w+) energy attached have no retreat cost\.?$/i,
    build: (m) => ({ kind: "no_retreat_if_typed_energy", energyType: cap(m[1]!) }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand onto your bench during your turn, you may discard the top card of your opponent's deck\.?$/i,
    build: () => ({ kind: "mill_opponent_deck", count: 1 }),
  },
  {
    pattern: /^prevent all effects of attacks used by your opponent's pok[ée]mon done to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "prevent_attack_effects_on_self" }),
  },
  {
    pattern:
      /^prevent all damage from and effects of attacks from your opponent's tera pok[ée]mon done to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "prevent_damage_from_tera_on_self" }),
  },
  {
    pattern: /^when your opponent's active pok[ée]mon is knocked out, flip a coin\.?$/i,
    build: () => ({ kind: "coin_flip_on_opponent_ko" }),
  },
  {
    pattern: /^if heads, take 1 more prize card\.?$/i,
    build: () => ({ kind: "bonus_prize_on_coin_heads" }),
  },
  {
    pattern: /^your basic pok[ée]mon in play have no retreat cost\.?$/i,
    build: () => ({ kind: "basic_pokemon_no_retreat" }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon during your turn, you may attach up to (\d+) basic (\w+) energy cards from your discard pile to your (\w+) pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "evolve_attach_energy_from_discard",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
      nameFilter: `${m[3]!.trim()}'s`,
    }),
  },
  {
    pattern: /^prevent all damage done to this pok[ée]mon by attacks from your opponent's pok[ée]mon ex\.?$/i,
    build: () => ({ kind: "prevent_damage_from_ex_on_self" }),
  },
  {
    pattern: /^if this pok[ée]mon is in the active spot, you may make your opponent's active pok[ée]mon burned\.?$/i,
    build: () => ({ kind: "status", status: "Burned", target: "opponent_active" }),
  },
  {
    pattern:
      /^when this pok[ée]mon moves from your bench to the active spot, you may search your deck for up to (\d+) basic (\w+) energy cards and attach them to this pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "search_attach_energy_to_self",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
    }),
  },
  {
    pattern: /^attach a basic energy card from your discard pile to this pok[ée]mon\.?$/i,
    build: () => ({
      kind: "attach_energy_from_discard",
      count: 1,
      energyType: "Any",
      target: "self",
    }),
  },
  {
    pattern:
      /^attacks used by your pok[ée]mon do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "team_damage_bonus_to_opponent_active", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^attach a basic (\w+) energy card from your discard pile to 1 of your benched pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "attach_energy_from_discard",
      count: 1,
      energyType: cap(m[1]!),
      target: "benched",
    }),
  },
  {
    pattern: /^if you go first, this pok[ée]mon can use attacks during your first turn\.?$/i,
    build: () => ({ kind: "allow_attack_first_turn_if_go_first" }),
  },
  {
    pattern:
      /^as long as this pok[ée]mon is in the active spot, your opponent can't play any item cards or pok[ée]mon tool cards from their hand\.?$/i,
    build: () => ({ kind: "block_opponent_items_and_tools_while_active" }),
  },
  {
    pattern:
      /^if this pok[ée]mon has a pok[ée]mon tool attached, your opponent can't play any ace spec cards from their hand\.?$/i,
    build: () => ({ kind: "block_opponent_ace_spec_when_tool_attached" }),
  },
  {
    pattern:
      /^if your opponent's basic pok[ée]mon is knocked out by damage from an attack used by this pok[ée]mon, take 1 more prize card\.?$/i,
    build: () => ({ kind: "bonus_prize_on_ko_basic" }),
  },
  {
    pattern:
      /^search your deck for up to (\d+) evolution (\w+) pok[ée]mon, reveal them, and put them into your hand\.?$/i,
    build: (m) => ({ kind: "search_evolution_typed_to_hand", count: parseInt(m[1]!, 10), typeFilter: cap(m[2]!) }),
  },
  {
    pattern: /^move a basic (\w+) energy from 1 of your pok[ée]mon to another of your pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "move_typed_energy_between_yours", energyType: cap(m[1]!) }),
  },
  {
    pattern: /^each of your pok[ée]mon that has "(.+?)" in its name may have up to (\d+) pok[ée]mon tool cards attached\.?$/i,
    build: (m) => ({ kind: "allow_extra_tools", namePattern: m[1]!.trim(), maxTools: parseInt(m[2]!, 10) }),
  },
  {
    pattern:
      /^if this ability goes away, discard pok[ée]mon tools from those pok[ée]mon until only 1 remains on each\.?$/i,
    build: () => ({ kind: "discard_extra_tools_when_ability_lost" }),
  },
  {
    pattern:
      /^pok[ée]mon in play \(both yours and your opponent's\) lose any ability that requires the pok[ée]mon using it to knock out itself\.?$/i,
    build: () => ({ kind: "disable_self_ko_abilities" }),
  },
  {
    pattern: /^if this pok[ée]mon would be knocked out by damage from an attack, flip a coin\.?$/i,
    build: () => ({ kind: "survive_ko_coin" }),
  },
  {
    pattern: /^if heads, this pok[ée]mon is not knocked out, and its remaining hp becomes (\d+)\.?$/i,
    build: (m) => ({ kind: "survive_ko_coin_heads_hp", hp: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^prevent all effects of your opponent's pok[ée]mon's abilities done to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "prevent_opponent_ability_effects_on_self" }),
  },
  {
    pattern: /^when you play this pok[ée]mon from your hand onto your bench, you may use this ability\.?$/i,
    build: () => ({ kind: "evolve_trigger_ability" }),
  },
  {
    pattern: /^you can't use more than 1 ability that has "(.+?)" in its name each turn\.?$/i,
    build: (m) => ({ kind: "ability_use_limit_per_turn", namePattern: m[1]!.trim() }),
  },
  {
    pattern: /^if heads, choose 1 of your opponent's benched pok[ée]mon\.?$/i,
    build: () => ({ kind: "coin_choose_opponent_bench" }),
  },
  {
    pattern:
      /^move all damage counters from 1 of your benched (.+?) pok[ée]mon to your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "move_counters_from_bench_to_opponent", nameFilter: m[1]!.trim() }),
  },
  {
    pattern:
      /^search your deck for up to (\d+) basic energy cards and attach them to your future pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "search_attach_energy_named", count: parseInt(m[1]!, 10), nameFilter: "Future" }),
  },
  {
    pattern: /^reveal the top (\d+) cards of your deck\.?$/i,
    build: (m) => ({ kind: "reveal_deck_top", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^place (\d+) damage counters on 1 of your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10) * 10,
      target: "opponent_bench_choose",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each (\w+) energy attached to this pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage_per_typed_energy",
      energyType: cap(m[2]!),
      perEnergy: parseInt(m[1]!, 10),
      scope: "self",
      bonusOnly: true,
    }),
  },
  {
    pattern: /^this attack does (\d+) damage for each (\w+) energy attached to this pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage_per_typed_energy",
      energyType: cap(m[2]!),
      perEnergy: parseInt(m[1]!, 10),
      scope: "self",
      bonusOnly: false,
    }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each damage counter on this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_self_counter_more", perCounter: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) damage for each damage counter on this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_self_counter", perCounter: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each benched pok[ée]mon \(both yours and your opponent's\)\.?$/i,
    build: (m) => ({ kind: "damage_per_all_benched", perBench: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) damage for each of your benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_own_benched", perBench: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each energy attached to this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_on_self", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) damage for each energy attached to this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_on_self", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) more damage for each energy attached to your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_opponent_active", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^search your deck for up to (\d+) basic energy cards, reveal them, and put them into your hand\.?$/i,
    build: (m) => ({ kind: "search_basic_energy_to_hand", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^search your deck for a pok[ée]mon, reveal it, and put it into your hand\.?$/i,
    build: () => ({ kind: "search_pokemon_to_hand" }),
  },
  {
    pattern: /^you may switch this pok[ée]mon with 1 of your benched pok[ée]mon\.?$/i,
    build: () => ({ kind: "optional_switch_with_bench" }),
  },
  {
    pattern: /^discard an energy from your opponent's active pok[ée]mon\.?$/i,
    build: () => ({ kind: "discard_energy", count: 1, from: "opponent_active" }),
  },
  {
    pattern: /^discard (\d+) energy from your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "discard_energy", count: parseInt(m[1]!, 10), from: "opponent_active" }),
  },
  {
    pattern: /^heal (\d+) damage from this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "heal", amount: parseInt(m[1]!, 10), target: "self_active" }),
  },
  {
    pattern: /^discard the top card of your opponent's deck\.?$/i,
    build: () => ({ kind: "mill_opponent_deck", count: 1 }),
  },
  {
    pattern: /^your opponent reveals their hand\.?$/i,
    build: () => ({ kind: "reveal_opponent_hand" }),
  },
  {
    pattern: /^if you go second, you can't use this attack during your first turn\.?$/i,
    build: () => ({ kind: "blocked_if_second_player_first_turn" }),
  },
];

export function matchBulk4Clause(clause: string): ParsedEffect[] | null {
  for (const rule of BULK4_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    return Array.isArray(built) ? built : [built];
  }
  return null;
}
