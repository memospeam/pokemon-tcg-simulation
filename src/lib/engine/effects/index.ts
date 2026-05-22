export type { AbilityCondition, AbilityFrequency, EffectContext, ParsedAbility, ParsedEffect } from "./types";
export { countersToDamage, PRE_DAMAGE_ATTACK_EFFECT_KINDS } from "./types";
export { parseAttackText, parseAbilityText, getAttackEffectSummary, summarizeEffects } from "./parseText";
export {
  executeEffects,
  assignBenchDamageCounter,
  chooseBenchDamage,
  selectMoveDamageSource,
  selectMoveDamageTarget,
  resolveReconDirectivePick,
  resolveSwitchWithBench,
  resolveMoveEnergyToBench,
  resolveChooseOpponentDamage,
  resolveAttachHandEnergyToPokemon,
  resolveSearchEvolutionPick,
  resolveBenchKnockouts,
} from "./execute";
export {
  applyFestivalGroundsBonusIfEligible,
  applyAttackDamagePhase,
  applyCopiedBenchAttack,
  canStartAttack,
  finishDiscardEnergyForAttack,
  listCopyableBenchAttacks,
  listDiscardableEnergy,
  resolveDiscardOwnEnergyForAttack,
  startAttackIfCopyPending,
  startAttackIfDiscardPending,
} from "./attackFlow";
export {
  canPokemonAttackWithPassives,
  countMatchingPokemonInPlay,
  countPrizesTakenByPlayer,
  getEffectiveAttackCost,
  getFuturePokemonDamageBonus,
  attackerIgnoresOpponentActiveModifiers,
  getDragonWeaknessOverrideType,
  applyWeaknessAndResistanceForPokemon,
} from "./passiveRules";
export { computePreDamageBonus, isSecondPlayerFirstTurnBlocked, shouldPreventDamageFromAttacker, shouldPreventDamageFromAbilityPokemon } from "./damageBonus";
export { trySurviveKnockout } from "./koSurvival";
export {
  getPokemonAbilities,
  canUseAbilityNow,
  markAbilityUsed,
  summarizeAbility,
  meetsAbilityConditions,
  hasActivatableAbility,
  getExecutableAbilityEffects,
  abilityRequiresKnockOutSelf,
} from "./abilities";
export { hasTeraBenchProtection, canReceiveBenchAttackDamage } from "./pokemonRules";
