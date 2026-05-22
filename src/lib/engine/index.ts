export { beginGame, canStartActiveGame, createInitialGame, gameReducer, getLegalActions, startActiveGame } from "./reducer";
export {
  applyJudgeEffect,
  applyWeaknessAndResistance,
  canEvolvePokemonThisTurn,
  canAttackThisTurn,
  canPlaySupporterThisTurn,
  canEvolveInto,
  checkMulliganNeeded,
  checkWinCondition,
  countPrizeCards,
  drawCards,
  drawOpeningHands,
  getDefinitionSafe,
  normalizePokemonName,
  parseDamage,
  setupPrizes,
} from "./rules";
export { canAffordAttack, canAffordRetreat, formatAttackCost, getAttachedEnergyPool, payRetreatCost } from "./energy";
export { createRng, SeededRng } from "./rng";
export { shufflePlayerDeck, flipCoin, logMessage } from "./helpers";
export {
  parseAttackText,
  parseAbilityText,
  getAttackEffectSummary,
  executeEffects,
  canUseAbilityNow,
  summarizeAbility,
  hasTeraBenchProtection,
} from "./effects";
export type { CreateGameInput } from "./rules";
export type { EngineState, GameAction, PendingAction, PlayerState, TurnFlags } from "./types";
export {
  allPokemonInPlay,
  findInstance,
  getDefinition,
  getOpponentId,
  getPlayer,
  isKnockedOut,
  remainingHp,
} from "./types";
