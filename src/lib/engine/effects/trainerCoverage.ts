import type { ParsedEffect } from "./types";
import { isStadiumEffectKind, isTrainerEffectKind } from "./parseTextTrainer";

const TRAINER_IMPLEMENTED_KINDS = new Set<ParsedEffect["kind"]>([
  "trainer_shuffle_hand_draw",
  "trainer_discard_hand_draw",
  "trainer_judge",
  "trainer_iono",
  "trainer_boss_orders",
  "trainer_ultra_ball",
  "trainer_search_no_rule_box",
  "trainer_poffin",
  "trainer_night_stretcher",
  "trainer_crushing_hammer",
  "trainer_enhanced_hammer",
  "trainer_rare_candy",
  "trainer_unfair_stamp",
  "trainer_crispin",
  "trainer_crispin_sv",
  "trainer_hilda",
  "trainer_pokegear",
  "trainer_search_supporter",
  "trainer_wallys_compassion",
  "trainer_energy_switch",
  "trainer_switch_active_bench",
  "trainer_dawn",
  "trainer_ariana",
  "trainer_archer",
  "trainer_giovanni",
  "trainer_proton",
  "trainer_petrel",
  "trainer_cyrano",
  "trainer_ciphermaniac",
  "trainer_fighting_gong",
  "trainer_colress_tenacity",
  "trainer_ns_pp_up",
  "trainer_tool_scrapper",
  "trainer_premium_power_pro",
  "trainer_black_belt_training",
  "trainer_ruffian",
  "trainer_transformation_tome",
  "trainer_lanas_aid",
  "trainer_brocks_scouting",
  "trainer_rosas_encouragement",
  "trainer_briar",
  "trainer_surfer",
  "trainer_sacred_ash",
  "trainer_team_rocket_transceiver",
  "trainer_roto_stick",
  "trainer_miracle_headset",
  "trainer_secret_box",
  "trainer_bug_catching_set",
  "trainer_prime_catcher",
  "trainer_master_ball",
  "trainer_treasure_tracker",
  "trainer_mega_signal",
  "trainer_eri",
  "trainer_carmine",
  "trainer_janine_secret_art",
  "trainer_glass_trumpet",
  "trainer_bianca_devotion",
  "trainer_explorers_guidance",
  "trainer_mortys_conviction",
  "trainer_salvatore",
  "trainer_perrin",
  "stadium_battle_cage",
  "stadium_risky_ruins",
  "stadium_watchtower",
  "stadium_forest_vitality",
  "stadium_area_zero",
  "stadium_gravity_mountain",
  "stadium_grand_tree",
  "stadium_lumiose_city",
  "stadium_team_rocket_factory",
  "stadium_ns_castle",
  "stadium_festival_grounds",
  "stadium_neutralization_zone",
]);

export function isTrainerKindImplemented(kind: ParsedEffect["kind"]): boolean {
  return TRAINER_IMPLEMENTED_KINDS.has(kind);
}

export function analyzeTrainerEffects(effects: ParsedEffect[]): {
  hasTrainerEffects: boolean;
  allImplemented: boolean;
  unimplementedKinds: ParsedEffect["kind"][];
} {
  const trainerEffects = effects.filter(
    (effect) => isTrainerEffectKind(effect.kind) && !isStadiumEffectKind(effect.kind),
  );
  const unimplementedKinds = trainerEffects
    .map((effect) => effect.kind)
    .filter((kind) => !isTrainerKindImplemented(kind));
  return {
    hasTrainerEffects: trainerEffects.length > 0,
    allImplemented: trainerEffects.length > 0 && unimplementedKinds.length === 0,
    unimplementedKinds: [...new Set(unimplementedKinds)],
  };
}
