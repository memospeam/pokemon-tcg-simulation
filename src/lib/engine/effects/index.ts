export type { AbilityCondition, AbilityFrequency, EffectContext, ParsedAbility, ParsedEffect } from "./types";
export { countersToDamage, PRE_DAMAGE_ATTACK_EFFECT_KINDS } from "./types";
export { parseAttackText, parseAbilityText, parseEffectClauses, getAttackEffectSummary, summarizeEffects } from "./parseText";
export { getTrainerEffectText, parseTrainerText } from "./trainerText";
export { isTrainerKindImplemented } from "./trainerCoverage";
export {
  executeEffects,
  assignBenchDamageCounter,
  chooseBenchDamage,
  confirmDrawUntilHand,
  selectMoveDamageSource,
  selectMoveDamageTarget,
  selectRedistributeOpponentSource,
  selectRedistributeOpponentTarget,
  resolveReconDirectivePick,
  resolveSwitchWithBench,
  resolveSwitchTypedBenchToActive,
  continueRecoverToBenchPick,
  resolveMoveEnergyToBench,
  resolveChooseOpponentDamage,
  resolveAttachHandEnergyToPokemon,
  resolveSearchEvolutionPick,
  resolveChooseBlockedAttack,
  resolveBenchKnockouts,
} from "./execute";
export {
  applyFestivalGroundsBonusIfEligible,
  applyAttackDamagePhase,
  applyCopiedBenchAttack,
  canStartAttack,
  finishDiscardEnergyForAttack,
  finishDiscardSupportersForAttack,
  isAttackBlockedThisTurn,
  listCopyableBenchAttacks,
  listDiscardableEnergy,
  listDiscardableNamedSupporters,
  resolveDiscardHandSupporterForAttack,
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
