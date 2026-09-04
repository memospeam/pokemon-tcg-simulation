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
  /** Premium Power Pro: Fighting attacks +N to opponent Active. */
  fightingActiveDamageBonus?: number;
  /** Black Belt's Training: attacks +N vs opponent Active ex. */
  activeExDamageBonus?: number;
  /** Briar: Tera KO takes 1 extra Prize. */
  briarExtraPrizeOnTeraKo?: boolean;
  /** Played a Team Rocket Supporter from hand this turn. */
  playedTeamRocketSupporter?: boolean;
  /** Team Rocket's Factory optional draw available. */
  trFactoryDrawAvailable?: boolean;
  /** Lumiose City / similar once-per-turn stadium action used. */
  stadiumOncePerTurnUsed?: boolean;
  /** Pokémon that moved from Bench to Active this turn (retreat/switch, not KO promote). */
  movedFromBenchToActiveIds?: string[];
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
  /** Set when this player's Team Rocket Pokémon was Knocked Out; cleared when their turn ends. */
  teamRocketKnockedOutSinceMyLastTurn: Record<PlayerId, boolean>;
  /** Legacy Energy: prize reduction applied once per game per player. */
  legacyEnergyPrizeReductionUsed: Record<PlayerId, boolean>;
  /** Any of this player's Pokémon were KO'd during the opponent's previous turn (Fezandipiti, etc.). */
  ownPokemonKnockedOutOpponentLastTurn: Record<PlayerId, boolean>;
}

export type GameAction =
  | { type: "SETUP_START"; seed?: number }
  | { type: "MULLIGAN"; playerId: PlayerId }
  | { type: "PLACE_ACTIVE"; playerId: PlayerId; instanceId: string }
  | { type: "PLACE_BENCH"; playerId: PlayerId; instanceId: string }
  | { type: "PLAY_BASIC_TO_BENCH"; playerId: PlayerId; instanceId: string }
  | { type: "DRAW"; playerId: PlayerId }
  | { type: "ATTACH_ENERGY"; playerId: PlayerId; energyId: string; targetId: string }
  | { type: "ATTACH_TOOL"; playerId: PlayerId; toolId: string; targetId: string }
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
  | { type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK"; playerId: PlayerId; instanceId: string }
  | { type: "CHOOSE_BLOCKED_ATTACK"; playerId: PlayerId; attackName: string }
  | { type: "ATTACH_HAND_ENERGY_TO_POKEMON"; playerId: PlayerId; pokemonId: string; energyId: string }
  | { type: "RESUME_ATTACK"; playerId: PlayerId; attackName: string; extraBonusDamage: number }
  | { type: "CHOOSE_BENCH_ATTACK"; playerId: PlayerId; benchPokemonId: string; attackName: string }
  | { type: "SWITCH_VIEW"; playerId: PlayerId }
  | { type: "SELECT_HAND_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "IONO_SELECT_HAND"; playerId: PlayerId; instanceId: string }
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
  | { type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET"; playerId: PlayerId; targetId: string }
  | { type: "MOVE_DAMAGE_SOURCE"; playerId: PlayerId; sourceId: string }
  | { type: "MOVE_DAMAGE_TARGET"; playerId: PlayerId; targetId: string }
  | { type: "SELECT_REDISTRIBUTE_SOURCE"; playerId: PlayerId; sourceId: string }
  | { type: "SELECT_REDISTRIBUTE_TARGET"; playerId: PlayerId; targetId: string }
  | { type: "CONFIRM_DRAW_UNTIL_HAND"; playerId: PlayerId }
  | { type: "SELECT_ENERGY_SWITCH_POKEMON"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_ENHANCED_HAMMER_POKEMON"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_WALLYS_POKEMON"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_CIPHERMANIAC_CARD"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_FIGHTING_GONG"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_GIOVANNI_BENCH"; playerId: PlayerId; benchInstanceId: string }
  | { type: "SELECT_PRIME_CATCHER_BENCH"; playerId: PlayerId; benchInstanceId: string }
  | { type: "SELECT_N_PP_UP_ENERGY"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_N_PP_UP_TARGET"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_TOOL_SCRAPPER"; playerId: PlayerId; toolInstanceId: string }
  | { type: "SELECT_ROTO_STICK"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_MIRACLE_HEADSET"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_BUG_CATCHING"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_SECRET_BOX_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_SECRET_BOX_SEARCH"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_BROCK_MODE"; playerId: PlayerId; mode: "basic" | "evolution" }
  | { type: "SELECT_SURFER_BENCH"; playerId: PlayerId; benchInstanceId: string }
  | { type: "SELECT_ROSA_TARGET"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_ROSA_ENERGY"; playerId: PlayerId; instanceId: string }
  | { type: "USE_LUMIOSE_CITY"; playerId: PlayerId; instanceId: string }
  | { type: "USE_TR_FACTORY_DRAW"; playerId: PlayerId }
  | { type: "USE_COMMUNITY_CENTER"; playerId: PlayerId }
  | { type: "USE_GRAND_TREE"; playerId: PlayerId }
  | { type: "SELECT_GRAND_TREE_BASIC"; playerId: PlayerId; targetId: string }
  | { type: "SELECT_GRAND_TREE_STAGE1"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_GRAND_TREE_STAGE2"; playerId: PlayerId; instanceId: string }
  | { type: "SKIP_GRAND_TREE_STAGE2"; playerId: PlayerId }
  | { type: "SELECT_ERI_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_JANINE_DARKNESS"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_GLASS_TRUMPET"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_BIANCA_HEAL"; playerId: PlayerId; pokemonId: string }
  | { type: "SELECT_MORTY_DISCARD"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_SALVATORE_EVOLVE"; playerId: PlayerId; targetId: string }
  | { type: "SELECT_PERRIN_HAND"; playerId: PlayerId; instanceId: string }
  | { type: "SELECT_PERRIN_SEARCH"; playerId: PlayerId; instanceId: string };

export type PendingAction =
  | { type: "BOSS_ORDERS"; playerId: PlayerId }
  | { type: "IONO_HAND_BOTTOM"; playerId: PlayerId }
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
      returnToHand?: boolean;
      energyType?: string;
      activeOnly?: boolean;
    }
  | {
      type: "SEARCH_EVOLUTION";
      playerId: PlayerId;
      targetId: string;
      options: string[];
      attackName?: string;
    }
  | { type: "ATTACH_HAND_ENERGY"; playerId: PlayerId; energyType: string; energyId: string; nameFilter?: string; targetIds: string[]; drawOnAttach?: boolean; healOnAttach?: number }
  | { type: "ULTRA_BALL_DISCARD"; playerId: PlayerId; selectedIds: string[] }
  | {
      type: "SEARCH_DECK";
      playerId: PlayerId;
      filter:
        | "ANY_POKEMON"
        | "BASIC_POKEMON"
        | "BASIC_BENCH"
        | "BASIC_PSYCHIC_BENCH"
        | "BASIC_ENERGY_HAND"
        | "SUPPORTER_HAND"
        | "POKEGEAR_TOP7"
        | "POKEMON_NO_RULE_BOX"
        | "POFFIN"
        | "STAGE1_POKEMON_HAND"
        | "STAGE2_POKEMON_HAND"
        | "POKEMON_EX_HAND"
        | "TEAM_ROCKET_BASIC_HAND"
        | "STADIUM_HAND"
        | "ANY_ENERGY_HAND"
        | "ANY_TRAINER_HAND"
        | "FIGHTING_GONG"
        | "TEAM_ROCKET_SUPPORTER_HAND"
        | "BROCK_BASIC_HAND"
        | "BROCK_EVOLUTION_HAND"
        | "LUMIOSE_BASIC_BENCH"
        | "TOOL_HAND"
        | "TYPED_POKEMON_MAX_HP_HAND"
        | "NAMED_POKEMON_BENCH"
        | "MEGA_EVOLUTION_EX_HAND"
        | "SALVATORE_EVOLUTION";
      options: string[];
      slotsRemaining?: number;
      searchMeta?: { typeFilter?: string; maxHp?: number; nameFilter?: string };
    }
  | {
      type: "PICK_DISCARD";
      playerId: PlayerId;
      options: string[];
      slotsRemaining?: number;
      shuffleToDeck?: boolean;
      toBench?: boolean;
      nameFilter?: string;
    }
  | {
      type: "SWITCH_TYPED_BENCH";
      playerId: PlayerId;
      typeFilter: string;
      excludeName?: string;
      applyStatus?: string;
      options: string[];
    }
  | {
      type: "ENERGY_SWITCH";
      playerId: PlayerId;
      step: "SOURCE" | "TARGET";
      sourceId?: string;
      options: string[];
    }
  | {
      type: "ENHANCED_HAMMER";
      playerId: PlayerId;
      step: "POKEMON" | "ENERGY";
      pokemonId?: string;
      discardRemaining: number;
      options: { pokemonId: string; energyId: string }[];
    }
  | { type: "WALLYS_COMPASSION"; playerId: PlayerId; options: string[] }
  | { type: "HILDA"; playerId: PlayerId; step: "EVOLUTION" | "ENERGY"; options: string[] }
  | { type: "DAWN"; playerId: PlayerId; step: "BASIC" | "STAGE1" | "STAGE2"; options: string[] }
  | { type: "COLRESS"; playerId: PlayerId; step: "STADIUM" | "ENERGY"; options: string[] }
  | {
      type: "GIOVANNI";
      playerId: PlayerId;
      step: "OWN_BENCH" | "OPPONENT_BENCH";
      ownBenchId?: string;
      options: string[];
    }
  | {
      type: "PRIME_CATCHER";
      playerId: PlayerId;
      step: "OPPONENT_BENCH" | "OWN_BENCH";
      opponentBenchId?: string;
      options: string[];
    }
  | { type: "N_PP_UP"; playerId: PlayerId; step: "ENERGY" | "TARGET"; energyId?: string; options: string[] }
  | { type: "TOOL_SCRAPPER"; playerId: PlayerId; discardRemaining: number; options: string[] }
  | {
      type: "ROTO_STICK";
      playerId: PlayerId;
      options: string[];
      pickedIds: string[];
    }
  | {
      type: "MIRACLE_HEADSET";
      playerId: PlayerId;
      options: string[];
      pickedIds: string[];
      maxPicks: number;
    }
  | {
      type: "BUG_CATCHING_SET";
      playerId: PlayerId;
      options: string[];
      pickedIds: string[];
      maxPicks: number;
    }
  | {
      type: "SECRET_BOX";
      playerId: PlayerId;
      step: "DISCARD" | "ITEM" | "TOOL" | "SUPPORTER" | "STADIUM";
      options: string[];
      discardIds?: string[];
    }
  | { type: "CIPHERMANIAC"; playerId: PlayerId; pickedIds: string[]; options: string[] }
  | { type: "FIGHTING_GONG"; playerId: PlayerId; options: string[] }
  | { type: "LANAS_AID"; playerId: PlayerId; pickedIds: string[]; options: string[] }
  | { type: "BROCKS_SCOUTING"; playerId: PlayerId; step: "MODE" | "BASIC" | "EVOLUTION"; pickedIds?: string[]; options: string[] }
  | { type: "ROSAS_ENCOURAGEMENT"; playerId: PlayerId; step: "TARGET" | "ENERGY"; targetId?: string; pickedEnergyIds?: string[]; options: string[] }
  | { type: "SURFER"; playerId: PlayerId; options: string[] }
  | {
      type: "GRAND_TREE";
      playerId: PlayerId;
      step: "BASIC" | "STAGE1" | "STAGE2";
      basicTargetId?: string;
      stage1TargetId?: string;
      options: string[];
    }
  | { type: "RECON_DIRECTIVE"; playerId: PlayerId; options: string[] }
  | { type: "RARE_CANDY"; playerId: PlayerId }
  | { type: "CRUSHING_HAMMER"; playerId: PlayerId; options: { pokemonId: string; energyId: string }[] }
  | { type: "CRISPIN_ATTACH"; playerId: PlayerId; energyId: string; targets: string[] }
  | { type: "CRISPIN_DISCARD"; playerId: PlayerId }
  | {
      type: "ERI_DISCARD";
      playerId: PlayerId;
      options: string[];
      slotsRemaining: number;
      pickedIds: string[];
    }
  | {
      type: "JANINE_DARKNESS";
      playerId: PlayerId;
      options: string[];
      slotsRemaining: number;
      pickedIds: string[];
    }
  | {
      type: "GLASS_TRUMPET";
      playerId: PlayerId;
      options: string[];
      slotsRemaining: number;
      pickedIds: string[];
    }
  | { type: "BIANCA_HEAL"; playerId: PlayerId; options: string[] }
  | {
      type: "EXPLORERS_GUIDANCE";
      playerId: PlayerId;
      options: string[];
      slotsRemaining: number;
      pickedIds: string[];
      revealPool: string[];
    }
  | { type: "MORTY_DISCARD"; playerId: PlayerId; options: string[] }
  | { type: "SALVATORE_EVOLVE"; playerId: PlayerId; evolutionId: string; options: string[] }
  | {
      type: "PERRIN";
      playerId: PlayerId;
      step: "HAND" | "SEARCH";
      options: string[];
      pickedIds: string[];
      slotsRemaining: number;
    }
  | {
      type: "DISTRIBUTE_BENCH_DAMAGE";
      playerId: PlayerId;
      countersRemaining: number;
      attackName?: string;
    }
  | {
      type: "CHOOSE_BENCH_DAMAGE";
      playerId: PlayerId;
      amount: number;
      options: string[];
      attackName?: string;
      knockOutSourceId?: string;
    }
  | {
      type: "CHOOSE_OPPONENT_POKEMON_DAMAGE";
      playerId: PlayerId;
      amount: number;
      options: string[];
      attackName?: string;
      knockOutSourceId?: string;
    }
  | {
      type: "MOVE_DAMAGE";
      playerId: PlayerId;
      maxCounters: number;
      step: "SOURCE" | "TARGET";
      targetSide: "self" | "opponent";
      sourceId?: string;
      amountToMove?: number;
      attackName?: string;
    }
  | {
      type: "REDISTRIBUTE_OPPONENT_COUNTERS";
      playerId: PlayerId;
      step: "SOURCE" | "TARGET";
      sourceId?: string;
      optional?: boolean;
      attackName?: string;
    }
  | {
      type: "DRAW_UNTIL_HAND";
      playerId: PlayerId;
      targetCount: number;
      optional: boolean;
      attackName?: string;
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
  | {
      type: "ABILITY_DISCARD_HAND_ENERGY";
      playerId: PlayerId;
      pokemonId: string;
      abilityName: string;
      energyType: string;
    }
  | {
      type: "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE";
      playerId: PlayerId;
      attackName: string;
      nameFilter: string;
      perCard: number;
      discardedCount: number;
    }
  | {
      type: "CHOOSE_BLOCKED_ATTACK";
      playerId: PlayerId;
      targetPokemonId: string;
      options: string[];
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
        for (const tool of card.attachedTools ?? []) {
          if (tool.instanceId === instanceId) return tool;
        }
      }
    }
    if (player.active) {
      if (player.active.instanceId === instanceId) return player.active;
      for (const energy of player.active.attachedEnergy) {
        if (energy.instanceId === instanceId) return energy;
      }
      for (const tool of player.active.attachedTools ?? []) {
        if (tool.instanceId === instanceId) return tool;
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
  // A card in the discard pile carries no in-play state. Reset combat state so
  // returning it to hand/deck later (Night Stretcher, Super Rod, …) yields a
  // fresh card — otherwise a KO'd Pokémon (damage ≥ HP) comes back and is "dead
  // on arrival" when re-played (a benched zombie).
  card.damageCounters = 0;
  card.statusConditions = [];
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
