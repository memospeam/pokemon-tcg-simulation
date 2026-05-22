import type { ParsedEffect } from "./types";

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Last-resort patterns for long-tail effect text before marking unknown. */
export function matchFallbackClause(clause: string): ParsedEffect[] | null {
  let match: RegExpMatchArray | null;

  if (/^\(.+\)\.?$/i.test(clause)) return [];

  if (/each of your opponent'?s active pok[ée]mon has no abilities/i.test(clause)) {
    return [{ kind: "disable_opponent_active_abilities" }];
  }

  match = clause.match(/^this attack does (\d+) more damage(?:\.|$)/i);
  if (match) return [{ kind: "optional_damage_bonus", amount: parseInt(match[1]!, 10) }];

  match = clause.match(/^this attack does (\d+) damage for each (.+?)\.?$/i);
  if (match) {
    return [{ kind: "damage_per_named_in_play", perPokemon: parseInt(match[1]!, 10), nameFilter: match[2]!.trim() }];
  }

  match = clause.match(/^this attack does (\d+) more damage for each (.+?)\.?$/i);
  if (match) {
    return [{ kind: "damage_per_named_in_play", perPokemon: parseInt(match[1]!, 10), nameFilter: match[2]!.trim() }];
  }

  if (/^when you play this pok[ée]mon from your hand to evolve/i.test(clause)) {
    return [{ kind: "evolve_trigger_ability" }];
  }

  if (/^when you play this pok[ée]mon from your hand onto your bench/i.test(clause)) {
    if (/search your deck for a supporter/i.test(clause) || /you may use this ability/i.test(clause)) {
      return [{ kind: "on_bench_play_trigger" }];
    }
    return [{ kind: "on_bench_play_switch_and_move_energy" }];
  }

  if (/^as long as this pok[ée]mon/i.test(clause)) {
    if (/prevent all damage/i.test(clause)) return [{ kind: "prevent_damage_on_bench" }];
    if (/no abilities/i.test(clause)) return [{ kind: "disable_opponent_active_abilities" }];
    if (/can't play/i.test(clause)) return [{ kind: "block_opponent_items_and_tools_while_active" }];
    return [{ kind: "prevent_attack_effects_on_self" }];
  }

  if (/^prevent all/i.test(clause)) {
    if (/tera/i.test(clause)) return [{ kind: "prevent_damage_from_tera_on_self" }];
    if (/ex/i.test(clause)) return [{ kind: "prevent_damage_from_ex_on_self" }];
    if (/ability/i.test(clause)) return [{ kind: "prevent_opponent_ability_effects_on_self" }];
    return [{ kind: "prevent_attack_effects_on_self" }];
  }

  if (/^if this pok[ée]mon is in the active spot/i.test(clause)) {
    if (/damaged by an attack/i.test(clause)) return [{ kind: "retaliate_damage_counters", counters: 1 }];
    if (/you may draw a card/i.test(clause)) {
      return [
        { kind: "ability_only_while_active" },
        { kind: "draw", count: 1, target: "self" },
      ];
    }
    return [{ kind: "ability_only_while_active" }];
  }

  match = clause.match(/^search your deck for up to (\d+) (.+?), reveal them, and put them into your hand\.?$/i);
  if (match) {
    const target = match[2]!.toLowerCase();
    if (target.includes("energy")) return [{ kind: "search_basic_energy_to_hand", count: parseInt(match[1]!, 10) }];
    if (target.includes("pokémon") || target.includes("pokemon"))
      return [{ kind: "search_pokemon_to_hand", count: parseInt(match[1]!, 10) }];
    return [{ kind: "search_any_to_hand", count: parseInt(match[1]!, 10) }];
  }

  if (/^search your deck for/i.test(clause)) {
    return [{ kind: "search_any_to_hand" }];
  }

  match = clause.match(/^attach up to (\d+) basic (\w+) energy/i);
  if (match) {
    return [{
      kind: "attach_energy_from_discard",
      count: parseInt(match[1]!, 10),
      energyType: cap(match[2]!),
      target: "benched",
    }];
  }

  if (/^attach a basic (\w+) energy/i.test(clause)) {
    const typeMatch = clause.match(/basic (\w+) energy/);
    return [{
      kind: "attach_energy_from_discard",
      count: 1,
      energyType: cap(typeMatch?.[1] ?? "Any"),
      target: clause.includes("benched") ? "benched" : "self",
    }];
  }

  match = clause.match(/^heal (\d+) damage from/i);
  if (match) {
    const amount = parseInt(match[1]!, 10);
    if (/each of your/i.test(clause)) return [{ kind: "heal", amount, target: "all_yours" }];
    if (/this pokémon/i.test(clause)) return [{ kind: "heal", amount, target: "self_active" }];
    return [{ kind: "heal", amount, target: "your_pokemon_choose" }];
  }

  match = clause.match(/^put (\d+) damage counters on/i);
  if (match) {
    return [{
      kind: "damage",
      amount: parseInt(match[1]!, 10) * 10,
      target: "opponent_bench_choose",
      applyWeaknessRes: false,
    }];
  }

  match = clause.match(/^place (\d+) damage counters on/i);
  if (match) {
    return [{
      kind: "damage",
      amount: parseInt(match[1]!, 10) * 10,
      target: "opponent_bench_choose",
      applyWeaknessRes: false,
    }];
  }

  if (/^during your opponent's next turn/i.test(clause)) {
    if (/can't retreat/i.test(clause)) return [{ kind: "cant_retreat_defending_next_turn" }];
    if (/can't attack/i.test(clause)) return [{ kind: "cant_attack_defending_next_turn" }];
    if (/prevent all damage/i.test(clause)) return [{ kind: "prevent_damage_effects_next_opponent_turn" }];
    return [{ kind: "defending_attack_damage_reduction", amount: 20 }];
  }

  if (/^during your next turn/i.test(clause)) {
    if (/can't retreat/i.test(clause)) return [{ kind: "cant_retreat_self_next_turn" }];
    if (/can't use/i.test(clause)) return [{ kind: "cant_attack_next_owner_turn" }];
  }

  if (/^discard up to (\d+)/i.test(clause)) {
    if (/energy/i.test(clause)) return [{ kind: "discard_hand_energy_optional", max: 3 }];
    return [{ kind: "mill_self_deck", count: 1 }];
  }

  if (/^discard (\d+)/i.test(clause) && /energy/i.test(clause)) {
    const countMatch = clause.match(/discard (\d+)/);
    return [{ kind: "discard_energy", count: parseInt(countMatch?.[1] ?? "1", 10), from: "self_active" }];
  }

  if (/^shuffle/i.test(clause)) {
    if (/hand into your deck/i.test(clause)) return [{ kind: "shuffle_hand_into_deck" }];
    return [{ kind: "shuffle_self_bench_to_deck" }];
  }

  if (/^look at the top (\d+) cards/i.test(clause)) {
    const countMatch = clause.match(/top (\d+)/);
    return [{ kind: "reveal_deck_top", count: parseInt(countMatch?.[1] ?? "5", 10) }];
  }

  if (/^flip a coin/i.test(clause)) {
    if (/does nothing/i.test(clause)) return [{ kind: "coin_attack_fails_on_tails" }];
    return [{ kind: "coin_damage_bonus", amount: 20 }];
  }

  if (/^your opponent's active pok[ée]mon is now/i.test(clause)) return null;

  if (/^if heads/i.test(clause) || /^if tails/i.test(clause)) return [];

  if (/^if you do/i.test(clause)) return [];

  if (/^you may/i.test(clause)) return [{ kind: "optional_damage_bonus", amount: 0 }];

  if (/^this pok[ée]mon can't/i.test(clause)) {
    return [{ kind: "cant_attack_next_owner_turn" }];
  }

  if (/^all of your pok[ée]mon/i.test(clause)) {
    return [{ kind: "basic_pokemon_no_retreat" }];
  }

  if (/^each of your pok[ée]mon/i.test(clause)) {
    return [{ kind: "team_damage_bonus_to_opponent_active", amount: 20 }];
  }

  if (/^attacks used by your pok[ée]mon/i.test(clause)) {
    return [{ kind: "team_damage_bonus_to_opponent_active", amount: 20 }];
  }

  if (/^if this pok[ée]mon/i.test(clause)) {
    if (/knocked out/i.test(clause)) return [{ kind: "reduce_prize_when_named_ko_by_ex", nameFilter: "Pokémon" }];
    if (/would be knocked out/i.test(clause)) return [{ kind: "survive_ko_coin" }];
    if (/damage counters/i.test(clause)) return [{ kind: "damage_bonus_if_self_damaged", amount: 20 }];
    return [{ kind: "ability_only_while_active" }];
  }

  if (/^if your opponent/i.test(clause)) {
    if (/does nothing/i.test(clause)) return [{ kind: "attack_fails_if_hand_count_mismatch" }];
    return [{ kind: "damage_bonus_if_opponent_damaged", amount: 20 }];
  }

  if (/^move/i.test(clause) && /energy/i.test(clause)) {
    return [{ kind: "move_energy_to_bench" }];
  }

  if (/^switch/i.test(clause)) {
    return [{ kind: "switch_with_bench" }];
  }

  return null;
}
