import { isBasicEnergy } from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe, drawCards } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { allPokemonInPlay, getPlayer, moveToDiscard, type EngineState } from "../types";
import { getStadiumKind } from "./stadiumEffects";

function stadiumGate(state: EngineState, playerId: PlayerId, kind: ReturnType<typeof getStadiumKind>): boolean {
  return (
    getStadiumKind(state) === kind &&
    !state.turnFlags.stadiumOncePerTurnUsed &&
    !state.pendingAction &&
    state.currentPlayerId === playerId
  );
}

function isBasicLightningEnergy(state: EngineState, card: CardInstance): boolean {
  const def = getDefinitionSafe(state, card.definitionId);
  if (!isBasicEnergy(def)) return false;
  return (def.types?.includes("Lightning") ?? false) || def.name.toLowerCase().includes("lightning");
}

function isWaterPokemon(state: EngineState, pokemon: CardInstance): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return def.types?.includes("Water") ?? false;
}

function isMarniesPokemon(state: EngineState, card: CardInstance): boolean {
  const def = getDefinitionSafe(state, card.definitionId);
  return def.supertype === "Pokémon" && def.name.toLowerCase().includes("marnie's");
}

function isEnergyCard(def: CardDefinition): boolean {
  return def.supertype === "Energy";
}

function countPsychicPokemonInPlay(state: EngineState, playerId: PlayerId): number {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).filter((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    return def.types?.includes("Psychic") ?? false;
  }).length;
}

export function canUseMysteryGarden(state: EngineState, playerId: PlayerId): boolean {
  if (!stadiumGate(state, playerId, "mystery_garden")) return false;
  const player = getPlayer(state, playerId);
  const psychicCount = countPsychicPokemonInPlay(state, playerId);
  if (psychicCount === 0) return false;
  const energyInHand = player.hand.filter((card) => isEnergyCard(getDefinitionSafe(state, card.definitionId)));
  if (energyInHand.length === 0) return false;
  const handAfterDiscard = player.hand.length - 1;
  return handAfterDiscard < psychicCount && player.deck.length > 0;
}

export function canUseAcademyAtNight(state: EngineState, playerId: PlayerId): boolean {
  if (!stadiumGate(state, playerId, "academy_at_night")) return false;
  return getPlayer(state, playerId).hand.length > 0;
}

export function startAcademyAtNight(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  state.pendingAction = {
    type: "ACADEMY_AT_NIGHT",
    playerId,
    options: player.hand.map((card) => card.instanceId),
  };
  logMessage(state, "Academy at Night: choose a card from your hand to put on top of your deck.");
}

export function resolveAcademyAtNight(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ACADEMY_AT_NIGHT" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.hand.splice(index, 1)[0]!;
  card.zone = Zone.Deck;
  player.deck.unshift(card);
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(
    state,
    `${player.name} put ${getDefinitionSafe(state, card.definitionId).name} on top of their deck (Academy at Night).`,
  );
}

export function canUseLevincia(state: EngineState, playerId: PlayerId): boolean {
  if (!stadiumGate(state, playerId, "levincia")) return false;
  return getPlayer(state, playerId).discard.some((card) => isBasicLightningEnergy(state, card));
}

export function startLevincia(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const options = player.discard
    .filter((card) => isBasicLightningEnergy(state, card))
    .map((card) => card.instanceId);
  state.pendingAction = {
    type: "LEVINCIA",
    playerId,
    options,
    pickedIds: [],
    slotsRemaining: 2,
  };
  logMessage(state, "Levincia: choose up to 2 Basic Lightning Energy from your discard pile.");
}

export function continueLevinciaPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "LEVINCIA" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.discard.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  const pickedIds = [...pending.pickedIds, instanceId];
  const slotsRemaining = pending.slotsRemaining - 1;
  const remainingOptions = pending.options.filter((id) => !pickedIds.includes(id));
  if (slotsRemaining > 0 && remainingOptions.length > 0) {
    state.pendingAction = {
      type: "LEVINCIA",
      playerId,
      options: remainingOptions,
      pickedIds,
      slotsRemaining,
    };
    logMessage(state, `Levincia: added ${getDefinitionSafe(state, card.definitionId).name} to hand.`);
    return;
  }
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(state, `Levincia: finished recovering Basic Lightning Energy.`);
}

export function canUseSpikemuthGym(state: EngineState, playerId: PlayerId): boolean {
  if (!stadiumGate(state, playerId, "spikemuth_gym")) return false;
  return getPlayer(state, playerId).deck.some((card) => isMarniesPokemon(state, card));
}

export function startSpikemuthGym(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const options = player.deck
    .filter((card) => isMarniesPokemon(state, card))
    .map((card) => card.instanceId);
  state.pendingAction = {
    type: "SPIKEMUTH_GYM",
    playerId,
    options,
  };
  logMessage(state, "Spikemuth Gym: choose a Marnie's Pokémon from your deck.");
}

export function resolveSpikemuthGym(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SPIKEMUTH_GYM" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.deck.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  shufflePlayerDeck(state, playerId);
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(
    state,
    `${player.name} searched out ${getDefinitionSafe(state, card.definitionId).name} (Spikemuth Gym).`,
  );
}

export function canUseSurfingBeach(state: EngineState, playerId: PlayerId): boolean {
  if (!stadiumGate(state, playerId, "surfing_beach")) return false;
  const player = getPlayer(state, playerId);
  if (!player.active || !isWaterPokemon(state, player.active)) return false;
  return player.bench.some((pokemon) => isWaterPokemon(state, pokemon));
}

export function startSurfingBeach(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const options = player.bench
    .filter((pokemon) => isWaterPokemon(state, pokemon))
    .map((pokemon) => pokemon.instanceId);
  state.pendingAction = {
    type: "SURFING_BEACH",
    playerId,
    options,
  };
  logMessage(state, "Surfing Beach: choose a Benched Water Pokémon to switch with your Active Pokémon.");
}

export function resolveSurfingBeach(state: EngineState, playerId: PlayerId, benchInstanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SURFING_BEACH" || pending.playerId !== playerId) return;
  if (!pending.options.includes(benchInstanceId)) return;
  const player = getPlayer(state, playerId);
  if (!player.active || !isWaterPokemon(state, player.active)) return;
  const benchIndex = player.bench.findIndex((card) => card.instanceId === benchInstanceId);
  if (benchIndex === -1) return;
  const incoming = player.bench[benchIndex]!;
  if (!isWaterPokemon(state, incoming)) return;
  const outgoing = player.active;
  player.bench[benchIndex] = outgoing;
  outgoing.zone = Zone.Bench;
  incoming.zone = Zone.Active;
  player.active = incoming;
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(
    state,
    `${player.name} switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name} (Surfing Beach).`,
  );
}

export function startMysteryGarden(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const options = player.hand
    .filter((card) => isEnergyCard(getDefinitionSafe(state, card.definitionId)))
    .map((card) => card.instanceId);
  state.pendingAction = {
    type: "MYSTERY_GARDEN",
    playerId,
    options,
  };
  logMessage(state, "Mystery Garden: choose an Energy card from your hand to discard.");
}

export function resolveMysteryGarden(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "MYSTERY_GARDEN" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const energy = player.hand.splice(index, 1)[0]!;
  moveToDiscard(player, energy);
  const targetHand = countPsychicPokemonInPlay(state, playerId);
  const toDraw = Math.max(0, targetHand - player.hand.length);
  const drawn = drawCards(state, playerId, toDraw);
  state.turnFlags.stadiumOncePerTurnUsed = true;
  state.pendingAction = null;
  logMessage(
    state,
    `${player.name} discarded ${getDefinitionSafe(state, energy.definitionId).name} and drew ${drawn} card(s) (Mystery Garden).`,
  );
}
