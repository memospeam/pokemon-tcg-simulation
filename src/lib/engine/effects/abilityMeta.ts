import type { ParsedAbility, ParsedEffect } from "./types";

/** Parsed effect kinds that gate ability use rather than executing on USE_ABILITY. */
export const ABILITY_CONDITION_KINDS = new Set<ParsedEffect["kind"]>([
  "ability_only_while_active",
  "evolve_trigger_ability",
  "ability_use_limit_per_turn",
  "apply_status_to_new_active",
  "once_during_first_turn",
  "cant_use_ability_first_turn",
  "require_bottom_deck_hand_for_ability",
  "require_discard_named_for_ability",
  "require_discard_hand_count_for_ability",
  "require_hand_energy_in_active",
  "require_discard_energy_to_use_ability",
  "require_discard_hand_for_ability",
  "require_hand_energy_if_name",
]);

/** Effects handled by lifecycle hooks (bench play, evolve, checkup, damage, etc.). */
export const ABILITY_TRIGGER_KINDS = new Set<ParsedEffect["kind"]>([
  "on_bench_play_switch_and_move_energy",
  "on_bench_play_trigger",
  "counter_on_opponent_switch",
  "counter_on_opponent_evolve",
  "burn_on_opponent_switch",
  "trigger_on_retreat_to_bench",
  "mill_when_discarded_from_deck",
  "return_energy_on_ko_water",
  "poison_on_attach_energy",
  "counter_on_opponent_energy_attach",
  "coin_on_opponent_retreat",
  "shuffle_self_if_switched_on_retreat",
  "switch_to_named_on_retreat",
]);

/** Passive effects applied via hooks, modifiers, or passiveRules — not USE_ABILITY. */
export const ABILITY_PASSIVE_KINDS = new Set<ParsedEffect["kind"]>([
  "prevent_attack_effects_on_self",
  "reduce_prize_when_named_ko_by_ex",
  "basic_pokemon_no_retreat",
  "team_typed_damage_bonus",
  "block_opponent_items_and_tools_while_active",
  "block_opponent_ace_spec_when_tool_attached",
  "damage_reduction_passive",
  "prevent_damage_next_turn",
  "disable_opponent_active_abilities",
  "prevent_damage_from_ex_on_self",
  "team_damage_bonus_to_opponent_active",
  "can_evolve_if_name_in_play",
  "survive_ko_full_hp",
  "survive_ko_coin",
  "survive_ko_coin_heads_hp",
  "festival_grounds_double_attack",
  "attack_cost_reduction_per_opponent_prize",
  "override_opponent_dragon_weakness",
  "ignore_opponent_active_modifiers",
  "future_pokemon_active_damage_bonus",
  "cant_attack_unless_name_count_in_play",
  "poison_attacker_when_damaged_from_opponent",
  "prevent_damage_from_ability_pokemon",
  "prevent_item_supporter_effects_on_self",
  "no_retreat_cost_if_no_energy",
  "can_evolve_first_turn_while_active",
  "prevent_damage_on_bench",
  "disable_rule_box_abilities_except_future",
  "darkness_energy_boost",
  "burn_attacker_when_damaged_from_opponent",
  "no_retreat_if_typed_energy",
  "prevent_damage_from_tera_on_self",
  "coin_flip_on_opponent_ko",
  "bonus_prize_on_ko_basic",
  "bonus_prize_on_coin_heads",
  "allow_extra_tools",
  "discard_extra_tools_when_ability_lost",
  "disable_self_ko_abilities",
  "prevent_opponent_ability_effects_on_self",
  "damage_reduction_passive_typed",
  "attack_cost_reduction_per_opponent_bench",
  "evolved_can_use_previous_attacks",
  "hp_bonus_per_typed_energy",
  "hp_bonus_per_opponent_prize",
  "self_hand_equal_damage_bonus",
  "self_conditional_attack_bonus",
  "self_attack_bonus_per_opponent_prize",
  "damage_bonus_vs_ability_active",
  "burn_checkup_extra",
  "ignore_energy_cost_if_hand_equal",
  "checkup_counters_on_opponent_basic",
  "checkup_counter_on_ability_pokemon",
  "poison_enhanced_checkup",
  "grass_energy_provides_double",
  "reduce_damage_vs_tool_active",
  "cant_move_counters",
  "cant_return_to_hand",
  "opponent_retreat_cost_increase",
  "allow_attack_first_turn_if_go_first",
  "damage_bonus_if_self_damaged",
  "retaliate_damage_counters",
  "if_damaged_flip_coin",
  "damage_bonus_if_opponent_damaged",
  "optional_damage_bonus",
  "coin_damage_bonus",
]);

export function getExecutableAbilityEffects(effects: ParsedEffect[]): ParsedEffect[] {
  return effects.filter(
    (effect) =>
      effect.kind !== "unknown" &&
      effect.kind !== "generic_effect_stub" &&
      !ABILITY_CONDITION_KINDS.has(effect.kind) &&
      !ABILITY_PASSIVE_KINDS.has(effect.kind) &&
      !ABILITY_TRIGGER_KINDS.has(effect.kind) &&
      effect.kind !== "knock_out_self_on_ability_use",
  );
}

export function hasActivatableAbility(parsed: ParsedAbility): boolean {
  if (parsed.frequency === "passive") return false;
  return getExecutableAbilityEffects(parsed.effects).length > 0;
}

export function abilityRequiresKnockOutSelf(effects: ParsedEffect[]): boolean {
  return effects.some((effect) => effect.kind === "knock_out_self_on_ability_use");
}
