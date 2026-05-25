import {
  getHp,
  isBasicEnergy,
  isColorlessPokemon,
  isItemTrainer,
  isMegaEvolutionEx,
  isTeraPokemon,
} from "../../models/definition";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { canEvolveInto, drawCards, getDefinitionSafe } from "../rules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  moveToDiscard,
  type EngineState,
} from "../types";
import { attachEnergyToPokemon } from "../trainerEffects";
import { applySpecialCondition } from "./stadiumEffects";
import { addFromDeckToHand, deckMatching, finishDeckSearchShuffle } from "./trainerDeckHelpers";
import { evolvePokemonFromDeck } from "./attackFlow";
import type { ParsedEffect } from "./types";
import type { TrainerPlayCheck } from "./trainerPlayCheck";

export type { TrainerPlayCheck } from "./trainerPlayCheck";

function hasTeraInPlay(state: EngineState, playerId: PlayerId): boolean {
  const player = getPlayer(state, playerId);
  return allPokemonInPlay(player).some((pokemon) =>
    isTeraPokemon(getDefinitionSafe(state, pokemon.definitionId)),
  );
}

function deckMegaEvolutionEx(state: EngineState, playerId: PlayerId): CardInstance[] {
  return deckMatching(state, playerId, isMegaEvolutionEx);
}

function discardBasicEnergyFromDeck(
  state: EngineState,
  playerId: PlayerId,
  energyType: string,
): CardInstance | null {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => {
    const def = getDefinition(state, card.definitionId);
    if (!def || !isBasicEnergy(def)) return false;
    const type = energyType.toLowerCase();
    return def.name.toLowerCase().includes(type) || def.types?.some((entry) => entry.toLowerCase() === type);
  });
  if (index === -1) return null;
  return player.deck.splice(index, 1)[0] ?? null;
}

function pokemonHasNoAbilities(def: CardDefinition): boolean {
  return !def.abilities?.length;
}

function salvatoreMatches(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  const inPlay = allPokemonInPlay(player);
  return player.deck.filter((card) => {
    const evoDef = getDefinition(state, card.definitionId);
    if (!evoDef || evoDef.supertype !== "Pokémon" || !evoDef.evolvesFrom || !pokemonHasNoAbilities(evoDef)) {
      return false;
    }
    return inPlay.some((target) => {
      const targetDef = getDefinitionSafe(state, target.definitionId);
      return canEvolveInto(targetDef, evoDef) || evoDef.evolvesFrom === targetDef.name;
    });
  });
}

export function canPlayTrainerBatch10Kind(
  state: EngineState,
  playerId: PlayerId,
  kind: ParsedEffect["kind"],
): TrainerPlayCheck {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  switch (kind) {
    case "trainer_mega_signal":
      if (deckMegaEvolutionEx(state, playerId).length === 0) {
        return { ok: false, reason: "Mega Signal: no Mega Evolution Pokémon ex in deck." };
      }
      return { ok: true };
    case "trainer_eri":
      if (!opponent.hand.some((card) => isItemTrainer(getDefinitionSafe(state, card.definitionId)))) {
        return { ok: false, reason: "Eri: opponent has no Item cards in hand." };
      }
      return { ok: true };
    case "trainer_carmine":
      return { ok: true };
    case "trainer_crispin_sv":
      return { ok: true };
    case "trainer_janine_secret_art": {
      const darkness = allPokemonInPlay(player).filter((pokemon) =>
        getDefinitionSafe(state, pokemon.definitionId).types?.includes("Darkness"),
      );
      if (darkness.length === 0) {
        return { ok: false, reason: "Janine's Secret Art: no Darkness Pokémon in play." };
      }
      const hasEnergy = getPlayer(state, playerId).deck.some((card) => {
        const def = getDefinition(state, card.definitionId);
        if (!def || !isBasicEnergy(def)) return false;
        return def.name.toLowerCase().includes("darkness") || def.types?.includes("Darkness");
      });
      if (!hasEnergy) {
        return { ok: false, reason: "Janine's Secret Art: no Basic Darkness Energy in deck." };
      }
      return { ok: true };
    }
    case "trainer_glass_trumpet":
      if (!hasTeraInPlay(state, playerId)) {
        return { ok: false, reason: "Glass Trumpet: requires a Tera Pokémon in play." };
      }
      if (!player.bench.some((pokemon) => isColorlessPokemon(getDefinitionSafe(state, pokemon.definitionId)))) {
        return { ok: false, reason: "Glass Trumpet: no Benched Colorless Pokémon." };
      }
      if (!player.discard.some((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)))) {
        return { ok: false, reason: "Glass Trumpet: no Basic Energy in discard." };
      }
      return { ok: true };
    case "trainer_bianca_devotion":
      if (
        !allPokemonInPlay(player).some((pokemon) => {
          const def = getDefinitionSafe(state, pokemon.definitionId);
          return getHp(def) - pokemon.damageCounters <= 30;
        })
      ) {
        return { ok: false, reason: "Bianca's Devotion: no Pokémon with 30 HP or less remaining." };
      }
      return { ok: true };
    case "trainer_explorers_guidance":
      if (player.deck.length < 2) {
        return { ok: false, reason: "Explorer's Guidance: not enough cards in deck." };
      }
      return { ok: true };
    case "trainer_mortys_conviction":
      if (player.hand.length < 2) {
        return { ok: false, reason: "Morty's Conviction: discard another card from your hand to play." };
      }
      return { ok: true };
    case "trainer_salvatore":
      if (salvatoreMatches(state, playerId).length === 0) {
        return { ok: false, reason: "Salvatore: no eligible evolution in deck." };
      }
      return { ok: true };
    case "trainer_perrin":
      if (
        player.hand.filter((card) => getDefinitionSafe(state, card.definitionId).supertype === "Pokémon").length ===
          0 ||
        deckMatching(state, playerId, (def) => def.supertype === "Pokémon").length === 0
      ) {
        return { ok: false, reason: "Perrin: need Pokémon in hand and deck." };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function applyTrainerBatch10Kind(state: EngineState, playerId: PlayerId, effect: ParsedEffect): void {
  switch (effect.kind) {
    case "trainer_mega_signal": {
      const matches = deckMegaEvolutionEx(state, playerId);
      if (matches.length === 0) {
        shufflePlayerDeck(state, playerId);
        logMessage(state, "Mega Signal: no Mega Evolution Pokémon ex found.");
        return;
      }
      if (matches.length === 1) {
        addFromDeckToHand(state, playerId, matches[0]!.instanceId, "Mega Signal", "revealed");
        finishDeckSearchShuffle(state, playerId, "Mega Signal");
        return;
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId,
        filter: "MEGA_EVOLUTION_EX_HAND",
        options: matches.map((entry) => entry.instanceId),
      };
      logMessage(state, "Mega Signal: choose a Mega Evolution Pokémon ex from your deck.");
      return;
    }
    case "trainer_eri": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const items = opponent.hand.filter((card) =>
        isItemTrainer(getDefinitionSafe(state, card.definitionId)),
      );
      if (items.length === 0) {
        logMessage(state, "Eri: opponent has no Item cards in hand.");
        return;
      }
      if (items.length <= 2) {
        for (const card of items) {
          const index = opponent.hand.findIndex((entry) => entry.instanceId === card.instanceId);
          if (index === -1) continue;
          opponent.hand.splice(index, 1);
          moveToDiscard(opponent, card);
        }
        logMessage(state, `Eri discarded ${items.length} Item card(s) from opponent's hand.`);
        return;
      }
      state.pendingAction = {
        type: "ERI_DISCARD",
        playerId,
        options: items.map((entry) => entry.instanceId),
        slotsRemaining: 2,
        pickedIds: [],
      };
      logMessage(state, "Eri: choose up to 2 Item cards to discard from opponent's hand.");
      return;
    }
    case "trainer_carmine": {
      const player = getPlayer(state, playerId);
      for (const card of [...player.hand]) {
        card.zone = Zone.Discard;
        player.discard.push(card);
      }
      player.hand = [];
      drawCards(state, playerId, 5);
      logMessage(state, `${player.name} discarded their hand and drew 5 cards (Carmine).`);
      return;
    }
    case "trainer_crispin_sv": {
      applyCrispinSV(state, playerId);
      return;
    }
    case "trainer_janine_secret_art": {
      const player = getPlayer(state, playerId);
      const darkness = allPokemonInPlay(player).filter((pokemon) =>
        getDefinitionSafe(state, pokemon.definitionId).types?.includes("Darkness"),
      );
      if (darkness.length === 0) {
        logMessage(state, "Janine's Secret Art: no Darkness Pokémon in play.");
        return;
      }
      if (darkness.length === 1) {
        applyJanineAttach(state, playerId, darkness[0]!.instanceId);
        return;
      }
      state.pendingAction = {
        type: "JANINE_DARKNESS",
        playerId,
        options: darkness.map((entry) => entry.instanceId),
        slotsRemaining: 2,
        pickedIds: [],
      };
      logMessage(state, "Janine's Secret Art: choose up to 2 Darkness Pokémon.");
      return;
    }
    case "trainer_glass_trumpet": {
      const player = getPlayer(state, playerId);
      const bench = player.bench.filter((pokemon) =>
        isColorlessPokemon(getDefinitionSafe(state, pokemon.definitionId)),
      );
      if (bench.length === 0) {
        logMessage(state, "Glass Trumpet: no Benched Colorless Pokémon.");
        return;
      }
      if (bench.length === 1) {
        applyGlassTrumpetAttach(state, playerId, bench[0]!.instanceId);
        return;
      }
      state.pendingAction = {
        type: "GLASS_TRUMPET",
        playerId,
        options: bench.map((entry) => entry.instanceId),
        slotsRemaining: 2,
        pickedIds: [],
      };
      logMessage(state, "Glass Trumpet: choose up to 2 Benched Colorless Pokémon.");
      return;
    }
    case "trainer_bianca_devotion": {
      const player = getPlayer(state, playerId);
      const eligible = allPokemonInPlay(player).filter((pokemon) => {
        const def = getDefinitionSafe(state, pokemon.definitionId);
        return getHp(def) - pokemon.damageCounters <= 30;
      });
      if (eligible.length === 0) {
        logMessage(state, "Bianca's Devotion: no eligible Pokémon.");
        return;
      }
      if (eligible.length === 1) {
        eligible[0]!.damageCounters = 0;
        logMessage(
          state,
          `Bianca's Devotion healed all damage from ${getDefinitionSafe(state, eligible[0]!.definitionId).name}.`,
        );
        return;
      }
      state.pendingAction = {
        type: "BIANCA_HEAL",
        playerId,
        options: eligible.map((entry) => entry.instanceId),
      };
      logMessage(state, "Bianca's Devotion: choose a Pokémon with 30 HP or less remaining.");
      return;
    }
    case "trainer_explorers_guidance": {
      const player = getPlayer(state, playerId);
      const topIds = player.deck.slice(0, Math.min(6, player.deck.length)).map((entry) => entry.instanceId);
      if (topIds.length <= 2) {
        for (const id of topIds) {
          const index = player.deck.findIndex((entry) => entry.instanceId === id);
          if (index === -1) continue;
          const card = player.deck.splice(index, 1)[0]!;
          card.zone = Zone.Hand;
          player.hand.push(card);
        }
        shufflePlayerDeck(state, playerId);
        logMessage(state, "Explorer's Guidance: added top cards to hand.");
        return;
      }
      state.pendingAction = {
        type: "EXPLORERS_GUIDANCE",
        playerId,
        options: topIds,
        slotsRemaining: 2,
        pickedIds: [],
        revealPool: topIds,
      };
      logMessage(state, "Explorer's Guidance: choose 2 of the top 6 cards to keep.");
      return;
    }
    case "trainer_mortys_conviction": {
      const player = getPlayer(state, playerId);
      const discardCandidates = player.hand.filter((card) => card.zone === Zone.Hand);
      if (discardCandidates.length < 2) {
        logMessage(state, "Morty's Conviction: need another card to discard.");
        return;
      }
      state.pendingAction = {
        type: "MORTY_DISCARD",
        playerId,
        options: discardCandidates.map((entry) => entry.instanceId),
      };
      logMessage(state, "Morty's Conviction: discard a card from your hand.");
      return;
    }
    case "trainer_salvatore": {
      const matches = salvatoreMatches(state, playerId);
      if (matches.length === 0) {
        shufflePlayerDeck(state, playerId);
        logMessage(state, "Salvatore: no eligible evolution in deck.");
        return;
      }
      if (matches.length === 1) {
        startSalvatoreEvolve(state, playerId, matches[0]!.instanceId);
        return;
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId,
        filter: "SALVATORE_EVOLUTION",
        options: matches.map((entry) => entry.instanceId),
      };
      logMessage(state, "Salvatore: choose an evolution from your deck.");
      return;
    }
    case "trainer_perrin": {
      const player = getPlayer(state, playerId);
      const handPokemon = player.hand.filter(
        (card) => getDefinitionSafe(state, card.definitionId).supertype === "Pokémon",
      );
      if (handPokemon.length === 0) {
        logMessage(state, "Perrin: no Pokémon in hand.");
        return;
      }
      state.pendingAction = {
        type: "PERRIN",
        playerId,
        step: "HAND",
        options: handPokemon.map((entry) => entry.instanceId),
        pickedIds: [],
        slotsRemaining: Math.min(2, handPokemon.length),
      };
      logMessage(state, "Perrin: choose up to 2 Pokémon from your hand to shuffle into your deck.");
      return;
    }
    default:
      return;
  }
}

export function applyJanineAttach(state: EngineState, playerId: PlayerId, pokemonId: string): void {
  const player = getPlayer(state, playerId);
  const pokemon =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return;

  const energy = discardBasicEnergyFromDeck(state, playerId, "Darkness");
  if (!energy) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Janine's Secret Art: no Basic Darkness Energy in deck.");
    return;
  }
  attachEnergyToPokemon(state, playerId, energy, pokemon);
  shufflePlayerDeck(state, playerId);
  if (player.active?.instanceId === pokemonId) {
    applySpecialCondition(state, pokemon, "Poisoned");
    logMessage(state, "Janine's Secret Art: Active Pokémon is now Poisoned.");
  }
}

export function applyGlassTrumpetAttach(state: EngineState, playerId: PlayerId, pokemonId: string): void {
  const player = getPlayer(state, playerId);
  const pokemon = player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!pokemon) return;
  const energyIndex = player.discard.findIndex((card) =>
    isBasicEnergy(getDefinitionSafe(state, card.definitionId)),
  );
  if (energyIndex === -1) {
    logMessage(state, "Glass Trumpet: no Basic Energy in discard.");
    return;
  }
  const energy = player.discard.splice(energyIndex, 1)[0]!;
  attachEnergyToPokemon(state, playerId, energy, pokemon);
  logMessage(state, "Glass Trumpet: attached Basic Energy from discard.");
}

export function startSalvatoreEvolve(state: EngineState, playerId: PlayerId, evolutionId: string): void {
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((card) => card.instanceId === evolutionId);
  if (index === -1) return;
  const evoCard = player.deck[index]!;
  const evoDef = getDefinitionSafe(state, evoCard.definitionId);
  const targets = allPokemonInPlay(player).filter((target) => {
    const targetDef = getDefinitionSafe(state, target.definitionId);
    return canEvolveInto(targetDef, evoDef) || evoDef.evolvesFrom === targetDef.name;
  });
  if (targets.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Salvatore: no valid Pokémon to evolve.");
    return;
  }
  if (targets.length === 1) {
    evolvePokemonFromDeck(state, playerId, targets[0]!.instanceId, evolutionId);
    shufflePlayerDeck(state, playerId);
    state.pendingAction = null;
    logMessage(state, "Salvatore: evolved Pokémon from deck.");
    return;
  }
  state.pendingAction = {
    type: "SALVATORE_EVOLVE",
    playerId,
    evolutionId,
    options: targets.map((entry) => entry.instanceId),
  };
  logMessage(state, "Salvatore: choose a Pokémon to evolve.");
}

export function finishMortysConviction(state: EngineState, playerId: PlayerId): void {
  const opponent = getPlayer(state, getOpponentId(playerId));
  drawCards(state, playerId, opponent.bench.length);
  logMessage(
    state,
    `Morty's Conviction: drew ${opponent.bench.length} card(s) for each Benched opponent Pokémon.`,
  );
  state.pendingAction = null;
}

export function continueEriDiscardPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "ERI_DISCARD" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const opponent = getPlayer(state, getOpponentId(playerId));
  const index = opponent.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = opponent.hand.splice(index, 1)[0]!;
  moveToDiscard(opponent, card);
  pending.pickedIds.push(instanceId);
  const remaining = opponent.hand.filter(
    (entry) => isItemTrainer(getDefinitionSafe(state, entry.definitionId)) && !pending.pickedIds.includes(entry.instanceId),
  );
  if (pending.pickedIds.length < pending.slotsRemaining && remaining.length > 0) {
    state.pendingAction = {
      ...pending,
      options: remaining.map((entry) => entry.instanceId),
    };
    logMessage(state, "Eri: choose another Item card (optional).");
    return;
  }
  state.pendingAction = null;
}

export function continueJanineDarknessPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "JANINE_DARKNESS" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  applyJanineAttach(state, playerId, instanceId);
  pending.pickedIds.push(instanceId);
  const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
  if (pending.pickedIds.length < pending.slotsRemaining && remaining.length > 0) {
    state.pendingAction = { ...pending, options: remaining };
    logMessage(state, "Janine's Secret Art: choose another Darkness Pokémon (optional).");
    return;
  }
  state.pendingAction = null;
}

export function continueGlassTrumpetPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "GLASS_TRUMPET" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  applyGlassTrumpetAttach(state, playerId, instanceId);
  pending.pickedIds.push(instanceId);
  const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
  if (pending.pickedIds.length < pending.slotsRemaining && remaining.length > 0) {
    state.pendingAction = { ...pending, options: remaining };
    logMessage(state, "Glass Trumpet: choose another Benched Colorless Pokémon (optional).");
    return;
  }
  state.pendingAction = null;
}

export function continueBiancaHealPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "BIANCA_HEAL" || pending.playerId !== playerId) return;
  const player = getPlayer(state, playerId);
  const pokemon =
    player.active?.instanceId === instanceId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === instanceId);
  if (!pokemon) return;
  pokemon.damageCounters = 0;
  logMessage(
    state,
    `Bianca's Devotion healed all damage from ${getDefinitionSafe(state, pokemon.definitionId).name}.`,
  );
  state.pendingAction = null;
}

export function continueExplorersGuidancePick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "EXPLORERS_GUIDANCE" || pending.playerId !== playerId) return;
  if (!pending.revealPool.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.deck.findIndex((entry) => entry.instanceId === instanceId);
  if (index === -1) return;
  const card = player.deck.splice(index, 1)[0]!;
  card.zone = Zone.Hand;
  player.hand.push(card);
  pending.pickedIds.push(instanceId);
  if (pending.pickedIds.length < pending.slotsRemaining) {
    const remaining = pending.revealPool.filter(
      (id) => !pending.pickedIds.includes(id) && player.deck.some((entry) => entry.instanceId === id),
    );
    if (remaining.length > 0) {
      state.pendingAction = { ...pending, options: remaining };
      logMessage(state, "Explorer's Guidance: choose another card.");
      return;
    }
  }
  for (const id of pending.revealPool) {
    if (pending.pickedIds.includes(id)) continue;
    const discardIndex = player.deck.findIndex((entry) => entry.instanceId === id);
    if (discardIndex === -1) continue;
    const discardCard = player.deck.splice(discardIndex, 1)[0]!;
    moveToDiscard(player, discardCard);
  }
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Explorer's Guidance: kept 2 cards and discarded the rest.");
}

export function continueMortyDiscardPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "MORTY_DISCARD" || pending.playerId !== playerId) return;
  const player = getPlayer(state, playerId);
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.hand.splice(index, 1)[0]!;
  moveToDiscard(player, card);
  finishMortysConviction(state, playerId);
}

export function continueSalvatoreEvolvePick(state: EngineState, playerId: PlayerId, targetId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "SALVATORE_EVOLVE" || pending.playerId !== playerId) return;
  evolvePokemonFromDeck(state, playerId, targetId, pending.evolutionId);
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  logMessage(state, "Salvatore: evolved Pokémon from deck.");
}

export function continuePerrinHandPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PERRIN" || pending.step !== "HAND" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  const player = getPlayer(state, playerId);
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index === -1) return;
  const card = player.hand.splice(index, 1)[0]!;
  card.zone = Zone.Deck;
  player.deck.push(card);
  pending.pickedIds.push(instanceId);
  shufflePlayerDeck(state, playerId);
  const remaining = player.hand
    .filter((entry) => getDefinitionSafe(state, entry.definitionId).supertype === "Pokémon")
    .map((entry) => entry.instanceId)
    .filter((id) => !pending.pickedIds.includes(id));
  if (pending.pickedIds.length < pending.slotsRemaining && remaining.length > 0) {
    state.pendingAction = { ...pending, options: remaining };
    logMessage(state, "Perrin: choose another Pokémon to shuffle into your deck (optional).");
    return;
  }
  finishPerrinHandStep(state, playerId);
}

export function finishPerrinHandStep(state: EngineState, playerId: PlayerId): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PERRIN" || pending.step !== "HAND" || pending.playerId !== playerId) return;
  const searchCount = pending.pickedIds.length;
  const deckMatches = deckMatching(state, playerId, (def) => def.supertype === "Pokémon");
  if (searchCount === 0 || deckMatches.length === 0) {
    state.pendingAction = null;
    return;
  }
  state.pendingAction = {
    type: "PERRIN",
    playerId,
    step: "SEARCH",
    options: deckMatches.map((entry) => entry.instanceId),
    pickedIds: [],
    slotsRemaining: Math.min(searchCount, deckMatches.length),
  };
  logMessage(state, `Perrin: search your deck for up to ${searchCount} Pokémon.`);
}

export function continuePerrinSearchPick(state: EngineState, playerId: PlayerId, instanceId: string): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PERRIN" || pending.step !== "SEARCH" || pending.playerId !== playerId) return;
  if (!pending.options.includes(instanceId) || pending.pickedIds.includes(instanceId)) return;
  addFromDeckToHand(state, playerId, instanceId, "Perrin", "revealed");
  pending.pickedIds.push(instanceId);
  const remaining = deckMatching(state, playerId, (def) => def.supertype === "Pokémon").filter(
    (entry) => !pending.pickedIds.includes(entry.instanceId),
  );
  if (pending.pickedIds.length < pending.slotsRemaining && remaining.length > 0) {
    state.pendingAction = {
      ...pending,
      options: remaining.map((entry) => entry.instanceId),
    };
    logMessage(state, "Perrin: choose another Pokémon from your deck.");
    return;
  }
  finishDeckSearchShuffle(state, playerId, "Perrin");
}

function applyCrispinSV(state: EngineState, playerId: PlayerId): void {
  const player = getPlayer(state, playerId);

  // Collect basic energy cards from deck grouped by type
  const energyByType = new Map<string, CardInstance>();
  for (const card of player.deck) {
    const def = getDefinitionSafe(state, card.definitionId);
    if (!isBasicEnergy(def)) continue;
    const type = def.types?.[0] ?? "Colorless";
    if (!energyByType.has(type)) energyByType.set(type, card);
  }

  const types = [...energyByType.keys()];

  if (types.length === 0) {
    shufflePlayerDeck(state, playerId);
    logMessage(state, "Crispin: no Basic Energy found in deck.");
    return;
  }

  // Pull one energy from deck → hand
  const handEnergy = energyByType.get(types[0]!)!;
  const handIdx = player.deck.indexOf(handEnergy);
  player.deck.splice(handIdx, 1);
  handEnergy.zone = Zone.Hand;
  player.hand.push(handEnergy);
  logMessage(
    state,
    `Crispin: put ${getDefinitionSafe(state, handEnergy.definitionId).name} into hand.`,
  );

  if (types.length === 1) {
    // Only one energy type — nothing to attach
    shufflePlayerDeck(state, playerId);
    return;
  }

  // Pull a second energy of a different type → attach to a Pokémon in play
  const attachEnergy = energyByType.get(types[1]!)!;
  const attachIdx = player.deck.indexOf(attachEnergy);
  player.deck.splice(attachIdx, 1);

  const target =
    player.active ??
    player.bench.find(() => true) ??
    null;

  if (!target) {
    // No Pokémon in play — put in hand instead
    attachEnergy.zone = Zone.Hand;
    player.hand.push(attachEnergy);
    logMessage(state, "Crispin: no Pokémon in play — both energies added to hand.");
  } else {
    attachEnergyToPokemon(state, playerId, attachEnergy, target);
    logMessage(
      state,
      `Crispin: attached ${getDefinitionSafe(state, attachEnergy.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
    );
  }

  shufflePlayerDeck(state, playerId);
}
