import type { CardInstance } from "../../models/instance";
import { isPokemonEx } from "../../models/definition";
import { Zone } from "../../models/enums";
import { shufflePlayerDeck } from "../helpers";
import { getDefinitionSafe } from "../rules";
import { getPlayer, type EngineState, type PlayerState } from "../types";
import type { PlayerId } from "../../models/enums";
import { discardPokemonAttachments } from "./toolEffects";
import { getMaxBenchSize } from "./stadiumEffects";

export function removePokemonFromPlay(player: PlayerState, pokemon: CardInstance): void {
  if (player.active?.instanceId === pokemon.instanceId) {
    player.active = null;
    return;
  }
  const benchIndex = player.bench.findIndex((entry) => entry.instanceId === pokemon.instanceId);
  if (benchIndex >= 0) {
    player.bench.splice(benchIndex, 1);
  }
}

export function shufflePokemonAndAttachmentsToDeck(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
): void {
  const player = getPlayer(state, playerId);
  removePokemonFromPlay(player, pokemon);
  pokemon.zone = Zone.Deck;
  for (const energy of pokemon.attachedEnergy) {
    energy.zone = Zone.Deck;
  }
  for (const tool of pokemon.attachedTools ?? []) {
    tool.zone = Zone.Deck;
  }
  player.deck.push(pokemon);
  shufflePlayerDeck(state, playerId);
}

export function returnPokemonToHand(
  state: EngineState,
  playerId: PlayerId,
  pokemon: CardInstance,
): void {
  const player = getPlayer(state, playerId);
  removePokemonFromPlay(player, pokemon);
  discardPokemonAttachments(state, player, pokemon);
  pokemon.zone = Zone.Hand;
  player.hand.push(pokemon);
}

export function markMovedFromBenchToActive(state: EngineState, pokemonId: string): void {
  const ids = state.turnFlags.movedFromBenchToActiveIds ?? [];
  if (!ids.includes(pokemonId)) {
    state.turnFlags.movedFromBenchToActiveIds = [...ids, pokemonId];
  }
}

export function pokemonHasType(
  state: EngineState,
  pokemon: CardInstance,
  typeFilter: string,
): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return def.types?.some((type) => type.toLowerCase() === typeFilter.toLowerCase()) ?? false;
}

export function pokemonIsExcludedByName(
  state: EngineState,
  pokemon: CardInstance,
  excludeName?: string,
): boolean {
  if (!excludeName) return false;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const filter = excludeName.toLowerCase().trim();
  const name = def.name.toLowerCase();
  if (/\bex\b/.test(filter)) {
    const baseName = filter.replace(/\s*ex\s*$/, "").trim();
    return name.includes(baseName) && isPokemonEx(def);
  }
  return name.includes(filter);
}

export function getEligibleTypedBenchPokemon(
  state: EngineState,
  playerId: PlayerId,
  typeFilter: string,
  excludeName?: string,
): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.bench.filter(
    (pokemon) =>
      pokemonHasType(state, pokemon, typeFilter) &&
      !pokemonIsExcludedByName(state, pokemon, excludeName),
  );
}

export function placePokemonFromDiscardToBench(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): CardInstance | null {
  const player = getPlayer(state, playerId);
  if (player.bench.length >= getMaxBenchSize(state, playerId)) return null;
  const index = player.discard.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return null;
  const card = player.discard.splice(index, 1)[0]!;
  const def = getDefinitionSafe(state, card.definitionId);
  if (def.supertype !== "Pokémon") {
    player.discard.push(card);
    return null;
  }
  card.zone = Zone.Bench;
  player.bench.push(card);
  return card;
}
