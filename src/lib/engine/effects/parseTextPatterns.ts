import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function titleCase(value: string): string {
  return value.split(/\s+/).map(cap).join(" ");
}

function nameFilter(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.toLowerCase().endsWith("'s") ? trimmed : `${trimmed}'s`;
}

const ENERGY_TYPES = new Set([
  "grass",
  "fire",
  "water",
  "lightning",
  "psychic",
  "fighting",
  "darkness",
  "metal",
  "dragon",
  "fairy",
  "colorless",
]);

/** Clauses absorbed during coalescing — not counted as unknown. */
export const SKIP_UNKNOWN_CLAUSE_PATTERNS: RegExp[] = [
  /^flip a coin\.?$/,
  /^flip a coin until you get tails\.?$/,
  /^use this ability\.?$/,
  /^shuffle the other cards back into your deck\.?$/,
  /^\(pokémon ex, pokémon v, etc\.?$/,
  /^have rule boxes\.\)?$/,
  /^flip \d+ coins\.?$/,
  /^if heads, this attack does \d+ damage to that pok[ée]mon\.?$/,
  /^for each of your opponent's pok[ée]mon, flip a coin\.?$/,
  /^\(discard all cards attached to this pok[ée]mon\.\)?$/,
  /^look at the top card of your deck\.?$/,
  /^you may discard that card\.?$/,
  /^flip a coin for each energy attached to this pok[ée]mon\.?$/,
  /^you may put any number of pok[ée]mon you find there onto your bench\.?$/,
  /^then, shuffle those energy cards into your deck\.?$/,
  /^if you do, heal all damage from that pok[ée]mon\.?$/,
  /^the effect of .+ doesn't stack\.?$/,
  /^put this pok[ée]mon into play only with the effect of .+\.?$/,
  /^then, discard that stadium\.?$/,
  /^if you attached energy to a pok[ée]mon in this way, this pok[ée]mon is now poisoned\.?$/,
  /^if heads, knock out your opponent's active basic pok[ée]mon\.?$/,
  /^if tails, knock out 1 of your opponent's benched basic pok[ée]mon\.?$/,
  /^if you do, heal all damage from that pok[ée]mon\.?$/,
  /^during your opponent's next turn, that pok[ée]mon can't use that attack\.?$/,
  /^choose 1 of your opponent's active pok[ée]mon's attacks\.?$/,
  /^put the other card on the bottom of your deck\.?$/,
  /^shuffle the other cards back into your deck\.?$/,
  /^\(this pok[ée]mon can't evolve during your first turn or the turn you play it\.\)?$/,
  /^\(damage is not an effect\.\)?$/,
  /^\(that prize card remains face up for the rest of the game\.\)?$/,
  /^\(you can choose the same pok[ée]mon more than once\.\)?$/,
  /^this damage isn't affected by weakness or resistance\.?$/,
  /^if you can't, this attack does nothing\.?$/,
  /^have rule boxes\.\)?$/,
];

export function shouldSkipUnknownClause(clause: string): boolean {
  return SKIP_UNKNOWN_CLAUSE_PATTERNS.some((pattern) => pattern.test(clause));
}

export function matchBulkClause(clause: string): ParsedEffect[] | null {
  let match: RegExpMatchArray | null;

  if (/^switch in 1 of your opponent's benched pok[ée]mon to the active spot\.?$/i.test(clause)) {
    return [{ kind: "switch_opponent_active_to_bench" }];
  }

  if (/^during your opponent's next turn, that pok[ée]mon can't retreat\.?$/i.test(clause)) {
    return [{ kind: "cant_retreat_defending_next_turn" }];
  }

  if (/^if you do, the new active pok[ée]mon is now poisoned\.?$/i.test(clause)) {
    return [{ kind: "apply_status_to_new_active", status: "Poisoned" }];
  }

  if (
    /^you may move any number of damage counters from your opponent's pok[ée]mon to their other pok[ée]mon in any way you like\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "redistribute_opponent_counters", optional: true }];
  }

  match = clause.match(
    /^search your deck for a (.+?) pok[ée]mon, reveal it, and put it into your hand\.?$/i,
  );
  if (match) {
    const raw = match[1]!.trim();
    const nameFilter = raw.charAt(0).toUpperCase() + raw.slice(1);
    return [{ kind: "search_named_pokemon_to_hand", nameFilter }];
  }

  match = clause.match(/^discard the top (\d+) cards? of your opponent's deck\.?$/i);
  if (match) {
    return [{ kind: "mill_opponent_deck", count: parseInt(match[1]!, 10) }];
  }

  if (/^discard a stadium in play\.?$/i.test(clause)) {
    return [{ kind: "discard_stadium" }];
  }

  match = clause.match(/^heal (\d+) damage from 1 of your pok[ée]mon\.?$/i);
  if (match) {
    return [{ kind: "heal", amount: parseInt(match[1]!, 10), target: "your_pokemon_choose" }];
  }

  match = clause.match(/^heal (\d+) damage from each of your pok[ée]mon\.?$/i);
  if (match) {
    return [{ kind: "heal", amount: parseInt(match[1]!, 10), target: "all_yours" }];
  }

  match = clause.match(
    /^this attack does (\d+) (more )?damage for each prize card your opponent has taken\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_bonus_per_opponent_prize",
        perPrize: parseInt(match[1]!, 10),
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(
    /^this attack does (\d+) (more )?damage for each (\w+) energy attached to this pok[ée]mon\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_per_typed_energy",
        energyType: cap(match[3]!),
        perEnergy: parseInt(match[1]!, 10),
        scope: "self",
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(
    /^this attack does (\d+) (more )?damage for each (\w+) energy attached to all of your pok[ée]mon\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_per_typed_energy",
        energyType: cap(match[3]!),
        perEnergy: parseInt(match[1]!, 10),
        scope: "all_yours",
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(
    /^this attack does (\d+) (more )?damage for each damage counter on your opponent's active pok[ée]mon\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_per_opponent_active_counter",
        perCounter: parseInt(match[1]!, 10),
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(/^this attack does (\d+) (more )?damage for each of your opponent's benched pok[ée]mon\.?$/i);
  if (match) {
    return [
      {
        kind: "damage_per_opponent_benched",
        perBench: parseInt(match[1]!, 10),
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(/^this attack does (\d+) less damage for each damage counter on this pok[ée]mon\.?$/i);
  if (match) {
    return [{ kind: "damage_less_per_self_counter", perCounter: parseInt(match[1]!, 10) }];
  }

  match = clause.match(
    /^this pok[ée]mon can't use (.+?) again until it leaves the active spot\.?$/i,
  );
  if (match) {
    return [{ kind: "cant_reuse_attack_until_leave_active", attackName: titleCase(match[1]!.trim()) }];
  }

  match = clause.match(/^during your next turn, this pok[ée]mon can't use (.+?)\.?$/i);
  if (match) {
    return [{ kind: "cant_use_named_attack_next_turn", attackName: titleCase(match[1]!.trim()) }];
  }

  match = clause.match(
    /^during your opponent's next turn, if this pok[ée]mon is damaged by an attack \(even if it is knocked out\), put (\d+) damage counters on the attacking pok[ée]mon\.?$/i,
  );
  if (match) {
    return [{ kind: "retaliate_damage_counters", counters: parseInt(match[1]!, 10) }];
  }

  if (
    /^if heads, during your opponent's next turn, prevent all damage done to this pok[ée]mon by attacks\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "prevent_damage_next_turn", filter: "coin_heads" }];
  }

  match = clause.match(
    /^if your opponent's active pok[ée]mon is an evolution pok[ée]mon, this attack does (\d+) more damage(?:, and discard all energy from this pok[ée]mon)?\.?$/i,
  );
  if (match) {
    const effects: ParsedEffect[] = [
      {
        kind: "damage_bonus_if_opponent_tag",
        tag: "evolution",
        amount: parseInt(match[1]!, 10),
      },
    ];
    if (/discard all energy from this pokémon/.test(clause)) {
      effects.push({ kind: "discard_all_energy", from: "self_active" });
    }
    return effects;
  }

  match = clause.match(
    /^if your opponent's active pok[ée]mon is a pok[ée]mon ex, this attack does (\d+) more damage\.?$/i,
  );
  if (match) {
    return [{ kind: "damage_bonus_if_opponent_tag", tag: "ex", amount: parseInt(match[1]!, 10) }];
  }

  match = clause.match(/^you may shuffle (\d+) energy attached to this pok[ée]mon into your deck\.?$/i);
  if (match) {
    return [{ kind: "shuffle_attached_energy_to_deck", count: parseInt(match[1]!, 10) }];
  }

  match = clause.match(
    /^during your opponent's next turn, attacks used by the defending pok[ée]mon do (\d+) less damage \(before applying weakness and resistance\)\.?$/i,
  );
  if (match) {
    return [{ kind: "defending_attack_damage_reduction", amount: parseInt(match[1]!, 10) }];
  }

  match = clause.match(
    /^search your deck for up to (\d+) pok[ée]mon, reveal them, and put them into your hand\.?$/i,
  );
  if (match) {
    return [{ kind: "search_pokemon_to_hand", count: parseInt(match[1]!, 10) }];
  }

  match = clause.match(
    /^this attack does (\d+) damage to 1 of your opponent's pok[ée]mon(?:\. \(don't apply weakness and resistance(?: for benched pok[ée]mon)?\.?\))?.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_choose_opponent",
        amount: parseInt(match[1]!, 10),
        applyWeaknessRes: !/don't apply weakness and resistance/.test(clause),
      },
    ];
  }

  match = clause.match(/^this attack does (\d+) damage to 2 of your opponent's pok[ée]mon(?:\. this attack's damage isn't affected by weakness or resistance, or by any effects on those pokémon)?\.?$/i);
  if (match) {
    return [{ kind: "damage_two_opponent", amount: parseInt(match[1]!, 10) }];
  }

  if (
    /^during your opponent's next turn, prevent all damage done to this pok[ée]mon by attacks from basic pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "prevent_damage_next_turn", filter: "basic" }];
  }

  if (/^put this pok[ée]mon and all attached cards into your hand\.?$/i.test(clause)) {
    return [{ kind: "return_self_to_hand" }];
  }

  if (/^choose 1 of your opponent's active pok[ée]mon's attacks\.?$/i.test(clause)) {
    return [{ kind: "disable_opponent_attack_next_turn" }];
  }

  if (/^during your opponent's next turn, that pok[ée]mon can't use that attack\.?$/i.test(clause)) {
    return [];
  }

  if (
    /^when you play this pok[ée]mon from your hand onto your bench during your turn, you may switch it with your active pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "on_bench_play_switch_and_move_energy" }];
  }

  if (/^switch your active pok[ée]mon with 1 of your benched pok[ée]mon\.?$/i.test(clause)) {
    return [{ kind: "switch_with_bench" }];
  }

  if (/^your opponent discards a card from their hand\.?$/i.test(clause)) {
    return [{ kind: "opponent_discard_from_hand" }];
  }

  if (/^if you go first, you can use this attack during your first turn\.?$/i.test(clause)) {
    return [{ kind: "allow_attack_first_turn_if_go_first" }];
  }

  if (/^if you use this ability, this pok[ée]mon is knocked out\.?$/i.test(clause)) {
    return [{ kind: "knock_out_self_on_ability_use" }];
  }

  if (/^if this pok[ée]mon is in the active spot, you may shuffle it and all attached cards into your deck\.?$/i.test(clause)) {
    return [{ kind: "ability_only_while_active" }, { kind: "shuffle_self_active_to_deck" }];
  }

  if (/^if this pok[ée]mon is in the active spot, you may use this ability\.?$/i.test(clause)) {
    return [{ kind: "ability_only_while_active" }];
  }

  if (
    /^when you play this pok[ée]mon from your hand to evolve 1 of your pok[ée]mon, you may use this ability\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "evolve_trigger_ability" }];
  }

  match = clause.match(/^you can't use more than 1 (.+?) ability (?:each|during your) turn\.?$/i);
  if (match) {
    return [{ kind: "ability_use_limit_per_turn", namePattern: match[1]!.trim() }];
  }

  match = clause.match(
    /^search your deck for up to (\d+) colorless pok[ée]mon with (\d+) hp or less, reveal them, and put them into your hand\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "search_typed_pokemon_max_hp_to_hand",
        count: parseInt(match[1]!, 10),
        typeFilter: "Colorless",
        maxHp: parseInt(match[2]!, 10),
      },
    ];
  }

  match = clause.match(
    /^search your deck for any number of pok[ée]mon that have "([^"]+)" in their name and put them onto your bench\.?$/i,
  );
  if (match) {
    return [{ kind: "search_named_pokemon_to_bench", nameFilter: match[1]!.trim() }];
  }

  if (
    /^if this pok[ée]mon is in the active spot and is damaged by an attack from your opponent's pok[ée]mon \(even if this pok[ée]mon is knocked out\), the attacking pok[ée]mon is now poisoned\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "poison_attacker_when_damaged_from_opponent" }];
  }

  if (
    /^prevent all damage from attacks done to this pok[ée]mon by your opponent's pok[ée]mon that have an ability\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "prevent_damage_from_ability_pokemon" }];
  }

  match = clause.match(
    /^switch 1 of your benched (.+?) pok[ée]mon, except any (.+?), with your active pok[ée]mon\.?$/i,
  );
  if (match) {
    const rawFilter = match[1]!.trim().toLowerCase();
    const excludeName = titleCase(match[2]!.trim()).replace(/\bEx\b/g, "ex");
    if (ENERGY_TYPES.has(rawFilter)) {
      return [
        {
          kind: "switch_bench_typed_to_active",
          typeFilter: cap(rawFilter),
          excludeName,
        },
      ];
    }
    return [
      {
        kind: "switch_bench_named_to_active",
        nameFilter: nameFilter(match[1]!),
        excludeName,
      },
    ];
  }

  match = clause.match(
    /^attach up to (\d+) basic (\w+) energy cards from your discard pile to your benched pok[ée]mon in any way you like\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "attach_energy_from_discard",
        energyType: cap(match[2]!),
        count: parseInt(match[1]!, 10),
        target: "benched",
      },
    ];
  }

  match = clause.match(
    /^attach up to (\d+) basic (\w+) energy cards from your hand to 1 of your benched (.+) pok[ée]mon\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "attach_hand_energy_to_benched",
        energyType: cap(match[2]!),
        count: parseInt(match[1]!, 10),
        nameFilter: nameFilter(match[3]!),
      },
    ];
  }

  if (
    /^for each of your benched pok[ée]mon, search your deck for a basic (\w+) energy card and attach it to that pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    const typeMatch = clause.match(/basic (\w+) energy/);
    return [{ kind: "search_attach_energy_each_bench", energyType: cap(typeMatch?.[1] ?? "Psychic") }];
  }

  if (/^discard a special energy from your opponent's active pok[ée]mon\.?$/i.test(clause)) {
    return [{ kind: "discard_special_energy_opponent" }];
  }

  if (/^search your deck for an item card, reveal it, and put it into your hand\.?$/i.test(clause)) {
    return [{ kind: "search_item_to_hand" }];
  }

  if (
    /^you may move an energy from your opponent's active pok[ée]mon to 1 of their benched pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "move_opponent_energy_to_bench" }];
  }

  if (/^choose 1 of your opponent's active pok[ée]mon's attacks and use it as this attack\.?$/i.test(clause)) {
    return [{ kind: "copy_opponent_active_attack" }];
  }

  match = clause.match(/^this attack does (\d+) damage to 1 of your opponent's benched pok[ée]mon\.?$/i);
  if (match) {
    return [
      {
        kind: "damage",
        amount: parseInt(match[1]!, 10),
        target: "opponent_bench_choose",
        applyWeaknessRes: true,
      },
    ];
  }

  match = clause.match(
    /^your opponent's active pok[ée]mon is now poisoned\. during your opponent's next turn, that pok[ée]mon can't attack\.?$/i,
  );
  if (match) {
    return [
      { kind: "status", status: "Poisoned", target: "opponent_active" },
      { kind: "cant_attack_defending_next_turn" },
    ];
  }

  if (/^if heads, prevent that damage\.?$/i.test(clause)) {
    return [{ kind: "prevent_damage_next_turn", filter: "coin_heads" }];
  }

  if (/^if any damage is done to this pok[ée]mon by attacks, flip a coin\.?$/i.test(clause)) {
    return [{ kind: "if_damaged_flip_coin" }];
  }

  const dualStatus = parseDualOpponentStatus(clause);
  if (dualStatus) return dualStatus;

  if (/^if tails, that attack doesn't happen\.?$/i.test(clause)) {
    return [];
  }

  match = clause.match(
    /^during your opponent's next turn, if the defending pok[ée]mon tries to use an attack, your opponent flips a coin\.?$/i,
  );
  if (match) {
    return [{ kind: "coin_flip_attack_fails_on_tails_defending" }];
  }

  if (/^if there is no stadium in play, this attack does nothing\.?$/i.test(clause)) {
    return [{ kind: "requires_stadium_in_play" }];
  }

  if (
    /^you may attach any number of basic energy cards from your hand to your pok[ée]mon in any way you like\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "attach_unlimited_basic_energy_from_hand" }];
  }

  match = clause.match(/^your opponent discards (\d+) cards? from their hand\.?$/i);
  if (match) {
    return [{ kind: "opponent_discard_from_hand", count: parseInt(match[1]!, 10) }];
  }

  if (/^you may discard a stadium in play\.?$/i.test(clause)) {
    return [{ kind: "discard_stadium", optional: true }];
  }

  if (/^shuffle your hand into your deck\.?$/i.test(clause)) {
    return [{ kind: "shuffle_hand_into_deck" }];
  }

  match = clause.match(/^place (\d+) damage counters on 1 of your opponent's pok[ée]mon\.?$/i);
  if (match) {
    return [
      {
        kind: "damage",
        amount: parseInt(match[1]!, 10) * 10,
        target: "opponent_pokemon_choose",
        applyWeaknessRes: false,
      },
    ];
  }

  if (/^during your opponent's next turn, the defending pok[ée]mon can't attack\.?$/i.test(clause)) {
    return [{ kind: "cant_attack_defending_next_turn" }];
  }

  match = clause.match(
    /^this attack does (\d+) (more )?damage for each of your pok[ée]mon in play\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "damage_per_all_in_play",
        perPokemon: parseInt(match[1]!, 10),
        bonusOnly: !!match[2],
      },
    ];
  }

  match = clause.match(
    /^you must discard a basic (\w+) energy from this pok[ée]mon in order to use this ability\.?$/i,
  );
  if (match) {
    return [{ kind: "require_discard_energy_to_use_ability", energyType: cap(match[1]!) }];
  }

  if (
    /^whenever your opponent plays an item or supporter card from their hand, prevent all effects of that card done to this pok[ée]mon\.?$/i.test(
      clause,
    )
  ) {
    return [{ kind: "prevent_item_supporter_effects_on_self" }];
  }

  if (/^if this pok[ée]mon has no energy attached, it has no retreat cost\.?$/i.test(clause)) {
    return [{ kind: "no_retreat_cost_if_no_energy" }];
  }

  match = clause.match(/^discard the top card of your deck\.?$/i);
  if (match) {
    return [{ kind: "mill_self_deck", count: 1 }];
  }

  if (/^you may search your deck for a card and put it into your hand\.?$/i.test(clause)) {
    return [{ kind: "search_any_to_hand" }];
  }

  match = clause.match(
    /^put up to (\d+) (\w+) pok[ée]mon from your discard pile onto your bench\.?$/i,
  );
  if (match) {
    return [
      {
        kind: "recover_pokemon_from_discard",
        count: parseInt(match[1]!, 10),
        nameFilter: match[2]!,
        target: "bench",
      },
    ];
  }

  match = clause.match(/^search your deck for up to (\d+) basic (\w+) energy cards and attach them to this pok[ée]mon\.?$/i);
  if (match) {
    return [
      {
        kind: "search_attach_energy_to_self",
        count: parseInt(match[1]!, 10),
        energyType: cap(match[2]!),
      },
    ];
  }

  if (/^choose 2 of your opponent's benched pok[ée]mon\.?$/i.test(clause)) {
    return [{ kind: "choose_two_opponent_bench" }];
  }

  return null;
}

function parseDualOpponentStatus(clause: string): ParsedEffect[] | null {
  const match = clause.match(/^your opponent's active pok[ée]mon is now (\w+) and (\w+)\.?$/i);
  if (!match) return null;
  return [
    { kind: "status", status: cap(match[1]!), target: "opponent_active" },
    { kind: "status", status: cap(match[2]!), target: "opponent_active" },
  ];
}
