import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Rule = { pattern: RegExp; build: (m: RegExpMatchArray) => ParsedEffect | ParsedEffect[] | null };

/** Top stub clauses by cardCount — converts generic_effect_stub into typed effects. */
const BULK7_RULES: Rule[] = [
  {
    pattern:
      /^\(you can choose the same pok[ée]mon more than once\.\)\s*for each time you chose a pok[ée]mon, do (\d+) damage to it\.?$/i,
    build: () => null,
  },
  {
    pattern:
      /^place (\d+) damage counters on your opponent's active pok[ée]mon for each card in your hand\.?$/i,
    build: (m) => ({ kind: "damage_per_self_hand_size", countersPerCard: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if you have the same number of cards in your hand as your opponent, attacks used by this pok[ée]mon do (\d+) more damage to your opponent's active pok[ée]mon \(before applying weakness and resistance\)\.?$/i,
    build: (m) => ({ kind: "self_hand_equal_damage_bonus", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^when this pok[ée]mon moves from your bench to the active spot, you may use this ability\.?$/i,
    build: () => null,
  },
  {
    pattern:
      /^if your benched pok[ée]mon have any damage counters on them, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({ kind: "damage_bonus_if_any_bench_damaged", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^attach a number of basic (\w+) energy cards up to the number of heads from your discard pile to your benched pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "coin_attach_energy_from_discard",
      energyType: cap(m[1]!),
      target: "benched",
    }),
  },
  {
    pattern: /^for each tails, discard an energy from this pok[ée]mon\.?$/i,
    build: () => ({ kind: "coin_multi_discard_self_energy", perTails: 1 }),
  },
  {
    pattern: /^for each heads, discard a random card from your opponent's hand\.?$/i,
    build: () => ({ kind: "coin_multi_discard_random_hand", perHeads: 1 }),
  },
  {
    pattern:
      /^this attack does (\d+) damage to each pok[ée]mon that has any damage counters on it \(both yours and your opponent's\), except for this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "damage_each_damaged_except_self", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^during your next turn, if the defending pok[ée]mon is knocked out, take (\d+) more prize cards?\.?$/i,
    build: (m) => ({ kind: "bonus_prize_on_defender_ko_next_turn", count: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^if you played a future supporter card from your hand during this turn, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_played_named_supporter",
      nameFilter: "Future",
      amount: parseInt(m[1]!, 10),
    }),
  },
  {
    pattern: /^if you have (\d+) or more energy in play, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_energy_in_play",
      minEnergy: parseInt(m[1]!, 10),
      amount: parseInt(m[2]!, 10),
    }),
  },
  {
    pattern: /^put a basic (\w+) energy card from your discard pile into your hand\.?$/i,
    build: (m) => ({ kind: "recover_energy_from_discard", energyType: cap(m[1]!) }),
  },
  {
    pattern:
      /^if you put any pok[ée]mon onto your bench in this way, move an energy from this pok[ée]mon to the new benched pok[ée]mon\.?$/i,
    build: () => ({ kind: "move_energy_to_new_bench_after_search" }),
  },
  {
    pattern: /^put up to (\d+) damage counters on this pok[ée]mon\.?$/i,
    build: (m) => ({ kind: "self_place_counters_optional", max: parseInt(m[1]!, 10) }),
  },
  {
    pattern:
      /^this attack also does (\d+) damage to each benched pok[ée]mon \(both yours and your opponent's\)\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10),
      target: "opponent_bench_each",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern:
      /^attach up to (\d+) basic energy cards from your discard pile to your pok[ée]mon in any way you like\.?$/i,
    build: (m) => ({
      kind: "attach_energy_from_discard",
      count: parseInt(m[1]!, 10),
      energyType: "Any",
      target: "any_yours",
    }),
  },
  {
    pattern:
      /^this attack also does (\d+) damage to each benched pok[ée]mon \(both yours and your opponent's\)\.?$/i,
    build: (m) => ({ kind: "damage_all_benched", amount: parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^this attack also does (\d+) damage to 1 of your benched pok[ée]mon\.?$/i,
    build: (m) => ({
      kind: "damage",
      amount: parseInt(m[1]!, 10),
      target: "your_pokemon",
      applyWeaknessRes: false,
    }),
  },
  {
    pattern: /^if both of them are tails, your opponent's active pok[ée]mon is now (\w+)\.?$/i,
    build: (m) => ({ kind: "coin_both_tails_status", status: cap(m[1]!) }),
  },
  {
    pattern: /^attach an energy card from your hand to this pok[ée]mon\.?$/i,
    build: () => ({
      kind: "attach_basic_energy_from_hand",
      energyType: "Any",
      target: "self",
    }),
  },
  {
    pattern: /^discard a basic (\w+) energy card from your hand\.?$/i,
    build: (m) => ({ kind: "require_discard_hand_energy_for_attack", energyType: cap(m[1]!) }),
  },
  {
    pattern: /^if you have at least (\d+) (\w+) energy in play, this attack does (\d+) more damage\.?$/i,
    build: (m) => ({
      kind: "damage_bonus_if_typed_energy_in_play",
      minEnergy: parseInt(m[1]!, 10),
      energyType: cap(m[2]!),
      amount: parseInt(m[3]!, 10),
    }),
  },
  {
    pattern: /^look at the top card of your opponent's deck\.?$/i,
    build: () => ({ kind: "reveal_opponent_deck_top", count: 1 }),
  },
  {
    pattern:
      /^if you didn't play (.+?) from your hand during this turn, this attack does nothing\.?$/i,
    build: (m) => ({ kind: "attack_fails_unless_played_card", cardName: m[1]!.trim() }),
  },
];

export function matchBulk7Clause(clause: string): ParsedEffect[] | null {
  for (const rule of BULK7_RULES) {
    const match = clause.match(rule.pattern);
    if (!match) continue;
    const built = rule.build(match);
    if (built === null) return [];
    return Array.isArray(built) ? built : [built];
  }
  return null;
}

export function matchBulk7AttackText(normalized: string): ParsedEffect[] | null {
  let match: RegExpMatchArray | null;

  match = normalized.match(
    /^flip (\d+) coins\. for each tails, discard an energy from this pok[ée]mon\.?$/i,
  );
  if (match) {
    return [{ kind: "coin_multi_discard_self_energy", perTails: 1, coinCount: parseInt(match[1]!, 10) }];
  }

  match = normalized.match(
    /^flip (\d+) coins\. for each heads, discard a random card from your opponent's hand\.?$/i,
  );
  if (match) {
    return [{ kind: "coin_multi_discard_random_hand", perHeads: 1, coinCount: parseInt(match[1]!, 10) }];
  }

  match = normalized.match(
    /^flip (\d+) coins\. attach a number of basic (\w+) energy cards up to the number of heads from your discard pile to your benched pok[ée]mon in any way you like\.?$/i,
  );
  if (match) {
    return [{
      kind: "coin_attach_energy_from_discard",
      energyType: cap(match[2]!),
      target: "benched",
      coinCount: parseInt(match[1]!, 10),
    }];
  }

  match = normalized.match(
    /^flip (\d+) coins\. this attack does (\d+) damage for each heads\. if both of them are tails, your opponent's active pok[ée]mon is now (\w+)\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "coin_multi_damage",
        perHeads: parseInt(match[2]!, 10),
        coinCount: parseInt(match[1]!, 10),
        bonusOnly: false,
      },
      { kind: "coin_both_tails_status", status: cap(match[3]!) },
    ];
  }

  return null;
}
