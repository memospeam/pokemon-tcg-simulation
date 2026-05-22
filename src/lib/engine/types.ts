import type { CardDefinition } from "../models/definition";
import type { CardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";

export interface TurnFlags {
  supporterPlayed: boolean;
  energyAttached: boolean;
  attacked: boolean;
  retreated: boolean;
  abilitiesUsed: string[];
  /** Named ability patterns used this turn (e.g. "flip the script"). */
  namedAbilitiesUsedThisTurn: string[];
  /** Used one bonus attack from Festival Grounds this turn. */
  bonusAttackUsed?: boolean;
  /** May attack again this turn (Festival Grounds). */
  bonusAttackAvailable?: boolean;
  /** Results of coin flips during the current attack (heads = true). */
  lastCoinFlipResults?: boolean[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  active: CardInstance | null;
  bench: CardInstance[];
  prizes: CardInstance[];
  discard: CardInstance[];
  lostZone: CardInstance[];
}

export interface EngineState {
  phase: GamePhase;
  turnNumber: number;
  currentPlayerId: PlayerId;
  viewingPlayerId: PlayerId;
  firstPlayerId: PlayerId;
  players: Record<PlayerId, PlayerState>;
  stadium: CardInstance | null;
  stadiumOwnerId: PlayerId | null;
  definitions: Record<string, CardDefinition>;
  log: string[];
  actionLog: GameAction[];
  winnerId: PlayerId | null;
  rngSeed: number;
  turnFlags: TurnFlags;
  pendingMulliganPlayerId: PlayerId | null;
  pendingAction: PendingAction;
  /** Card held during multi-step trainer effects (e.g. Crispin energy). */
  heldCard: CardInstance | null;
  /** Opponent cannot play Item cards from hand during their next turn (Itchy Pollen). */
  itemPlayBlockedForPlayerId: PlayerId | null;
}

export type GameAction =
  | { type: "SETUP_START"; seed?: number }
  | { type: "MULLIGAN"; playerId: PlayerId }
  | { type: "PLACE_ACTIVE"; playerId: PlayerId; instanceId: string }
  | { type: "PLACE_BENCH"; playerId: PlayerId; instanceId: string }
  | { type: "PLAY_BASIC_TO_BENCH"; playerId: PlayerId; instanceId: string }
  | { type: "DRAW"; playerId: PlayerId }
  | { type: "ATTACH_ENERGY"; playerId: PlayerId; energyId: string; targetId: string }
  | { type: "PLAY_TRAINER"; playerId: PlayerId; instanceId: string }
  | { type: "EVOLVE"; playerId: PlayerId; evolutionId: string; targetId: string }
  | { type: "ATTACK"; playerId: PlayerId; attackName: string }
  | { type: "RETREAT"; playerId: PlayerId; benchInstanceId: string }
  | { type: "PROMOTE_BENCH"; playerId: PlayerId; instanceId: string }
  | { type: "END_TURN" }
  | { type: "CONCEDE"; playerId: PlayerId }
  | { type: "SWITCH_OPPONENT_ACTIVE"; playerId: PlayerId; benchInstanceId: string }
  | { type: "SWITCH_WITH_BENCH"; playerId: PlayerId; benchInstanceId: string }
  | { type: "MOVE_ENERGY_TO_BENCH"; playerId: PlayerId; benchInstanceId: string }
  | { type: "CHOOSE_OPPONENT_DAMAGE"; playerId: PlayerId; targetId: string }
  | { type: "DISCARD_OWN_ENERGY_FOR_ATTACK"; playerId: PlayerId; pokemonId: string; energyId: string }
  | { type: "ATTACH_HAND_ENERGY_TO_POKEMON"; playerId: PlayerId; pokemonId: string; energyId: string }
  | { type: "RESUME_ATTACK"; playerId: PlayerId; attackName: string; extraBonusDamage: number }
  | { type: "CHOOSE_BENCH_ATTACK"; playerId: PlayerId; benchPokemonId: string; attackName: string }
  | { type: "SWITCH_VIEW"; playerId: PlayerId }
  | { type: "SELECT_HAND_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "PICK_DECK_CARD"; playerId: PlayerId; instanceId: string }
  | { type: "PICK_DISCARD_POKEMON"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_RARE_CANDY_BASIC"; playerId: PlayerId; targetId: string }
  | { type: "SELECT_CRISPIN_TARGET"; playerId: PlayerId; pokemonId: string }
  | { type: "DISCARD_OPPONENT_ENERGY"; playerId: PlayerId; pokemonId: string; energyId: string }
  | { type: "CRISPIN_OPTIONAL_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "SKIP_OPTIONAL"; playerId: PlayerId }
  | { type: "USE_ABILITY"; playerId: PlayerId; pokemonId: string; abilityName: string }
  | { type: "ASSIGN_BENCH_DAMAGE"; playerId: PlayerId; targetId: string }
  | { type: "CHOOSE_BENCH_DAMAGE_TARGET"; playerId: PlayerId; targetId: string }
  | { type: "MOVE_DAMAGE_SOURCE"; playerId: PlayerId; sourceId: string }
  | { type: "MOVE_DAMAGE_TARGET"; playerId: PlayerId; targetId: string };

export type PendingAction =
  | { type: "BOSS_ORDERS"; playerId: PlayerId }
  | { type: "PROMOTE"; playerId: PlayerId }
  | { type: "SWITCH_WITH_BENCH"; playerId: PlayerId; optional?: boolean }
  | { type: "MOVE_ENERGY_TO_BENCH"; playerId: PlayerId; sourceId: string }
  | { type: "DAMAGE_TWO_OPPONENT"; playerId: PlayerId; amount: number; picksRemaining: number; pickedIds: string[] }
  | {
      type: "DISCARD_BASIC_ENERGY_FOR_DAMAGE";
      playerId: PlayerId;
      attackName: string;
      perCard: number;
      discardedCount: number;
      fromBenchOnly: boolean;
      maxDiscard?: number;
    }
  | {
      type: "SEARCH_EVOLUTION";
      playerId: PlayerId;
      targetId: string;
      options: string[];
      attackName?: string;
    }
  | { type: "ATTACH_HAND_ENERGY"; playerId: PlayerId; energyType: string; energyId: string; nameFilter?: string; targetIds: string[] }
  | { type: "ULTRA_BALL_DISCARD"; playerId: PlayerId; selectedIds: string[] }
  | {
      type: "SEARCH_DECK";
      playerId: PlayerId;
      filter: "ANY_POKEMON" | "BASIC_POKEMON" | "BASIC_BENCH" | "BASIC_ENERGY_HAND" | "SUPPORTER_HAND" | "POKEMON_NO_RULE_BOX" | "POFFIN";
      options: string[];
      slotsRemaining?: number;
    }
  | { type: "PICK_DISCARD"; playerId: PlayerId; options: string[] }
  | { type: "RECON_DIRECTIVE"; playerId: PlayerId; options: string[] }
  | { type: "RARE_CANDY"; playerId: PlayerId }
  | { type: "CRUSHING_HAMMER"; playerId: PlayerId; options: { pokemonId: string; energyId: string }[] }
  | { type: "CRISPIN_ATTACH"; playerId: PlayerId; energyId: string; targets: string[] }
  | { type: "CRISPIN_DISCARD"; playerId: PlayerId }
  | {
      type: "DISTRIBUTE_BENCH_DAMAGE";
      playerId: PlayerId;
      countersRemaining: number;
    }
  | { type: "CHOOSE_BENCH_DAMAGE"; playerId: PlayerId; amount: number; options: string[] }
  | {
      type: "MOVE_DAMAGE";
      playerId: PlayerId;
      maxCounters: number;
      step: "SOURCE" | "TARGET";
      targetSide: "self" | "opponent";
      sourceId?: string;
      amountToMove?: number;
    }
  | {
      type: "COPY_BENCH_ATTACK";
      playerId: PlayerId;
      wrapperAttackName: string;
      options: { benchPokemonId: string; attackName: string }[];
    }
  | {
      type: "ABILITY_DISCARD_HAND";
      playerId: PlayerId;
      pokemonId: string;
      abilityName: string;
    }
  | null;

export function emptyTurnFlags(): TurnFlags {
  return {
    supporterPlayed: false,
    energyAttached: false,
    attacked: false,
    retreated: false,
    abilitiesUsed: [],
    namedAbilitiesUsedThisTurn: [],
  };
}

export function getPlayer(state: EngineState, playerId: PlayerId): PlayerState {
  return state.players[playerId];
}

export function getOpponentId(playerId: PlayerId): PlayerId {
  return playerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
}

export function findInstance(state: EngineState, instanceId: string): CardInstance | null {
  for (const player of Object.values(state.players)) {
    const zoneArrays = [
      player.deck,
      player.hand,
      player.bench,
      player.prizes,
      player.discard,
      player.lostZone,
    ];
    for (const zone of zoneArrays) {
      for (const card of zone) {
        if (card.instanceId === instanceId) return card;
        for (const energy of card.attachedEnergy) {
          if (energy.instanceId === instanceId) return energy;
        }
      }
    }
    if (player.active) {
      if (player.active.instanceId === instanceId) return player.active;
      for (const energy of player.active.attachedEnergy) {
        if (energy.instanceId === instanceId) return energy;
      }
    }
  }
  if (state.stadium?.instanceId === instanceId) return state.stadium;
  return null;
}

export function getDefinition(state: EngineState, definitionId: string): CardDefinition | undefined {
  return state.definitions[definitionId];
}

export function remainingHp(state: EngineState, pokemon: CardInstance): number {
  const def = getDefinition(state, pokemon.definitionId);
  const maxHp = parseInt(def?.hp ?? "0", 10) || 0;
  return Math.max(0, maxHp - pokemon.damageCounters);
}

export function isKnockedOut(state: EngineState, pokemon: CardInstance): boolean {
  return remainingHp(state, pokemon) <= 0;
}

export function setZone(card: CardInstance, zone: Zone): void {
  card.zone = zone;
}

export function moveToDiscard(player: PlayerState, card: CardInstance): void {
  setZone(card, Zone.Discard);
  player.discard.push(card);
}

export function removeFromHand(player: PlayerState, instanceId: string): CardInstance | null {
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return null;
  return player.hand.splice(index, 1)[0] ?? null;
}

export function allPokemonInPlay(player: PlayerState): CardInstance[] {
  return [...(player.active ? [player.active] : []), ...player.bench];
}

export function hasBasicInHand(player: PlayerState, state: EngineState): boolean {
  return player.hand.some((card) => {
    const def = getDefinition(state, card.definitionId);
    return def?.supertype === "Pokémon" && def.subtypes.includes("Basic");
  });
}
