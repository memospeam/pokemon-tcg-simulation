import type { CardInstance } from "../../models/instance";
import { Zone } from "../../models/enums";
import { shufflePlayerDeck } from "../helpers";
import { getPlayer, type EngineState, type PlayerState } from "../types";
import type { PlayerId } from "../../models/enums";
import { discardPokemonAttachments } from "./toolEffects";

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
