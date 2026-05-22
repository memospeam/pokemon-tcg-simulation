import type { CardDefinition } from "../../models/definition";
import {
  isBasicPokemon,
  isEvolutionPokemon,
  isTeamRocketPokemon,
} from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { drawCards, getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { applyRiskyRuinsOnBenchPlay } from "./stadiumEffects";
import {
  getDefinition,
  getPlayer,
  moveToDiscard,
  type EngineState,
} from "../types";

export type AttachCheck = { ok: true } | { ok: false; reason: string };

export function isEnrichingEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("enriching energy") ?? false;
}

export function isIgnitionEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("ignition energy") ?? false;
}

export function isTelepathicPsychicEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("telepathic psychic energy") ?? false;
}

export function isRockyFightingEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("rocky fighting energy") ?? false;
}

export function isTeamRocketsEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("team rocket's energy") ?? false;
}

export function isLegacyEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("legacy energy") ?? false;
}

export function isJetEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("jet energy") ?? false;
}

export function canAttachSpecialEnergyToPokemon(
  state: EngineState,
  energyDef: CardDefinition,
  pokemon: CardInstance,
): AttachCheck {
  if (isTeamRocketsEnergy(energyDef)) {
    const pokemonDef = getDefinitionSafe(state, pokemon.definitionId);
    if (!isTeamRocketPokemon(pokemonDef)) {
      return {
        ok: false,
        reason: "Team Rocket's Energy can only be attached to Team Rocket's Pokémon.",
      };
    }
  }
  return { ok: true };
}


function deckBasicPsychic(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => {
    const def = getDefinition(state, card.definitionId);
    return (
      def?.supertype === "Pokémon" &&
      isBasicPokemon(def) &&
      (def.types?.includes("Psychic") ?? false)
    );
  });
}

export function onSpecialEnergyAttachedFromHand(
  state: EngineState,
  playerId: PlayerId,
  energy: CardInstance,
  target: CardInstance,
): void {
  const energyDef = getDefinitionSafe(state, energy.definitionId);
  const targetDef = getDefinitionSafe(state, target.definitionId);

  if (isEnrichingEnergy(energyDef)) {
    drawCards(state, playerId, 4);
    logMessage(state, "Enriching Energy: drew 4 cards.");
  }

  if (isTelepathicPsychicEnergy(energyDef) && (targetDef.types?.includes("Psychic") ?? false)) {
    applyTelepathicPsychicBenchSearch(state, playerId);
  }

  if (isJetEnergy(energyDef) && target.zone === Zone.Bench) {
    applyJetEnergySwitch(state, playerId, target.instanceId);
  }
}

function applyJetEnergySwitch(state: EngineState, playerId: PlayerId, benchId: string): void {
  const player = getPlayer(state, playerId);
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === benchId);
  if (benchIndex === -1 || !player.active) return;
  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;
  logMessage(
    state,
    `Jet Energy: ${player.name} switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
}
function applyTelepathicPsychicBenchSearch(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  const matches = deckBasicPsychic(state, playerId);
  if (matches.length === 0) {
    logMessage(state, "Telepathic Psychic Energy: no Basic Psychic Pokémon found in deck.");
    return;
  }
  if (player.bench.length >= 5) {
    logMessage(state, "Telepathic Psychic Energy: Bench is full.");
    return;
  }
  if (matches.length === 1) {
    placeBasicPsychicFromDeck(state, playerId, matches[0]!.instanceId, 2);
    if (!state.pendingAction) shufflePlayerDeck(state, playerId);
    return;
  }
  state.pendingAction = {
    type: "SEARCH_DECK",
    playerId,
    filter: "BASIC_PSYCHIC_BENCH",
    options: matches.map((entry) => entry.instanceId),
    slotsRemaining: 2,
  };
  logMessage(state, "Telepathic Psychic Energy: choose up to 2 Basic Psychic Pokémon for your Bench.");
}

function placeBasicPsychicFromDeck(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
  slotsRemaining = 1,
): void {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;

  const card = player.deck.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);
  if (player.bench.length >= 5) {
    player.deck.unshift(card);
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Bench is full — cannot place more Pokémon.");
    return;
  }

  card.zone = Zone.Bench;
  card.ownerId = playerId;
  card.enteredPlayTurn = state.turnNumber;
  player.bench.push(card);
  applyRiskyRuinsOnBenchPlay(state, card, playerId);
  logMessage(state, `${player.name} placed ${def.name} on the Bench.`);

  if (slotsRemaining > 1 && player.bench.length < 5) {
    const remaining = deckBasicPsychic(state, playerId);
    if (remaining.length > 0) {
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId,
        filter: "BASIC_PSYCHIC_BENCH",
        options: remaining.map((entry) => entry.instanceId),
        slotsRemaining: slotsRemaining - 1,
      };
      logMessage(state, "Telepathic Psychic Energy: choose another Basic Psychic Pokémon (optional).");
      return;
    }
  }

  shufflePlayerDeck(state, playerId);
}

export function resolveBasicPsychicBenchPick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): void {
  const pending = state.pendingAction;
  const slotsRemaining =
    pending?.type === "SEARCH_DECK" && pending.filter === "BASIC_PSYCHIC_BENCH"
      ? (pending.slotsRemaining ?? 1)
      : 1;
  placeBasicPsychicFromDeck(state, playerId, instanceId, slotsRemaining);
  if (state.pendingAction === pending) {
    state.pendingAction = null;
    shufflePlayerDeck(state, playerId);
  }
}

export function discardIgnitionEnergyAtEndOfTurn(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);
  for (const pokemon of [player.active, ...player.bench].filter(Boolean) as CardInstance[]) {
    const remaining: CardInstance[] = [];
    for (const energy of pokemon.attachedEnergy) {
      const def = getDefinition(state, energy.definitionId);
      if (def && isIgnitionEnergy(def)) {
        moveToDiscard(player, energy);
        logMessage(state, "Ignition Energy was discarded at the end of the turn.");
      } else {
        remaining.push(energy);
      }
    }
    pokemon.attachedEnergy = remaining;
  }
}

export function purgeInvalidAttachedSpecialEnergy(state: EngineState, pokemon: CardInstance): void {
  const player = getPlayer(state, pokemon.ownerId);
  const pokemonDef = getDefinitionSafe(state, pokemon.definitionId);
  const remaining: CardInstance[] = [];
  for (const energy of pokemon.attachedEnergy) {
    const energyDef = getDefinition(state, energy.definitionId);
    if (isTeamRocketsEnergy(energyDef) && !isTeamRocketPokemon(pokemonDef)) {
      moveToDiscard(player, energy);
      logMessage(state, "Team Rocket's Energy was discarded.");
      continue;
    }
    remaining.push(energy);
  }
  pokemon.attachedEnergy = remaining;
}

export function getLegacyEnergyPrizeReduction(
  state: EngineState,
  knockedOut: CardInstance,
): number {
  if (!state.turnFlags.attacked) return 0;
  const hasLegacy = knockedOut.attachedEnergy.some((energy) => {
    const def = getDefinition(state, energy.definitionId);
    return def && isLegacyEnergy(def);
  });
  if (!hasLegacy) return 0;
  if (state.legacyEnergyPrizeReductionUsed[knockedOut.ownerId]) return 0;
  state.legacyEnergyPrizeReductionUsed[knockedOut.ownerId] = true;
  logMessage(state, "Legacy Energy: opponent takes 1 fewer Prize card.");
  return 1;
}

export function isProtectedFromAttackEffectsByRockyFightingEnergy(
  state: EngineState,
  defender: CardInstance | null | undefined,
): boolean {
  if (!defender) return false;
  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  if (!(defenderDef.types?.includes("Fighting") ?? false)) return false;
  return defender.attachedEnergy.some((energy) => {
    const def = getDefinition(state, energy.definitionId);
    return def && isRockyFightingEnergy(def);
  });
}

export type SpecialEnergyContribution = {
  colors: Record<string, number>;
  rainbow: number;
  flexPsychicDark: number;
};

export function getSpecialEnergyContribution(
  state: EngineState,
  pokemon: CardInstance,
  energy: CardInstance,
): SpecialEnergyContribution {
  const empty = { colors: {}, rainbow: 0, flexPsychicDark: 0 };
  const def = getDefinition(state, energy.definitionId);
  if (!def) return empty;
  const pokemonDef = getDefinition(state, pokemon.definitionId);

  if (isEnrichingEnergy(def)) {
    return { colors: { Colorless: 1 }, rainbow: 0, flexPsychicDark: 0 };
  }
  if (isIgnitionEnergy(def)) {
    const count = pokemonDef && isEvolutionPokemon(pokemonDef) ? 3 : 1;
    return { colors: { Colorless: count }, rainbow: 0, flexPsychicDark: 0 };
  }
  if (isTelepathicPsychicEnergy(def)) {
    return { colors: { Psychic: 1 }, rainbow: 0, flexPsychicDark: 0 };
  }
  if (isRockyFightingEnergy(def)) {
    return { colors: { Fighting: 1 }, rainbow: 0, flexPsychicDark: 0 };
  }
  if (isTeamRocketsEnergy(def)) {
    if (!pokemonDef || !isTeamRocketPokemon(pokemonDef)) return empty;
    return { colors: {}, rainbow: 0, flexPsychicDark: 2 };
  }
  if (isLegacyEnergy(def)) {
    return { colors: {}, rainbow: 1, flexPsychicDark: 0 };
  }

  return empty;
}
