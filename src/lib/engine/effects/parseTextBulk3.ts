import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function titleCase(value: string): string {
  return value.split(/\s+/).map(cap).join(" ");
}

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => ParsedEffect | ParsedEffect[] };

const BULK3_RULES: Rule[] = [
  {
    pattern: /^if you do, you may move any amount of energy from your other pok[ée]mon to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "move_energy_from_yours_to_self" }),
  },
  {
    pattern: /^this attack does (\d+) damage for each energy attached to your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_energy_opponent_active", perEnergy: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack does (\d+) more damage for each of your benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_per_own_benched", perBench: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^look at the top (\d+) cards of your deck and attach any number of energy cards you find there to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "look_deck_attach_energy", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^put (\d+) damage counters on 1 of your opponent's pok[ée]mon for each basic (\w+) energy card in your discard pile\.?$/i,
    build: (m) => ({
      kind: "damage_per_typed_energy_in_discard",
      counters: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
    }),
  },
  {
    pattern:
      /^for each of your benched pok[ée]mon, search your deck for a card that evolves from that pok[ée]mon and put it onto that pok[ée]mon to evolve it\.?$/i,
    build: () => ({ kind: "evolve_each_bench_from_deck" }),
  },
  {
    pattern: /^shuffle those pok[ée]mon and all attached cards into your opponent's deck\.?$/i,
    build: () => ({ kind: "shuffle_opponent_pokemon_to_deck" }),
  },
  {
    pattern: /^shuffle that pok[ée]mon and all attached cards into their deck\.?$/i,
    build: () => ({ kind: "shuffle_opponent_pokemon_to_deck" }),
  },
  {
    pattern: /^during your opponent's next turn, this pok[ée]mon has no weakness\.?$/i,
    build: () => ({ kind: "no_weakness_next_opponent_turn" }),
  },
  {
    pattern:
      /^your opponent chooses (\d+) cards? from their hand and shuffles those cards into their deck\.?$/i,
    build: (m) => ({ kind: "opponent_choose_shuffle_hand", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^move (\d+) energy from this pok[ée]mon to 1 of your benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "move_energy_to_bench", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage for each of your (.+?) pok[ée]mon in play\.?$/i,
    build: (m) => ({
      kind: "damage_per_named_in_play",
      perPokemon: parseInt(m[1]!, 10),
      nameFilter: m[2]!.trim(),
    }),
  },
  {
    pattern: /^discard a (.+?) energy from this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "discard_named_energy", nameFilter: m[1]!.trim() }),
  },
  {
    pattern: /^if you do, discard your opponent's active pok[ée]mon and all attached cards\.?$/i,
    build: () => ({ kind: "discard_opponent_active" }),
  },
  {
    pattern: /^discard up to (\d+) (\w+) energy from this pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "discard_typed_energy_up_to",
      max: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
    }),
  },
  {
    pattern:
      /^choose 1 of your opponent's active tera pok[ée]mon's attacks and use it as this attack\.?$/i,
    build: () => ({ kind: "copy_opponent_active_attack" }),
  },
  {
    pattern:
      /^look at the top (\d+) cards of your opponent's deck and put them back in any order\.?$/i,
    build: (m) => ({ kind: "reorder_opponent_deck_top", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^attach up to (\d+) basic (\w+) energy cards from your discard pile to this pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "attach_energy_from_discard",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
      target: "self",
    }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon is a stage 2 pok[ée]mon, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_opponent_stage", stage: 2, amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon already has any damage counters on it, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_opponent_damaged", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^during pok[ée]mon checkup, put (\d+) damage counters on that pok[ée]mon instead of 1\.?$/i,
    build: (m) => ({ kind: "poison_enhanced_checkup", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^during pok[ée]mon checkup, place (\d+) damage counters on that pok[ée]mon instead of 1\.?$/i,
    build: (m) => ({ kind: "poison_enhanced_checkup", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if this pok[ée]mon has no damage counters on it, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_self_undamaged", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^you may search your deck for up to (\d+) cards and put them into your hand\.?$/i,
    build: (m) => ({ kind: "search_any_to_hand", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^search your deck for up to (\d+) basic energy cards and attach them to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({ kind: "search_attach_energy_any", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^search your deck for up to (\d+) basic (\w+) energy cards and attach them to your benched pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "search_attach_energy_typed",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
      target: "benched",
    }),
  },
  {
    pattern: /^this attack does (\d+) damage for each trainer card you find there\.?$/i,
    build: (m) => ({ kind: "damage_per_trainer_in_revealed", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if you have (\d+) or fewer benched pok[ée]mon, this attack does nothing\.?$/i,
    build: (m) => ({ kind: "attack_fails_if_bench_at_most", maxBench: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^during your next turn, this pok[ée]mon's (.+?) attack does (\d+) more damage \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({
      kind: "named_attack_bonus_next_turn",
      attackName: titleCase(m[1]!.trim()),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern:
      /^if this pok[ée]mon has at least (\d+) extra energy attached \(in addition to this attack's cost\), this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_extra_energy",
      minExtra: parseInt(m[1]!, 10),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern:
      /^if your opponent's pok[ée]mon is knocked out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this pok[ée]mon\.?$/i,
    build: () => ({ kind: "prevent_damage_effects_next_opponent_turn" }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon has exactly (\d+) damage counters on it, that pok[ée]mon is knocked out\.?$/i,
    build: (m) => ({ kind: "ko_if_exact_counters_on_opponent", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^your opponent reveals their hand, and you discard a card you find there\.?$/i,
    build: () => ({ kind: "reveal_and_discard_opponent_hand" }),
  },
  {
    pattern:
      /^discard up to (\d+) energy cards from this pok[ée]mon, and this attack does (\d+) damage for each card you discarded in this way\.?$/i,
    build: (m) => [
      { kind: "discard_bench_energy_optional", max: parseInt(m[1]!, 10) },
      { kind: "damage_per_discarded_basic_energy", perCard: parseInt(m[2]!, 10) },
    ],
  },
  {
    pattern: /^if this pok[ée]mon has any damage counters on it, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_self_damaged", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage to each of (\d+) of your opponent's pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_two_opponent", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack also does (\d+) damage to (\d+) of your opponent's benched pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_two_opponent", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^you may discard (\d+) (\w+) energy from this pok[ée]mon and make your opponent's active pok[ée]mon (\w+)\.?$/i,
    build: (m) => [
      { kind: "discard_typed_energy_optional", energyType: cap(m[2]!) },
      { kind: "status", status: cap(m[3]!), target: "opponent_active" },
    ],
  },
  {
    pattern: /^this attack does (\d+) damage for each card in your opponent's hand\.?$/i,
    build: (m) => ({ kind: "damage_per_opponent_hand_size", perCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^if a stadium is in play, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_stadium", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^you may discard up to (\d+) energy cards from your hand, and this attack does (\d+) more damage for each card you discarded in this way\.?$/i,
    build: (m) => ({
      kind: "discard_hand_energy_for_damage",
      max: parseInt(m[1]!, 10),
      perCard: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern: /^heal (\d+) damage from each pok[ée]mon \(both yours and your opponent's\)\.?$/i,
    build: (m) => ({ kind: "heal", amount: parseInt(m[1]!, 10), target: "all_in_play" }),
  },
  {
    pattern:
      /^discard all pok[ée]mon tools and special energy from all of your opponent's pok[ée]mon\.?$/i,
    build: () => [{ kind: "discard_opponent_tools" }, { kind: "discard_special_energy_opponent_all" }],
  },
  {
    pattern:
      /^you can use this attack only if you go second, and only during your first turn\.?$/i,
    build: () => ({ kind: "blocked_if_go_second_first_turn_only" }),
  },
  {
    pattern: /^discard the top (\d+) cards of your deck\.?$/i,
    build: (m) => ({ kind: "mill_self_deck", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^during your next turn, this pok[ée]mon can't retreat\.?$/i,
    build: () => ({ kind: "cant_retreat_self_next_turn" }),
  },
  {
    pattern:
      /^for each heads, discard an energy from your opponent's active pok[ée]mon\.?$/i,
    build: () => ({ kind: "coin_multi_discard_energy", perHeads: 1 }),
  },
  {
    pattern: /^you may do (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "optional_damage_bonus", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if heads, your opponent's active pok[ée]mon is now (\w+) and (\w+)\.?$/i,
    build: (m) => [
      { kind: "status", status: cap(m[1]!), target: "opponent_active" },
      { kind: "status", status: cap(m[2]!), target: "opponent_active" },
    ],
  },
  {
    pattern: /^for each heads, choose a random card from your opponent's hand\.?$/i,
    build: () => ({ kind: "discard_random_opponent_hand", count: 1 }),
  },
  {
    pattern: /^your opponent reveals those cards and shuffles them into their deck\.?$/i,
    build: () => ({ kind: "shuffle_revealed_to_deck" }),
  },
  {
    pattern:
      /^if 1 of your pok[ée]mon used (.+?) during your last turn, this attack can't be used\.?$/i,
    build: (m) => ({ kind: "cant_use_if_named_attack_last_turn", attackName: titleCase(m[1]!.trim()) }),
  },
  {
    pattern:
      /^if this pok[ée]mon evolved from (\w+) during this turn, your opponent discards (\d+) more cards\.?$/i,
    build: (m) => ({ kind: "opponent_discard_from_hand", count: parseInt(m[2]!, 10) }),
  },
  {
    pattern:
      /^this attack does (\d+) damage for each damage counter on all of your benched (.+?) pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage_per_benched_named_counters",
      perCounter: parseInt(m[1]!, 10),
      nameFilter: m[2]!.trim(),
    }),
  },
  {
    pattern:
      /^discard (\d+) basic (\w+) energy cards from your hand, and knock out your opponent's active pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "discard_hand_energy_ko_opponent_active",
      count: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
    }),
  },
  {
    pattern: /^put up to (\d+) (\w+) from your discard pile onto your bench\.?$/i,
    build: (m) => ({
      kind: "recover_pokemon_from_discard",
      count: parseInt(m[1]!, 10),
      nameFilter: cap(m[2]!.trim()),
      target: "bench",
    }),
  },
];

export function matchBulk3Clause(clause: string): ParsedEffect[] | null {
  for (const rule of BULK3_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    return Array.isArray(built) ? built : [built];
  }
  return null;
}
