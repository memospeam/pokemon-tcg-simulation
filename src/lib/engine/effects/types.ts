import type { CardInstance } from "../../models/instance";
import type { PlayerId } from "../../models/enums";

/** One damage counter in TCG text = 10 damage in our engine. */
export function countersToDamage(counters: number): number {
  return counters * 10;
}

export type EffectTarget =
  | "opponent_active"
  | "opponent_bench_each"
  | "opponent_bench_choose"
  | "opponent_bench_distribute"
  | "self"
  | "your_pokemon"
  | "your_pokemon_other";

export type ParsedEffect =
  | { kind: "damage"; amount: number; target: EffectTarget; applyWeaknessRes: boolean }
  | { kind: "distribute_bench_counters"; counters: number }
  | { kind: "draw"; count: number; target: "self" }
  | { kind: "status"; status: string; target: "opponent_active" | "self_active" }
  | {
      kind: "move_damage";
      maxCounters: number;
      from: "your_pokemon";
      to: "opponent_pokemon" | "your_pokemon";
    }
  | { kind: "discard_energy"; count: number; from: "opponent_active" | "self_active" }
  | { kind: "discard_all_energy"; from: "self_active" }
  | { kind: "self_recoil"; amount: number }
  | { kind: "heal"; amount: number; target: "self_active" | "your_pokemon_choose" | "all_yours" | "all_in_play" }
  | { kind: "block_opponent_items_next_turn" }
  | { kind: "recon_directive" }
  | { kind: "cant_attack_next_owner_turn" }
  | { kind: "cant_retreat_defending_next_turn" }
  | { kind: "damage_reduction_next_opponent_turn"; amount: number }
  | { kind: "prevent_damage_effects_next_opponent_turn" }
  | { kind: "switch_opponent_active_to_bench" }
  | { kind: "switch_with_bench" }
  | { kind: "search_basic_to_bench"; count: number }
  | { kind: "move_energy_to_bench"; count?: number }
  | { kind: "draw_until_hand"; targetCount: number; optional: boolean }
  | { kind: "discard_random_opponent_hand"; count: number }
  | { kind: "damage_reduction_passive"; amount: number }
  | { kind: "cant_attack_defending_next_turn" }
  | { kind: "coin_multi_damage"; perHeads: number; coinCount: number; bonusOnly: boolean }
  | { kind: "damage_per_self_counter"; perCounter: number }
  | { kind: "mill_opponent_deck"; count: number }
  | { kind: "discard_opponent_tools"; max?: number }
  | { kind: "coin_attack_fails_on_tails" }
  | { kind: "coin_damage_bonus"; amount: number }
  | { kind: "coin_flip"; heads: ParsedEffect[]; tails: ParsedEffect[] }
  | { kind: "damage_per_energy_both_actives"; perEnergy: number }
  | { kind: "damage_bonus_if_special_condition"; amount: number }
  | { kind: "damage_per_all_benched"; perBench: number }
  | { kind: "damage_per_own_benched"; perBench: number }
  | { kind: "damage_per_energy_on_self"; perEnergy: number }
  | { kind: "damage_per_energy_opponent_active"; perEnergy: number }
  | { kind: "damage_per_self_counter_more"; perCounter: number }
  | { kind: "blocked_if_second_player_first_turn" }
  | { kind: "prevent_damage_from_basic_non_colorless" }
  | { kind: "reveal_opponent_hand" }
  | { kind: "search_basic_energy_to_hand"; count: number }
  | { kind: "search_pokemon_to_hand"; count?: number }
  | { kind: "optional_switch_with_bench" }
  | { kind: "heal_matching_damage_dealt" }
  | { kind: "return_energy_to_hand" }
  | { kind: "damage_two_opponent"; amount: number }
  | { kind: "survive_ko_full_hp" }
  | { kind: "survive_ko_coin" }
  | { kind: "attach_basic_energy_from_hand"; energyType: string; drawOnAttach?: boolean; healOnAttach?: number; target: "self" | "your_pokemon"; nameFilter?: string }
  | { kind: "discard_basic_energy_optional" }
  | { kind: "discard_bench_energy_optional"; max: number }
  | { kind: "damage_per_discarded_basic_energy"; perCard: number }
  | { kind: "discard_named_supporters_from_hand_optional"; nameFilter: string }
  | { kind: "damage_per_discarded_hand_cards"; perCard: number }
  | { kind: "shuffle_random_opponent_hand_to_deck" }
  | { kind: "search_evolution_from_deck" }
  | { kind: "search_supporter_to_hand" }
  | { kind: "festival_grounds_double_attack" }
  | { kind: "damage_per_tools_on_your_pokemon"; perTool: number }
  | { kind: "copy_benched_attack"; nameFilter: string }
  | { kind: "attack_cost_reduction_per_opponent_prize"; attackName: string; energyType: string; perPrize: number }
  | { kind: "override_opponent_dragon_weakness"; weaknessType: string }
  | { kind: "ignore_opponent_active_modifiers" }
  | { kind: "future_pokemon_active_damage_bonus"; amount: number; excludeName?: string }
  | { kind: "cant_attack_unless_name_count_in_play"; nameFilter: string; minCount: number }
  | { kind: "discard_stadium"; optional?: boolean }
  | { kind: "damage_bonus_per_opponent_prize"; perPrize: number; bonusOnly: boolean }
  | {
      kind: "damage_per_typed_energy";
      energyType: string;
      perEnergy: number;
      scope: "self" | "all_yours";
      bonusOnly: boolean;
    }
  | { kind: "damage_per_opponent_active_counter"; perCounter: number; bonusOnly: boolean }
  | { kind: "damage_per_opponent_benched"; perBench: number; bonusOnly: boolean }
  | { kind: "damage_less_per_self_counter"; perCounter: number }
  | { kind: "cant_reuse_attack_until_leave_active"; attackName: string }
  | { kind: "cant_use_named_attack_next_turn"; attackName: string }
  | { kind: "retaliate_damage_counters"; counters: number }
  | { kind: "prevent_damage_next_turn"; filter: "basic" | "all" | "coin_heads" }
  | { kind: "damage_bonus_if_opponent_tag"; tag: "ex" | "evolution"; amount: number }
  | { kind: "shuffle_attached_energy_to_deck"; count: number }
  | { kind: "defending_attack_damage_reduction"; amount: number }
  | { kind: "damage_choose_opponent"; amount: number; applyWeaknessRes: boolean }
  | { kind: "return_self_to_hand" }
  | { kind: "disable_opponent_attack_next_turn" }
  | { kind: "opponent_discard_from_hand"; count?: number }
  | { kind: "on_bench_play_switch_and_move_energy" }
  | { kind: "on_bench_play_trigger" }
  | { kind: "allow_attack_first_turn_if_go_first" }
  | { kind: "knock_out_self_on_ability_use" }
  | { kind: "ability_only_while_active" }
  | { kind: "evolve_trigger_ability" }
  | { kind: "ability_use_limit_per_turn"; namePattern: string }
  | { kind: "once_during_first_turn" }
  | { kind: "search_typed_pokemon_max_hp_to_hand"; count: number; typeFilter: string; maxHp: number }
  | { kind: "search_named_pokemon_to_bench"; nameFilter: string }
  | { kind: "poison_attacker_when_damaged_from_opponent" }
  | { kind: "prevent_damage_from_ability_pokemon" }
  | {
      kind: "switch_bench_named_to_active";
      nameFilter: string;
      excludeName?: string;
      applyStatus?: string;
    }
  | {
      kind: "switch_bench_typed_to_active";
      typeFilter: string;
      excludeName?: string;
      applyStatus?: string;
    }
  | { kind: "apply_status_to_new_active"; status: string }
  | {
      kind: "attach_energy_from_discard";
      energyType: string;
      count: number;
      target: "benched" | "benched_named" | "self" | "any_yours";
      nameFilter?: string;
    }
  | {
      kind: "attach_hand_energy_to_benched";
      energyType: string;
      count: number;
      nameFilter?: string;
    }
  | { kind: "search_attach_energy_each_bench"; energyType: string }
  | { kind: "discard_special_energy_opponent" }
  | { kind: "search_item_to_hand" }
  | { kind: "move_opponent_energy_to_bench" }
  | { kind: "copy_opponent_active_attack" }
  | { kind: "if_damaged_flip_coin" }
  | { kind: "coin_flip_attack_fails_on_tails_defending" }
  | { kind: "requires_stadium_in_play" }
  | { kind: "attach_unlimited_basic_energy_from_hand" }
  | { kind: "shuffle_hand_into_deck" }
  | { kind: "damage_per_all_in_play"; perPokemon: number; bonusOnly: boolean }
  | { kind: "require_discard_energy_to_use_ability"; energyType: string }
  | { kind: "prevent_item_supporter_effects_on_self" }
  | { kind: "no_retreat_cost_if_no_energy" }
  | { kind: "mill_self_deck"; count: number }
  | { kind: "search_any_to_hand"; count?: number }
  | {
      kind: "recover_pokemon_from_discard";
      count: number;
      nameFilter: string;
      target?: "bench" | "hand";
    }
  | { kind: "search_attach_energy_to_self"; count: number; energyType: string }
  | { kind: "choose_two_opponent_bench" }
  | { kind: "coin_flip_ko_basic" }
  | { kind: "damage_per_named_attack_in_play"; perPokemon: number; attackName: string; bonusOnly: boolean }
  | { kind: "damage_bonus_if_moved_from_bench"; amount: number }
  | { kind: "discard_typed_energy_optional"; energyType: string }
  | { kind: "return_typed_energy_to_hand"; energyType: string }
  | { kind: "attack_cost_reduction_per_discard_name"; energyType: string; nameFilter: string; perCard: number }
  | { kind: "evolve_place_counters_on_two_opponent"; counters: number }
  | { kind: "reduce_prize_when_named_ko_by_ex"; nameFilter: string }
  | { kind: "require_hand_energy_in_active"; energyType: string }
  | { kind: "damage_per_energy_in_opponent_discard"; perEnergy: number; bonusOnly: boolean }
  | { kind: "recover_supporter_from_discard" }
  | { kind: "damage_bonus_if_self_poisoned"; amount: number }
  | { kind: "switch_with_bench_typed"; typeFilter: string }
  | { kind: "delayed_counters_on_defender"; counters: number }
  | { kind: "move_energy_from_yours_to_self" }
  | { kind: "look_deck_attach_energy"; count: number }
  | { kind: "damage_per_typed_energy_in_discard"; counters: number; energyType: string }
  | { kind: "evolve_each_bench_from_deck" }
  | { kind: "shuffle_opponent_pokemon_to_deck" }
  | { kind: "no_weakness_next_opponent_turn" }
  | { kind: "opponent_choose_shuffle_hand"; count: number }
  | { kind: "damage_per_named_in_play"; perPokemon: number; nameFilter: string }
  | { kind: "discard_named_energy"; nameFilter: string }
  | { kind: "discard_opponent_active" }
  | { kind: "discard_typed_energy_up_to"; max: number; energyType: string }
  | { kind: "reorder_opponent_deck_top"; count: number }
  | { kind: "damage_bonus_if_opponent_stage"; stage: number; amount: number }
  | { kind: "damage_bonus_if_opponent_damaged"; amount: number }
  | { kind: "poison_enhanced_checkup"; counters: number }
  | { kind: "damage_bonus_if_self_undamaged"; amount: number }
  | { kind: "search_attach_energy_any"; count: number }
  | { kind: "search_attach_energy_typed"; count: number; energyType: string; target: "benched" | "your_pokemon" }
  | { kind: "damage_per_trainer_in_revealed"; perCard: number }
  | { kind: "attack_fails_if_bench_at_most"; maxBench: number }
  | { kind: "named_attack_bonus_next_turn"; attackName: string; amount: number }
  | { kind: "damage_bonus_if_extra_energy"; minExtra: number; amount: number }
  | { kind: "ko_if_exact_counters_on_opponent"; counters: number }
  | { kind: "reveal_and_discard_opponent_hand" }
  | { kind: "damage_bonus_if_self_damaged"; amount: number }
  | { kind: "damage_per_opponent_hand_size"; perCard: number }
  | { kind: "damage_bonus_if_stadium"; amount: number }
  | { kind: "discard_hand_energy_for_damage"; max: number; perCard: number }
  | { kind: "discard_special_energy_opponent_all" }
  | { kind: "blocked_if_go_second_first_turn_only" }
  | { kind: "cant_retreat_self_next_turn" }
  | { kind: "coin_multi_discard_energy"; perHeads: number }
  | { kind: "optional_damage_bonus"; amount: number }
  | { kind: "shuffle_revealed_to_deck" }
  | { kind: "cant_use_if_named_attack_last_turn"; attackName: string }
  | { kind: "damage_per_benched_named_counters"; perCounter: number; nameFilter: string }
  | { kind: "require_discard_hand_for_ability" }
  | { kind: "search_stadium_to_hand" }
  | { kind: "can_evolve_first_turn_while_active" }
  | { kind: "special_evolve_from_eevee" }
  | { kind: "evolve_reveal_basic_to_opponent_bench" }
  | { kind: "disable_opponent_active_abilities"; exceptName?: string }
  | { kind: "attach_dual_type_energy_from_hand"; typeA: string; typeB: string }
  | { kind: "checkup_counter_on_ability_pokemon"; exceptName?: string }
  | { kind: "look_deck_supporter_to_hand"; count: number }
  | { kind: "evolve_switch_low_hp_opponent_bench"; maxHp: number }
  | { kind: "evolve_search_trainers_if_tera"; count: number }
  | { kind: "prevent_damage_on_bench" }
  | { kind: "disable_rule_box_abilities_except_future" }
  | { kind: "darkness_energy_boost"; hpBonus: number; damageBonus: number }
  | { kind: "burn_attacker_when_damaged_from_opponent" }
  | { kind: "evolve_heal_all_evolution" }
  | { kind: "discard_energy_after_heal_evolution" }
  | { kind: "no_retreat_if_typed_energy"; energyType: string }
  | { kind: "prevent_attack_effects_on_self" }
  | { kind: "prevent_damage_from_tera_on_self" }
  | { kind: "coin_flip_on_opponent_ko" }
  | { kind: "bonus_prize_on_coin_heads" }
  | { kind: "basic_pokemon_no_retreat" }
  | { kind: "evolve_attach_energy_from_discard"; count: number; energyType: string; nameFilter: string }
  | { kind: "prevent_damage_from_ex_on_self" }
  | { kind: "team_damage_bonus_to_opponent_active"; amount: number }
  | { kind: "block_opponent_items_and_tools_while_active" }
  | { kind: "block_opponent_ace_spec_when_tool_attached" }
  | { kind: "bonus_prize_on_ko_basic" }
  | { kind: "search_evolution_typed_to_hand"; count: number; typeFilter: string }
  | { kind: "move_typed_energy_between_yours"; energyType: string }
  | { kind: "allow_extra_tools"; namePattern: string; maxTools: number }
  | { kind: "discard_extra_tools_when_ability_lost" }
  | { kind: "disable_self_ko_abilities" }
  | { kind: "survive_ko_coin_heads_hp"; hp: number }
  | { kind: "prevent_opponent_ability_effects_on_self" }
  | { kind: "coin_choose_opponent_bench" }
  | { kind: "move_counters_from_bench_to_opponent"; nameFilter: string }
  | { kind: "search_attach_energy_named"; count: number; nameFilter: string }
  | { kind: "reveal_deck_top"; count: number }
  | { kind: "damage_bonus_if_opponent_prize_at_most"; maxPrizes: number; amount: number }
  | { kind: "choose_opponent_bench"; count: number }
  | { kind: "shuffle_unchosen_opponent_bench" }
  | { kind: "damage_bonus_if_bench_type"; typeFilter: string; amount: number }
  | { kind: "attack_fails_unless_opponent_status"; status: string }
  | { kind: "discard_hand_energy_optional"; max: number }
  | { kind: "damage_bonus_if_opponent_type"; typeFilter: string; amount: number }
  | { kind: "attach_energy_each_bench"; energyType: string }
  | { kind: "damage_per_named_in_discard"; nameFilter: string; perCard: number }
  | { kind: "put_basic_opponent_bench"; count: number }
  | { kind: "return_opponent_active_energy_to_hand"; count: number }
  | { kind: "damage_per_special_energy_on_self"; perEnergy: number }
  | { kind: "damage_bonus_if_all_bench_damaged"; amount: number }
  | { kind: "delayed_ko_defender" }
  | { kind: "damage_per_opponent_typed_energy"; energyType: string; perEnergy: number }
  | { kind: "mill_both_decks"; count: number }
  | { kind: "self_attack_bonus_next_turn"; amount: number }
  | { kind: "shuffle_self_bench_to_deck" }
  | { kind: "damage_bonus_if_shared_type"; amount: number }
  | { kind: "block_opponent_supporters_next_turn" }
  | { kind: "damage_bonus_if_opponent_has_tool"; amount: number }
  | { kind: "damage_bonus_if_more_prizes"; amount: number }
  | { kind: "damage_bonus_if_ko_last_turn"; amount: number }
  | { kind: "discard_self_and_attached" }
  | { kind: "reveal_prize_card" }
  | { kind: "damage_per_opponent_status_count"; perStatus: number }
  | { kind: "search_attach_dual_energy"; countA: number; typeA: string; countB: number; typeB: string }
  | { kind: "attack_fails_if_hand_count_mismatch" }
  | { kind: "damage_until_hp_remaining"; hp: number; target: "opponent_active" | "opponent_bench_each" }
  | { kind: "search_tool_to_hand" }
  | { kind: "damage_per_energy_in_self_discard"; perEnergy: number; bonusOnly: boolean }
  | { kind: "attach_hand_energy_typed"; count: number; energyType: string }
  | { kind: "attack_fails_unless_bench_names"; names: string[] }
  | { kind: "damage_per_all_opponent_counters"; perCounter: number }
  | { kind: "defending_damage_increase_next_turn"; amount: number }
  | { kind: "counter_on_opponent_switch"; counters: number }
  | { kind: "damage_each_opponent_tag"; amount: number; tag: "ex" | "v" }
  | { kind: "devolve_each_opponent" }
  | { kind: "damage_choose_opponent_repeat"; times: number; amount: number }
  | { kind: "clear_self_special_conditions" }
  | { kind: "reveal_opponent_deck_top"; count: number }
  | { kind: "damage_bonus_if_discard_energy_at_least"; minCount: number; energyType: string; amount: number }
  | { kind: "return_bench_to_hand" }
  | { kind: "move_counters_bench_to_opponent" }
  | { kind: "damage_less_per_retreat_colorless"; perCost: number }
  | { kind: "damage_bonus_if_bench_name"; nameFilter: string; amount: number }
  | { kind: "set_named_attack_base_next_turn"; attackName: string; baseDamage: number }
  | { kind: "recover_from_discard_per_heads" }
  | { kind: "ko_lowest_hp_in_play" }
  | { kind: "damage_bonus_if_exact_prizes"; prizes: number; amount: number }
  | { kind: "damage_per_energy_in_opponent_hand"; perCard: number }
  | { kind: "damage_bonus_if_named_ko_last_turn"; nameFilter: string; amount: number }
  | { kind: "attach_discard_energy_match_opponent"; energyType: string; nameFilter: string }
  | { kind: "ko_opponent_at_hp_or_less"; maxHp: number }
  | { kind: "damage_per_revealed_from_hand"; perCard: number }
  | { kind: "team_typed_damage_bonus"; nameFilter: string; amount: number }
  | { kind: "damage_reduction_passive_typed"; nameFilter: string; typeFilter: string; amount: number }
  | { kind: "attack_cost_reduction_per_opponent_bench"; energyType: string }
  | { kind: "evolved_can_use_previous_attacks" }
  | { kind: "counter_on_opponent_energy_attach"; counters: number }
  | { kind: "shuffle_self_to_deck_if_drew" }
  | { kind: "move_counters_between_yours"; nameFilter: string }
  | { kind: "can_evolve_if_name_in_play"; nameFilter: string }
  | { kind: "hp_bonus_per_typed_energy"; perEnergy: number; energyType: string }
  | { kind: "put_basic_opponent_bench_from_hand"; maxHp: number }
  | { kind: "trigger_on_retreat_to_bench" }
  | { kind: "require_hand_energy_if_name"; nameFilter: string; energyType: string }
  | { kind: "poison_on_attach_energy"; counters: number }
  | { kind: "self_hand_equal_damage_bonus"; amount: number }
  | { kind: "damage_bonus_if_any_bench_damaged"; amount: number }
  | {
      kind: "coin_attach_energy_from_discard";
      energyType: string;
      target: "benched" | "self";
      coinCount?: number;
    }
  | { kind: "coin_multi_discard_self_energy"; perTails: number; coinCount?: number }
  | { kind: "coin_multi_discard_random_hand"; perHeads: number; coinCount?: number }
  | { kind: "damage_each_damaged_except_self"; amount: number }
  | { kind: "bonus_prize_on_defender_ko_next_turn"; count: number }
  | { kind: "damage_bonus_if_played_named_supporter"; nameFilter: string; amount: number }
  | { kind: "damage_bonus_if_energy_in_play"; minEnergy: number; amount: number }
  | { kind: "recover_energy_from_discard"; energyType: string }
  | { kind: "move_energy_to_new_bench_after_search" }
  | { kind: "self_place_counters_optional"; max: number }
  | { kind: "damage_all_benched"; amount: number }
  | { kind: "coin_both_tails_status"; status: string }
  | { kind: "require_discard_hand_energy_for_attack"; energyType: string }
  | {
      kind: "damage_bonus_if_typed_energy_in_play";
      minEnergy: number;
      energyType: string;
      amount: number;
    }
  | { kind: "attack_fails_unless_played_card"; cardName: string }
  | { kind: "damage_multi_opponent"; count: number; amount: number }
  | { kind: "before_damage_discard_opponent_tools_special" }
  | { kind: "shuffle_self_to_deck" }
  | { kind: "cant_attack_all_yours_next_turn" }
  | { kind: "special_condition_extra_counters"; counters: number }
  | { kind: "status_if_exact_prizes"; prizes: number; status: string }
  | { kind: "mill_copy_pokemon_attack" }
  | { kind: "draw_both_players"; count: number }
  | { kind: "damage_bonus_if_benched_named_damaged"; nameFilter: string; amount: number }
  | { kind: "damage_after_switch"; amount: number }
  | { kind: "before_damage_discard_self_tools" }
  | { kind: "attack_fails_if_cant_discard" }
  | { kind: "damage_bonus_if_retreat_cost"; minCost: string; amount: number }
  | { kind: "damage_bonus_if_deck_at_most"; maxCards: number; amount: number }
  | { kind: "damage_bonus_and_bench_if_deck_at_most"; maxCards: number; benchDamage: number }
  | { kind: "recover_trainer_from_discard" }
  | { kind: "devolve_opponent" }
  | { kind: "ko_both_active" }
  | { kind: "cant_attack_defending_if_basic_next_turn" }
  | { kind: "damage_bonus_if_team_attack_last_turn"; nameFilter: string; amount: number }
  | { kind: "attach_opponent_discard_energy"; count: number }
  | { kind: "coin_tier_damage"; heads: number; amount: number }
  | { kind: "override_defender_weakness_next_turn"; weaknessType: string }
  | { kind: "cant_use_unless_last_attack"; attackName: string }
  | { kind: "coin_min_heads_status"; minHeads: number; status: string }
  | { kind: "damage_bonus_if_discarded_any"; amount: number }
  | { kind: "status_if_discarded_tool"; status: string }
  | { kind: "draw_per_opponent_hand" }
  | { kind: "damage_bonus_if_bench_names"; names: string[]; amount: number }
  | { kind: "win_if_exact_prizes"; prizes: number }
  | { kind: "place_counters_on_opponent"; count: number; counters: number }
  | { kind: "bottom_deck_opponent_hand_card" }
  | { kind: "discard_all_self_energy_damage"; amount: number }
  | { kind: "dual_status_both_active"; status: string }
  | { kind: "look_opponent_prize" }
  | { kind: "mill_self_named_discard_damage"; count: number; perCard: number; nameFilter: string }
  | { kind: "before_damage_attach_hand_energy"; energyType: string }
  | { kind: "opponent_coin_each_bench" }
  | { kind: "coin_tails_damage_active"; perTails: number }
  | { kind: "damage_damaged_bench_each"; amount: number }
  | { kind: "damage_each_opponent_pokemon"; amount: number }
  | { kind: "choose_yours_typed"; count: number; typeFilter: string }
  | { kind: "delayed_discard_defender" }
  | { kind: "damage_bonus_if_hand_equal"; amount: number }
  | { kind: "mill_copy_supporter_attack" }
  | { kind: "damage_less_per_opponent_active_energy"; perEnergy: number }
  | { kind: "coin_both_heads_heal_one" }
  | { kind: "coin_both_heads_damage_bonus"; amount: number }
  | { kind: "damage_bonus_if_bench_type_stage"; typeFilter: string; stage: number; amount: number }
  | { kind: "discard_all_self_place_counters"; counters: number }
  | { kind: "coin_all_heads_ko_opponent" }
  | { kind: "double_opponent_counters" }
  | { kind: "damage_bonus_if_card_in_discard"; nameFilter: string; amount: number }
  | { kind: "mill_opponent_if_played_named"; nameFilter: string; count: number }
  | { kind: "discard_hand_until_count"; targetCount: number }
  | { kind: "each_player_attach_energy"; count: number }
  | { kind: "mill_self_typed_discard_damage"; count: number; perCard: number; energyType: string }
  | { kind: "hp_bonus_per_opponent_prize"; perPrize: number }
  | { kind: "burn_on_opponent_switch" }
  | { kind: "opponent_retreat_cost_increase"; amount: number }
  | { kind: "cant_return_to_hand" }
  | { kind: "switch_to_named_on_retreat"; nameFilter: string }
  | { kind: "shuffle_self_if_switched_on_retreat" }
  | { kind: "damage_bonus_vs_ability_active"; amount: number }
  | { kind: "draw_until_if_played_supporter"; nameFilter: string; targetCount: number }
  | { kind: "require_bottom_deck_hand_for_ability" }
  | { kind: "can_use_named_attack_if_tera"; attackName: string }
  | { kind: "require_discard_named_for_ability"; nameFilter: string }
  | { kind: "burn_checkup_extra"; extra: number }
  | { kind: "ignore_energy_cost_if_hand_equal"; attackName: string }
  | { kind: "return_energy_on_ko_water" }
  | { kind: "counter_on_opponent_evolve"; counters: number }
  | { kind: "checkup_counters_on_opponent_basic"; counters: number }
  | { kind: "require_discard_hand_count_for_ability"; count: number }
  | { kind: "grass_energy_provides_double" }
  | { kind: "self_conditional_attack_bonus"; amount: number; condition: string }
  | { kind: "self_attack_bonus_per_opponent_prize"; perPrize: number }
  | { kind: "attach_hand_energy_to_active_named"; nameFilter: string }
  | { kind: "opponent_shuffle_hand_to_deck_bottom" }
  | { kind: "evolve_from_hand_in_ability" }
  | { kind: "cant_use_ability_first_turn" }
  | { kind: "reduce_damage_vs_tool_active"; amount: number }
  | { kind: "mill_when_discarded_from_deck"; count: number }
  | { kind: "coin_on_opponent_retreat" }
  | { kind: "cant_move_counters" }
  | { kind: "trainer_shuffle_hand_draw"; baseDraw: number; sixPrizeDraw?: number }
  | { kind: "trainer_discard_hand_draw"; drawCount: number }
  | { kind: "trainer_judge" }
  | { kind: "trainer_boss_orders" }
  | { kind: "trainer_ultra_ball" }
  | { kind: "trainer_search_no_rule_box" }
  | { kind: "trainer_poffin"; maxHp: number; count: number }
  | { kind: "trainer_night_stretcher"; count: number }
  | { kind: "trainer_crushing_hammer" }
  | { kind: "trainer_enhanced_hammer" }
  | { kind: "trainer_rare_candy" }
  | { kind: "trainer_unfair_stamp" }
  | { kind: "trainer_crispin" }
  | { kind: "trainer_hilda" }
  | { kind: "trainer_pokegear" }
  | { kind: "trainer_wallys_compassion" }
  | { kind: "trainer_energy_switch" }
  | { kind: "trainer_switch_active_bench" }
  | { kind: "trainer_dawn" }
  | { kind: "trainer_ariana" }
  | { kind: "trainer_archer" }
  | { kind: "trainer_giovanni" }
  | { kind: "trainer_proton"; count: number }
  | { kind: "trainer_petrel" }
  | { kind: "trainer_cyrano"; count: number }
  | { kind: "trainer_ciphermaniac"; count: number }
  | { kind: "trainer_fighting_gong" }
  | { kind: "trainer_colress_tenacity" }
  | { kind: "trainer_ns_pp_up" }
  | { kind: "trainer_tool_scrapper"; count: number }
  | { kind: "trainer_premium_power_pro"; amount: number }
  | { kind: "trainer_black_belt_training"; amount: number }
  | { kind: "trainer_lanas_aid"; count: number }
  | { kind: "trainer_brocks_scouting" }
  | { kind: "trainer_rosas_encouragement"; count: number }
  | { kind: "trainer_briar" }
  | { kind: "trainer_surfer" }
  | { kind: "trainer_sacred_ash"; count: number }
  | { kind: "trainer_team_rocket_transceiver" }
  | { kind: "trainer_roto_stick" }
  | { kind: "trainer_miracle_headset"; count: number }
  | { kind: "trainer_secret_box" }
  | { kind: "trainer_bug_catching_set"; count: number }
  | { kind: "trainer_prime_catcher" }
  | { kind: "trainer_master_ball" }
  | { kind: "trainer_treasure_tracker"; count: number }
  | { kind: "stadium_battle_cage" }
  | { kind: "stadium_risky_ruins" }
  | { kind: "stadium_watchtower" }
  | { kind: "stadium_forest_vitality" }
  | { kind: "stadium_area_zero" }
  | { kind: "stadium_gravity_mountain"; hpReduction: number }
  | { kind: "stadium_grand_tree" }
  | { kind: "stadium_lumiose_city" }
  | { kind: "stadium_team_rocket_factory" }
  | { kind: "stadium_ns_castle" }
  | { kind: "stadium_festival_grounds" }
  | { kind: "stadium_neutralization_zone" }
  | { kind: "generic_effect_stub"; text: string }
  | { kind: "unknown"; text: string };

export const PRE_DAMAGE_ATTACK_EFFECT_KINDS = new Set<ParsedEffect["kind"]>([
  "coin_attack_fails_on_tails",
  "coin_damage_bonus",
  "coin_multi_damage",
  "damage_per_self_counter",
  "damage_per_self_counter_more",
  "damage_per_energy_both_actives",
  "damage_bonus_if_special_condition",
  "damage_per_all_benched",
  "damage_per_own_benched",
  "damage_per_energy_on_self",
  "damage_per_energy_opponent_active",
  "discard_opponent_tools",
  "blocked_if_second_player_first_turn",
  "damage_per_tools_on_your_pokemon",
  "copy_benched_attack",
  "damage_bonus_per_opponent_prize",
  "damage_per_typed_energy",
  "damage_per_opponent_active_counter",
  "damage_per_opponent_benched",
  "damage_less_per_self_counter",
  "damage_bonus_if_opponent_tag",
  "damage_per_all_in_play",
  "damage_bonus_if_moved_from_bench",
  "damage_bonus_if_self_poisoned",
  "damage_per_energy_in_opponent_discard",
  "damage_bonus_if_opponent_damaged",
  "damage_bonus_if_self_undamaged",
  "damage_bonus_if_self_damaged",
  "damage_bonus_if_stadium",
  "damage_bonus_if_extra_energy",
  "damage_bonus_if_opponent_stage",
  "damage_per_opponent_hand_size",
  "damage_per_typed_energy_in_discard",
  "damage_per_named_in_play",
  "damage_per_benched_named_counters",
  "damage_per_trainer_in_revealed",
  "discard_hand_energy_for_damage",
  "optional_damage_bonus",
  "attack_fails_if_bench_at_most",
  "requires_stadium_in_play",
  "damage_bonus_if_opponent_prize_at_most",
  "damage_bonus_if_bench_type",
  "attack_fails_unless_opponent_status",
  "damage_bonus_if_opponent_type",
  "damage_per_named_in_discard",
  "damage_per_special_energy_on_self",
  "damage_bonus_if_all_bench_damaged",
  "damage_per_opponent_typed_energy",
  "damage_bonus_if_shared_type",
  "damage_bonus_if_opponent_has_tool",
  "damage_bonus_if_more_prizes",
  "damage_bonus_if_ko_last_turn",
  "damage_per_opponent_status_count",
  "attack_fails_if_hand_count_mismatch",
  "damage_per_energy_in_self_discard",
  "attack_fails_unless_bench_names",
  "damage_per_all_opponent_counters",
  "damage_bonus_if_any_bench_damaged",
  "damage_bonus_if_played_named_supporter",
  "damage_bonus_if_energy_in_play",
  "damage_bonus_if_typed_energy_in_play",
  "attack_fails_unless_played_card",
  "damage_bonus_if_benched_named_damaged",
  "damage_bonus_if_retreat_cost",
  "damage_bonus_if_deck_at_most",
  "damage_bonus_if_team_attack_last_turn",
  "coin_tier_damage",
  "damage_bonus_if_discarded_any",
  "damage_bonus_if_bench_names",
  "damage_bonus_if_hand_equal",
  "damage_bonus_if_bench_name",
  "damage_less_per_opponent_active_energy",
  "coin_both_heads_damage_bonus",
  "damage_bonus_if_bench_type_stage",
  "damage_bonus_if_card_in_discard",
  "before_damage_discard_opponent_tools_special",
  "before_damage_discard_self_tools",
  "before_damage_attach_hand_energy",
  "attack_fails_if_cant_discard",
  "cant_use_unless_last_attack",
  "mill_self_named_discard_damage",
  "mill_self_typed_discard_damage",
]);

export type AbilityFrequency = "once_per_turn" | "passive" | "unlimited";

export type AbilityCondition =
  | { type: "has_energy_type"; energyType: string }
  | { type: "has_any_energy" }
  | { type: "discard_from_hand_to_use" }
  | { type: "own_ko_opponent_last_turn" };

export interface ParsedAbility {
  name: string;
  frequency: AbilityFrequency;
  conditions: AbilityCondition[];
  effects: ParsedEffect[];
  rawText: string;
}

export interface EffectContext {
  playerId: PlayerId;
  sourcePokemon: CardInstance;
  opponentId: PlayerId;
  lastDamageToOpponentActive?: number;
  attackName?: string;
  /** Cards drawn during the current executeEffects sequence (for conditional shuffle effects). */
  cardsDrawnThisSequence?: number;
}
