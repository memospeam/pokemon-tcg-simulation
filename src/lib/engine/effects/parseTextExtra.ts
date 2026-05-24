import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type PatternRule = { pattern: RegExp; build: (match: RegExpMatchArray) => ParsedEffect | ParsedEffect[] | null };

const EXTRA_CLAUSE_RULES: PatternRule[] = [
  {
    pattern:
      /^flip a coin\. if heads, knock out your opponent's active basic pok[ée]mon\. if tails, knock out 1 of your opponent's benched basic pok[ée]mon\.?$/i,
    build: () => ({ kind: "coin_flip_ko_basic" }),
  },
  {
    pattern: /^you may put this pok[ée]mon into your hand\.?$/i,
    build: () => ({ kind: "return_self_to_hand" }),
  },
  {
    pattern: /^this attack does (\d+) (more )?damage for each of your pok[ée]mon in play that has the (.+?) attack\.?$/i,
    build: (m) => ({
      kind: "damage_per_named_attack_in_play",
      perPokemon: parseInt(m[1]!, 10),
      attackName: m[3]!.trim(),
      bonusOnly: !!m[2],
    }),
  },
  {
    pattern: /^if this pok[ée]mon moved from your bench to the active spot this turn, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_moved_from_bench", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^discard any amount of (\w+) energy from among your pok[ée]mon, and this attack does (\d+) damage for each card you discarded in this way\.?$/i,
    build: (m) => [
      { kind: "discard_typed_energy_optional", energyType: cap(m[1]!) },
      { kind: "damage_per_discarded_basic_energy", perCard: parseInt(m[2]!, 10) },
    ],
  },
  {
    pattern:
      /^you may put a (\w+) energy attached to this pok[ée]mon into your hand and have this attack do (\d+) more damage\.?$/i,
    build: (m) => [
      { kind: "return_typed_energy_to_hand", energyType: cap(m[1]!) },
      { kind: "damage_per_discarded_basic_energy", perCard: parseInt(m[2]!, 10) },
    ],
  },
  {
    pattern: /^attacks used by this pok[ée]mon cost (\w+) less for each (.+?) card in your discard pile\.?$/i,
    build: (m) => ({
      kind: "attack_cost_reduction_per_discard_name",
      energyType: cap(m[1]!),
      nameFilter: m[2]!.trim(),
      perCard: 1,
    }),
  },
  {
    pattern:
      /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon during your turn, you may choose 2 of your opponent's pok[ée]mon and put (\d+) damage counters on each of them\.?$/i,
    build: (m) => ({ kind: "evolve_place_counters_on_two_opponent", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if 1 of your (\w+) pok[ée]mon is knocked out by damage from an attack from your opponent's pok[ée]mon ex, that player takes 1 fewer prize card\.?$/i,
    build: (m) => ({ kind: "reduce_prize_when_named_ko_by_ex", nameFilter: m[1]!.trim() }),
  },
  {
    pattern:
      /^if this pok[ée]mon is in the active spot, you may discard a basic (\w+) energy card from your hand in order to use this ability\.?$/i,
    build: (m) => [
      { kind: "ability_only_while_active" },
      { kind: "require_hand_energy_in_active", energyType: cap(m[1]!) },
    ],
  },
  {
    pattern: /^this attack does (\d+) (more )?damage for each basic energy card in your opponent's discard pile\.?$/i,
    build: (m) => ({
      kind: "damage_per_energy_in_opponent_discard",
      perEnergy: parseInt(m[1]!, 10),
      bonusOnly: !!m[2],
    }),
  },
  {
    pattern: /^this attack also does (\d+) damage to each of your benched pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10),
      target: "your_pokemon",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern: /^your opponent's active pok[ée]mon is now burned and confused\.?$/i,
    build: () => [
      { kind: "status", status: "Burned", target: "opponent_active" },
      { kind: "status", status: "Confused", target: "opponent_active" },
    ],
  },
  {
    pattern: /^put a supporter card from your discard pile into your hand\.?$/i,
    build: () => ({ kind: "recover_supporter_from_discard" }),
  },
  {
    pattern: /^if this pok[ée]mon is poisoned, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_self_poisoned", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if your opponent's active pok[ée]mon is a pok[ée]mon ex or pok[ée]mon v, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_opponent_tag", tag: "ex", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^switch this pok[ée]mon with 1 of your benched (\w+) pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "switch_with_bench_typed", typeFilter: cap(m[1]!) }),
  },
  {
    pattern: /^at the end of your opponent's next turn, put (\d+) damage counters on the defending pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "delayed_counters_on_defender", counters: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^during your opponent's next turn, prevent all damage done to this pok[ée]mon by attacks\.?$/i,
    build: () => ({ kind: "prevent_damage_effects_next_opponent_turn" }),
  },
];

export function matchExtraClause(clause: string): ParsedEffect[] | null {
  for (const rule of EXTRA_CLAUSE_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    if (!built) return [];
    return Array.isArray(built) ? built : [built];
  }
  return null;
}
