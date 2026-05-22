import type { CardDefinition } from "../models/definition";
import { isStage2 } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { createRng } from "./rng";
import {
  emptyTurnFlags,
  getDefinition,
  getOpponentId,
  getPlayer,
  hasBasicInHand,
  type EngineState,
} from "./types";
import { canEvolveSameTurnWithForestVitality } from "./effects/stadiumEffects";

export interface CreateGameInput {
  player1Name: string;
  player2Name: string;
  player1Cards: CardDefinition[];
  player2Cards: CardDefinition[];
  /** Evolution-line cards not in either deck (e.g. Drakloak for Rare Candy checks). */
  extraDefinitions?: CardDefinition[];
  seed?: number;
}

function buildDefinitions(
  player1Cards: CardDefinition[],
  player2Cards: CardDefinition[],
  extraDefinitions: CardDefinition[] = [],
): Record<string, CardDefinition> {
  const definitions: Record<string, CardDefinition> = {};
  for (const card of [...player1Cards, ...player2Cards, ...extraDefinitions]) {
    definitions[card.apiId] = card;
  }
  return definitions;
}

export function findDefinitionByName(
  definitions: Record<string, CardDefinition>,
  name: string,
): CardDefinition | undefined {
  const target = normalizePokemonName(name);
  return Object.values(definitions).find(
    (def) => def.name === name || normalizePokemonName(def.name) === target,
  );
}

/** Rare Candy: Basic → Stage 2 when Stage 2 shares an evolution line (via Stage 1). */
export function canRareCandyEvolveInto(
  state: EngineState,
  basicDef: CardDefinition,
  stage2Def: CardDefinition,
): boolean {
  if (!isStage2(stage2Def)) return false;
  if (canEvolveInto(basicDef, stage2Def)) return true;
  if (!stage2Def.evolvesFrom) return false;

  const stage1Def = findDefinitionByName(state.definitions, stage2Def.evolvesFrom);
  if (!stage1Def) return false;
  return canEvolveInto(basicDef, stage1Def);
}

function buildDeck(cards: CardDefinition[], ownerId: PlayerId) {
  return cards.map((card) => createCardInstance(card.apiId, ownerId, Zone.Deck));
}

function createPlayer(id: PlayerId, name: string, cards: CardDefinition[]) {
  const deck = buildDeck(cards, id);
  return {
    id,
    name,
    deck,
    hand: [],
    active: null,
    bench: [],
    prizes: [],
    discard: [],
    lostZone: [],
  };
}

export function createInitialGame(input: CreateGameInput): EngineState {
  const rng = createRng(input.seed);
  const definitions = buildDefinitions(
    input.player1Cards,
    input.player2Cards,
    input.extraDefinitions ?? [],
  );
  const player1 = createPlayer(PlayerId.P1, input.player1Name, input.player1Cards);
  const player2 = createPlayer(PlayerId.P2, input.player2Name, input.player2Cards);

  player1.deck = rng.shuffle(player1.deck);
  player2.deck = rng.shuffle(player2.deck);

  return {
    phase: GamePhase.Setup,
    turnNumber: 0,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: player1,
      [PlayerId.P2]: player2,
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions,
    log: [`Game created: ${input.player1Name} vs ${input.player2Name}`],
    actionLog: [],
    winnerId: null,
    rngSeed: input.seed ?? Date.now(),
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: {
      [PlayerId.P1]: false,
      [PlayerId.P2]: false,
    },
    legacyEnergyPrizeReductionUsed: {
      [PlayerId.P1]: false,
      [PlayerId.P2]: false,
    },
    ownPokemonKnockedOutOpponentLastTurn: {
      [PlayerId.P1]: false,
      [PlayerId.P2]: false,
    },
  };
}

export function drawOpeningHands(state: EngineState): EngineState {
  const next = structuredClone(state);
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(next, playerId);
    for (let i = 0; i < 7; i += 1) {
      const card = player.deck.shift();
      if (card) {
        card.zone = Zone.Hand;
        player.hand.push(card);
      }
    }
  }
  next.phase = GamePhase.Mulligan;
  next.pendingMulliganPlayerId = PlayerId.P1;
  next.log.push("Opening hands dealt. Check for Basic Pokémon.");
  return next;
}

export function setupPrizes(state: EngineState): EngineState {
  const next = structuredClone(state);
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(next, playerId);
    for (let i = 0; i < 6; i += 1) {
      const card = player.deck.shift();
      if (card) {
        card.zone = Zone.Prizes;
        player.prizes.push(card);
      }
    }
  }
  next.log.push("Prize cards set.");
  return next;
}

export function checkMulliganNeeded(state: EngineState, playerId: PlayerId): boolean {
  const player = getPlayer(state, playerId);
  return !hasBasicInHand(player, state);
}

export function parseDamage(damage: string): number {
  const match = damage.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export function applyWeaknessAndResistance(
  damage: number,
  attackerTypes: string[] | undefined,
  defender: CardDefinition,
): number {
  let total = damage;
  const weakness = defender.weaknesses?.find((entry) => attackerTypes?.includes(entry.type));
  if (weakness) {
    const multiplier = weakness.value.startsWith("×") ? parseInt(weakness.value.slice(1), 10) : 2;
    total *= multiplier || 2;
  }
  const resistance = defender.resistances?.find((entry) => attackerTypes?.includes(entry.type));
  if (resistance) {
    const reduction = parseInt(resistance.value.replace(/[^\d]/g, ""), 10) || 30;
    total = Math.max(0, total - reduction);
  }
  return total;
}

export function countPrizeCards(pokemon: CardDefinition): number {
  if (pokemon.subtypes.includes("VMAX") || pokemon.subtypes.includes("VSTAR")) return 2;
  if (
    pokemon.subtypes.includes("V") ||
    pokemon.subtypes.includes("ex") ||
    pokemon.subtypes.includes("EX") ||
    pokemon.rules?.some((rule) => rule.includes("2 Prize"))
  ) {
    return 2;
  }
  return 1;
}

export function checkWinCondition(state: EngineState): PlayerId | null {
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    if (player.prizes.length === 0) return playerId;
  }

  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    if (player.deck.length === 0 && state.phase === GamePhase.Active) {
      return getOpponentId(playerId);
    }
    if (!player.active && player.bench.length === 0 && state.phase === GamePhase.Active) {
      return getOpponentId(playerId);
    }
  }

  return state.winnerId;
}

export function getDefinitionSafe(state: EngineState, definitionId: string): CardDefinition {
  const def = getDefinition(state, definitionId);
  if (!def) {
    throw new Error(`Missing definition: ${definitionId}`);
  }
  return def;
}

export function drawCards(state: EngineState, playerId: PlayerId, count: number): number {
  const player = getPlayer(state, playerId);
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    card.zone = Zone.Hand;
    player.hand.push(card);
    drawn += 1;
  }
  if (drawn > 0) {
    state.log.push(`${player.name} drew ${drawn} card(s).`);
  }
  return drawn;
}

export function normalizePokemonName(name: string): string {
  return name.replace(/\s+(ex|EX|GX|V|VMAX|VSTAR)$/i, "").trim();
}

export function canEvolveInto(from: CardDefinition, evolution: CardDefinition): boolean {
  if (!evolution.evolvesFrom) return false;
  const base = normalizePokemonName(from.name);
  const target = normalizePokemonName(evolution.evolvesFrom);
  return base === target || from.name === evolution.evolvesFrom;
}

export function canEvolvePokemonThisTurn(
  state: EngineState,
  pokemon: import("../models/instance").CardInstance,
): boolean {
  if (canEvolveSameTurnWithForestVitality(state, pokemon)) return true;
  return pokemon.enteredPlayTurn !== state.turnNumber;
}

export function canAttackThisTurn(state: EngineState): boolean {
  if (state.turnNumber === 1 && state.currentPlayerId === state.firstPlayerId) {
    return false;
  }
  return true;
}

export function canPlaySupporterThisTurn(state: EngineState, playerId: PlayerId): boolean {
  if (state.turnNumber === 1 && playerId === state.firstPlayerId) {
    return false;
  }
  return true;
}

export function applyJudgeEffect(state: EngineState): void {
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    const returned = [...player.hand];
    player.hand = [];
    for (const card of returned) {
      card.zone = Zone.Deck;
      player.deck.push(card);
    }
    const rng = createRng(state.rngSeed + player.deck.length + returned.length);
    player.deck = rng.shuffle(player.deck);
    drawCards(state, playerId, 4);
  }
  state.log.push("Judge: both players shuffled their hands into their decks and drew 4 cards.");
}
