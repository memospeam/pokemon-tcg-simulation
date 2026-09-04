import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { isBasicEnergy, isBasicPokemon, isColorlessPokemon, isStadium, isSupporter } from "../../models/definition";
import { getHp } from "../../models/definition";
import { PlayerId, Zone } from "../../models/enums";
import { applyWeaknessAndResistance, canEvolveInto, countPrizeCards, drawCards, getDefinitionSafe } from "../rules";
import { canReceiveBenchAttackDamage } from "./pokemonRules";
import { flipCoin, logMessage, shufflePlayerDeck } from "../helpers";
import { createRng } from "../rng";
import {
  allPokemonInPlay,
  getDefinition,
  getOpponentId,
  getPlayer,
  isKnockedOut,
  moveToDiscard,
  type EngineState,
} from "../types";
import { discardAttachedEnergy, attachEnergyToPokemon } from "../trainerEffects";
import { discardPokemonAttachments } from "./toolEffects";
import {
  getEligibleTypedBenchPokemon,
  markMovedFromBenchToActive,
  placePokemonFromDiscardToBench,
  pokemonIsExcludedByName,
  returnPokemonToHand,
  shufflePokemonAndAttachmentsToDeck,
} from "./pokemonZoneHelpers";
import { pokemonMatchesNameFilter, evolvePokemonFromDeck } from "./attackFlow";
import { devolveEachOpponentEvolved } from "./devolutionEffects";
import { applySpecialCondition, getMaxBenchSize } from "./stadiumEffects";
import { returnNitroFireAfterSelfAttackDiscard } from "./specialEnergyEffects";
import type { EffectContext, ParsedEffect } from "./types";
import { countersToDamage } from "./types";
import { executeBulk8Effect } from "./executeBulk8";

function matchesDeckBasicEnergyType(def: CardDefinition, energyType: string): boolean {
  if (!isBasicEnergy(def)) return false;
  if (energyType.toLowerCase() === "any") return true;
  const type = energyType.toLowerCase();
  return def.name.toLowerCase().includes(type) || (def.types?.some((entry) => entry.toLowerCase() === type) ?? false);
}

function searchAttachEnergyFromDeck(
  state: EngineState,
  ctx: EffectContext,
  effect: Extract<ParsedEffect, { kind: "search_attach_energy_any" | "search_attach_energy_typed" }>,
): ExecuteResult {
  const player = selfPlayer(state, ctx);
  const energyType = effect.kind === "search_attach_energy_any" ? "any" : effect.energyType;
  const targets =
    effect.kind === "search_attach_energy_typed" && effect.target === "benched"
      ? player.bench
      : allPokemonInPlay(player);

  if (targets.length === 0) {
    shufflePlayerDeck(state, ctx.playerId);
    logMessage(state, "No Pokémon in play to attach searched Energy to.");
    return "complete";
  }

  const matches = player.deck
    .filter((card) => {
      const def = getDefinition(state, card.definitionId);
      return def && matchesDeckBasicEnergyType(def, energyType);
    })
    .slice(0, effect.count);

  if (matches.length === 0) {
    shufflePlayerDeck(state, ctx.playerId);
    logMessage(state, "No matching Basic Energy found in deck.");
    return "complete";
  }

  let attached = 0;
  for (const match of matches) {
    const index = player.deck.findIndex((card) => card.instanceId === match.instanceId);
    if (index === -1) continue;
    const energy = player.deck.splice(index, 1)[0]!;
    const target = targets[attached % targets.length]!;
    attachEnergyToPokemon(state, ctx.playerId, energy, target);
    attached += 1;
  }

  shufflePlayerDeck(state, ctx.playerId);
  logMessage(
    state,
    `Attached ${attached} Basic ${energyType === "any" ? "" : `${energyType} `}Energy from deck.`,
  );
  return "complete";
}

export type ExecuteResult = "complete" | "pending" | "failed";

function moveEnergyBetweenPokemon(
  state: EngineState,
  source: CardInstance,
  target: CardInstance,
  energyId: string,
): void {
  const index = source.attachedEnergy.findIndex((entry) => entry.instanceId === energyId);
  if (index === -1) return;
  const energy = source.attachedEnergy.splice(index, 1)[0]!;
  energy.zone = target.zone;
  target.attachedEnergy.push(energy);
  logMessage(
    state,
    `Moved ${getDefinitionSafe(state, energy.definitionId).name} from ${getDefinitionSafe(state, source.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );
}

function applyDamageAmount(
  state: EngineState,
  pokemon: CardInstance,
  amount: number,
  attackerTypes: string[] | undefined,
  applyWeaknessRes: boolean,
): void {
  if (amount <= 0) return;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  const damage = applyWeaknessRes
    ? applyWeaknessAndResistance(amount, attackerTypes, def)
    : amount;
  pokemon.damageCounters += damage;
}

function getAttackerTypes(state: EngineState, ctx: EffectContext): string[] | undefined {
  return getDefinition(state, ctx.sourcePokemon.definitionId)?.types;
}

function opponentPlayer(state: EngineState, ctx: EffectContext) {
  return getPlayer(state, ctx.opponentId);
}

function selfPlayer(state: EngineState, ctx: EffectContext) {
  return getPlayer(state, ctx.playerId);
}

function performBenchToActiveSwitch(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
  applyStatus?: string,
): boolean {
  const player = getPlayer(state, playerId);
  if (!player.active) return false;
  const benchIndex = player.bench.findIndex((card) => card.instanceId === benchInstanceId);
  if (benchIndex === -1) return false;

  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;
  markMovedFromBenchToActive(state, incoming.instanceId);
  if (applyStatus) {
    applySpecialCondition(state, incoming, applyStatus);
  }
  logMessage(
    state,
    `Switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  if (applyStatus) {
    logMessage(state, `${getDefinitionSafe(state, incoming.definitionId).name} is now ${applyStatus}.`);
  }
  return true;
}

function executeSingleEffect(
  state: EngineState,
  ctx: EffectContext,
  effect: ParsedEffect,
): ExecuteResult {
  const attackerTypes = getAttackerTypes(state, ctx);

  const bulk8Result = executeBulk8Effect(state, ctx, effect);
  if (bulk8Result !== null) return bulk8Result;

  switch (effect.kind) {
    case "damage": {
      const opponent = opponentPlayer(state, ctx);
      if (effect.target === "opponent_active" && opponent.active) {
        applyDamageAmount(state, opponent.active, effect.amount, attackerTypes, effect.applyWeaknessRes);
        logMessage(state, `${effect.amount} damage to Active Pokémon.`);
        return "complete";
      }
      if (effect.target === "opponent_bench_each") {
        for (const bench of opponent.bench) {
          if (!canReceiveBenchAttackDamage(state, bench, ctx.playerId)) continue;
          bench.damageCounters += effect.amount;
        }
        logMessage(state, `${effect.amount} damage to each Benched Pokémon.`);
        return "complete";
      }
      if (effect.target === "your_pokemon") {
        const player = selfPlayer(state, ctx);
        for (const pokemon of allPokemonInPlay(player)) {
          pokemon.damageCounters += effect.amount;
        }
        logMessage(state, `${effect.amount} damage to each of your Pokémon.`);
        return "complete";
      }
      if (effect.target === "opponent_bench_choose") {
        if (opponent.bench.length === 0) return "complete";
        state.pendingAction = {
          type: "CHOOSE_BENCH_DAMAGE",
          playerId: ctx.playerId,
          amount: effect.amount,
          options: opponent.bench
            .filter((b) => canReceiveBenchAttackDamage(state, b, ctx.playerId))
            .map((b) => b.instanceId),
          attackName: ctx.attackName,
        };
        logMessage(state, "Choose a Benched Pokémon to damage.");
        return "pending";
      }
      if (effect.target === "opponent_pokemon_choose") {
        const options = [
          ...(opponent.active ? [opponent.active.instanceId] : []),
          ...opponent.bench.map((entry) => entry.instanceId),
        ];
        if (options.length === 0) return "complete";
        if (options.length === 1) {
          const target =
            opponent.active?.instanceId === options[0]
              ? opponent.active
              : opponent.bench.find((entry) => entry.instanceId === options[0]);
          if (target) {
            target.damageCounters += effect.amount;
            logMessage(
              state,
              `${effect.amount} damage to ${getDefinitionSafe(state, target.definitionId).name}.`,
            );
          }
          return "complete";
        }
        state.pendingAction = {
          type: "CHOOSE_OPPONENT_POKEMON_DAMAGE",
          playerId: ctx.playerId,
          amount: effect.amount,
          options,
          attackName: ctx.attackName,
        };
        logMessage(state, "Choose 1 of your opponent's Pokémon to damage.");
        return "pending";
      }
      return "complete";
    }

    case "distribute_bench_counters": {
      const opponent = opponentPlayer(state, ctx);
      const eligible = opponent.bench.filter((b) => canReceiveBenchAttackDamage(state, b, ctx.playerId));
      if (eligible.length === 0 || effect.counters <= 0) return "complete";
      state.pendingAction = {
        type: "DISTRIBUTE_BENCH_DAMAGE",
        playerId: ctx.playerId,
        countersRemaining: effect.counters,
        attackName: ctx.attackName,
      };
      logMessage(
        state,
        `Place ${effect.counters} damage counters (${countersToDamage(effect.counters)} damage) on opponent's Bench.`,
      );
      return "pending";
    }

    case "draw": {
      const drawn = drawCards(state, ctx.playerId, effect.count);
      ctx.cardsDrawnThisSequence = (ctx.cardsDrawnThisSequence ?? 0) + drawn;
      return "complete";
    }

    case "status": {
      const opponent = opponentPlayer(state, ctx);
      const target =
        effect.target === "opponent_active" ? opponent.active : ctx.sourcePokemon;
      if (target && applySpecialCondition(state, target, effect.status)) {
        logMessage(state, `${effect.target === "self_active" ? "This" : "Opponent's Active"} Pokémon is now ${effect.status}.`);
      }
      return "complete";
    }

    case "no_weakness_next_opponent_turn": {
      ctx.sourcePokemon.noWeaknessNextOpponentTurn = "pending";
      logMessage(state, "This Pokémon has no Weakness during your opponent's next turn.");
      return "complete";
    }

    case "move_damage": {
      state.pendingAction = {
        type: "MOVE_DAMAGE",
        playerId: ctx.playerId,
        maxCounters: effect.maxCounters,
        step: "SOURCE",
        targetSide: effect.to === "opponent_pokemon" ? "opponent" : "self",
        attackName: ctx.attackName,
      };
      logMessage(state, `Move up to ${effect.maxCounters} damage counters — choose the source Pokémon.`);
      return "pending";
    }

    case "discard_energy": {
      const opponent = opponentPlayer(state, ctx);
      const pokemon = effect.from === "opponent_active" ? opponent.active : selfPlayer(state, ctx).active;
      if (!pokemon || pokemon.attachedEnergy.length === 0) return "complete";
      const targets = pokemon.attachedEnergy.slice(0, effect.count);
      for (const energy of targets) {
        discardAttachedEnergy(state, pokemon.ownerId, pokemon.instanceId, energy.instanceId, false);
      }
      if (effect.from !== "opponent_active") {
        returnNitroFireAfterSelfAttackDiscard(state, pokemon, targets);
      }
      return "complete";
    }

    case "discard_all_energy": {
      const pokemon = selfPlayer(state, ctx).active;
      if (!pokemon || pokemon.attachedEnergy.length === 0) return "complete";
      const targets = [...pokemon.attachedEnergy];
      for (const energy of targets) {
        discardAttachedEnergy(state, pokemon.ownerId, pokemon.instanceId, energy.instanceId, false);
      }
      logMessage(state, "Discarded all Energy from Active Pokémon.");
      returnNitroFireAfterSelfAttackDiscard(state, pokemon, targets);
      return "complete";
    }

    case "self_recoil": {
      ctx.sourcePokemon.damageCounters += effect.amount;
      logMessage(state, `This Pokémon took ${effect.amount} recoil damage.`);
      return "complete";
    }

    case "heal": {
      if (effect.target === "all_yours") {
        const player = selfPlayer(state, ctx);
        for (const pokemon of allPokemonInPlay(player)) {
          pokemon.damageCounters = Math.max(0, pokemon.damageCounters - effect.amount);
        }
        logMessage(state, `Healed ${effect.amount} damage from each of your Pokémon.`);
        return "complete";
      }
      if (effect.target === "all_in_play") {
        for (const playerId of [ctx.playerId, ctx.opponentId] as const) {
          const player = getPlayer(state, playerId);
          for (const pokemon of allPokemonInPlay(player)) {
            pokemon.damageCounters = Math.max(0, pokemon.damageCounters - effect.amount);
          }
        }
        logMessage(state, `Healed ${effect.amount} damage from each Pokémon in play.`);
        return "complete";
      }
      if (effect.target === "your_pokemon_choose") {
        const player = selfPlayer(state, ctx);
        const target =
          allPokemonInPlay(player).find((entry) => entry.damageCounters > 0) ??
          allPokemonInPlay(player)[0];
        if (target) {
          target.damageCounters = Math.max(0, target.damageCounters - effect.amount);
          logMessage(state, `Healed ${effect.amount} damage.`);
        }
        return "complete";
      }
      const active = selfPlayer(state, ctx).active;
      if (active) {
        active.damageCounters = Math.max(0, active.damageCounters - effect.amount);
        logMessage(state, `Healed ${effect.amount} damage.`);
      }
      return "complete";
    }

    case "block_opponent_items_next_turn": {
      state.itemPlayBlockedForPlayerId = ctx.opponentId;
      logMessage(
        state,
        `${getPlayer(state, ctx.opponentId).name} can't play Item cards from their hand on their next turn (Itchy Pollen).`,
      );
      return "complete";
    }

    case "cant_attack_next_owner_turn": {
      ctx.sourcePokemon.cantAttackNextOwnerTurn = "pending";
      logMessage(state, "This Pokémon can't attack during your next turn.");
      return "complete";
    }

    case "cant_retreat_defending_next_turn": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active) {
        opponent.active.cantRetreatNextOpponentTurn = "pending";
        logMessage(state, "Defending Pokémon can't retreat during the opponent's next turn.");
      }
      return "complete";
    }

    case "cant_attack_defending_next_turn": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active) {
        opponent.active.cantAttackNextOwnerTurn = "pending";
        logMessage(state, "Defending Pokémon can't use attacks during its next turn.");
      }
      return "complete";
    }

    case "damage_reduction_passive":
      return "complete";

    case "move_energy_to_bench": {
      const player = selfPlayer(state, ctx);
      const source = ctx.sourcePokemon;
      if (source.attachedEnergy.length === 0 || player.bench.length === 0) {
        return "complete";
      }
      if (player.bench.length === 1) {
        moveEnergyBetweenPokemon(
          state,
          source,
          player.bench[0]!,
          source.attachedEnergy[0]!.instanceId,
        );
        return "complete";
      }
      state.pendingAction = {
        type: "MOVE_ENERGY_TO_BENCH",
        playerId: ctx.playerId,
        sourceId: source.instanceId,
      };
      logMessage(state, "Choose a Benched Pokémon to move Energy to.");
      return "pending";
    }

    case "draw_until_hand": {
      const player = selfPlayer(state, ctx);
      if (player.hand.length >= effect.targetCount || player.deck.length === 0) {
        return "complete";
      }
      if (effect.optional) {
        state.pendingAction = {
          type: "DRAW_UNTIL_HAND",
          playerId: ctx.playerId,
          targetCount: effect.targetCount,
          optional: true,
          attackName: ctx.attackName,
        };
        logMessage(
          state,
          `You may draw until you have ${effect.targetCount} cards in your hand.`,
        );
        return "pending";
      }
      return performDrawUntilHand(state, ctx.playerId, effect.targetCount);
    }

    case "discard_random_opponent_hand": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.hand.length === 0) return "complete";
      state.rngSeed += 1;
      const rng = createRng(state.rngSeed + opponent.hand.length);
      const index = Math.floor(rng.next() * opponent.hand.length);
      const card = opponent.hand.splice(index, 1)[0]!;
      moveToDiscard(opponent, card);
      logMessage(
        state,
        `${getPlayer(state, ctx.opponentId).name} discarded a random card (${getDefinitionSafe(state, card.definitionId).name}).`,
      );
      return "complete";
    }

    case "mill_opponent_deck": {
      const opponent = opponentPlayer(state, ctx);
      for (let i = 0; i < effect.count; i += 1) {
        const card = opponent.deck.shift();
        if (!card) break;
        moveToDiscard(opponent, card);
        logMessage(
          state,
          `${getPlayer(state, ctx.opponentId).name}'s deck lost ${getDefinitionSafe(state, card.definitionId).name}.`,
        );
      }
      return "complete";
    }

    case "discard_opponent_tools":
      logMessage(state, "Discarded Pokémon Tools from opponent's Active (no Tool cards in sim).");
      return "complete";

    case "damage_reduction_next_opponent_turn": {
      ctx.sourcePokemon.damageReductionPending = effect.amount;
      logMessage(
        state,
        `This Pokémon takes ${effect.amount} less damage from attacks during your opponent's next turn.`,
      );
      return "complete";
    }

    case "prevent_damage_effects_next_opponent_turn": {
      ctx.sourcePokemon.preventDamageEffectsNextOpponentTurn = "pending";
      logMessage(
        state,
        "This Pokémon is protected from attack damage and effects during your opponent's next turn.",
      );
      return "complete";
    }

    case "switch_opponent_active_to_bench": {
      const opponent = opponentPlayer(state, ctx);
      if (!opponent.active) return "complete";
      if (opponent.bench.length >= 5) {
        logMessage(state, "Opponent's Bench is full — cannot switch out Active Pokémon.");
        return "complete";
      }
      const outgoing = opponent.active;
      outgoing.zone = Zone.Bench;
      opponent.bench.push(outgoing);
      opponent.active = null;
      state.pendingAction = { type: "PROMOTE", playerId: ctx.opponentId };
      logMessage(
        state,
        `${getPlayer(state, ctx.opponentId).name} must choose a new Active Pokémon.`,
      );
      return "pending";
    }

    case "switch_with_bench": {
      const player = selfPlayer(state, ctx);
      if (player.bench.length === 0) return "complete";
      state.pendingAction = { type: "SWITCH_WITH_BENCH", playerId: ctx.playerId };
      logMessage(state, "Choose a Benched Pokémon to switch with Active.");
      return "pending";
    }

    case "search_basic_to_bench": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def?.supertype === "Pokémon" && isBasicPokemon(def);
      });
      if (matches.length === 0) {
        logMessage(state, "No Basic Pokémon found in deck.");
        return "complete";
      }
      const slots = Math.min(effect.count, 5 - player.bench.length);
      if (slots <= 0) {
        logMessage(state, "Bench is full.");
        return "complete";
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "BASIC_BENCH",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: slots,
      };
      logMessage(state, `Search your deck for up to ${slots} Basic Pokémon for your Bench.`);
      return "pending";
    }

    case "optional_switch_with_bench": {
      const player = selfPlayer(state, ctx);
      if (player.bench.length === 0) return "complete";
      state.pendingAction = { type: "SWITCH_WITH_BENCH", playerId: ctx.playerId, optional: true };
      logMessage(state, "You may switch with a Benched Pokémon (optional).");
      return "pending";
    }

    case "search_basic_energy_to_hand": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def && isBasicEnergy(def);
      });
      if (matches.length === 0) {
        logMessage(state, "No Basic Energy found in deck.");
        return "complete";
      }
      const slots = Math.min(effect.count, matches.length);
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "BASIC_ENERGY_HAND",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: slots,
      };
      logMessage(state, `Search your deck for up to ${slots} Basic Energy.`);
      return "pending";
    }

    case "search_pokemon_to_hand": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def?.supertype === "Pokémon";
      });
      if (matches.length === 0) {
        logMessage(state, "No Pokémon found in deck.");
        return "complete";
      }
      const slots = Math.min(effect.count ?? 1, matches.length);
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "ANY_POKEMON",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: effect.count ? slots : undefined,
      };
      logMessage(state, `Search your deck for ${effect.count ? `up to ${slots}` : "a"} Pokémon.`);
      return "pending";
    }

    case "search_named_pokemon_to_hand": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def?.supertype === "Pokémon" && pokemonMatchesNameFilter(state, card, effect.nameFilter);
      });
      if (matches.length === 0) {
        logMessage(state, `No ${effect.nameFilter} Pokémon found in deck.`);
        shufflePlayerDeck(state, ctx.playerId);
        return "complete";
      }
      if (matches.length === 1) {
        const card = player.deck.splice(
          player.deck.findIndex((entry) => entry.instanceId === matches[0]!.instanceId),
          1,
        )[0]!;
        card.zone = Zone.Hand;
        player.hand.push(card);
        shufflePlayerDeck(state, ctx.playerId);
        logMessage(
          state,
          `${player.name} added ${getDefinitionSafe(state, card.definitionId).name} to their hand.`,
        );
        return "complete";
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "ANY_POKEMON",
        options: matches.map((entry) => entry.instanceId),
      };
      logMessage(state, `Search your deck for a ${effect.nameFilter} Pokémon.`);
      return "pending";
    }

    case "redistribute_opponent_counters": {
      const opponent = opponentPlayer(state, ctx);
      const inPlay = allPokemonInPlay(opponent);
      if (inPlay.length < 2 || !inPlay.some((pokemon) => pokemon.damageCounters > 0)) {
        return "complete";
      }
      state.pendingAction = {
        type: "REDISTRIBUTE_OPPONENT_COUNTERS",
        playerId: ctx.playerId,
        step: "SOURCE",
        optional: effect.optional,
        attackName: ctx.attackName,
      };
      logMessage(state, "Choose an opponent's Pokémon to move damage counters from.");
      return "pending";
    }

    case "search_typed_pokemon_max_hp_to_hand": {
      const player = selfPlayer(state, ctx);
      const typeFilter = effect.typeFilter;
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        if (def?.supertype !== "Pokémon") return false;
        if (typeFilter === "Colorless" && !isColorlessPokemon(def)) return false;
        else if (!(def.types?.some((t) => t.toLowerCase() === typeFilter.toLowerCase()) ?? false)) return false;
        return getHp(def) <= effect.maxHp;
      });
      if (matches.length === 0) {
        logMessage(state, `No ${typeFilter} Pokémon with ${effect.maxHp} HP or less found in deck.`);
        shufflePlayerDeck(state, ctx.playerId);
        return "complete";
      }
      const slots = Math.min(effect.count, matches.length);
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "TYPED_POKEMON_MAX_HP_HAND",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: slots,
        searchMeta: { typeFilter, maxHp: effect.maxHp },
      };
      logMessage(
        state,
        `Search your deck for up to ${slots} ${typeFilter} Pokémon with ${effect.maxHp} HP or less.`,
      );
      return "pending";
    }

    case "search_named_pokemon_to_bench": {
      const player = selfPlayer(state, ctx);
      const filter = effect.nameFilter.toLowerCase();
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def?.supertype === "Pokémon" && def.name.toLowerCase().includes(filter);
      });
      if (matches.length === 0) {
        logMessage(state, `No Pokémon with "${effect.nameFilter}" in their name found in deck.`);
        shufflePlayerDeck(state, ctx.playerId);
        return "complete";
      }
      if (player.bench.length >= 5) {
        logMessage(state, "Bench is full.");
        shufflePlayerDeck(state, ctx.playerId);
        return "complete";
      }
      const slots = Math.min(matches.length, 5 - player.bench.length);
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "NAMED_POKEMON_BENCH",
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: slots,
        searchMeta: { nameFilter: effect.nameFilter },
      };
      logMessage(
        state,
        `Search your deck for Pokémon with "${effect.nameFilter}" in their name (up to ${slots} for Bench).`,
      );
      return "pending";
    }

    case "discard_stadium": {
      if (state.stadium) {
        const owner = getPlayer(state, state.stadiumOwnerId ?? ctx.playerId);
        moveToDiscard(owner, state.stadium);
        state.stadium = null;
        state.stadiumOwnerId = null;
        logMessage(state, "Discarded the Stadium in play.");
      }
      return "complete";
    }

    case "damage_choose_opponent": {
      const opponent = opponentPlayer(state, ctx);
      const candidates = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ];
      if (candidates.length === 0) return "complete";
      if (candidates.length === 1) {
        applyDamageAmount(
          state,
          candidates[0]!,
          effect.amount,
          attackerTypes,
          effect.applyWeaknessRes,
        );
        return "complete";
      }
      state.pendingAction = {
        type: "DAMAGE_TWO_OPPONENT",
        playerId: ctx.playerId,
        amount: effect.amount,
        picksRemaining: 1,
        pickedIds: [],
      };
      logMessage(state, "Choose 1 of your opponent's Pokémon to damage.");
      return "pending";
    }

    case "opponent_discard_from_hand": {
      const opponent = opponentPlayer(state, ctx);
      const count = effect.count ?? 1;
      for (let i = 0; i < count && opponent.hand.length > 0; i += 1) {
        state.rngSeed += 1;
        const rng = createRng(state.rngSeed + opponent.hand.length + i);
        const index = Math.floor(rng.next() * opponent.hand.length);
        const card = opponent.hand.splice(index, 1)[0]!;
        moveToDiscard(opponent, card);
        logMessage(state, `${opponent.name} discarded ${getDefinitionSafe(state, card.definitionId).name}.`);
      }
      return "complete";
    }

    case "prevent_damage_next_turn": {
      if (effect.filter === "basic") {
        ctx.sourcePokemon.preventDamageFromBasicNonColorless = "pending";
        logMessage(state, "Prevent damage from Basic Pokémon during opponent's next turn.");
      } else if (effect.filter === "coin_heads") {
        ctx.sourcePokemon.preventDamageEffectsNextOpponentTurn = "pending";
        logMessage(state, "Prevent all attack damage during opponent's next turn.");
      }
      return "complete";
    }

    case "defending_attack_damage_reduction": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active) {
        opponent.active.damageReductionPending = effect.amount;
        logMessage(state, `Defending Pokémon's attacks do ${effect.amount} less damage next turn.`);
      }
      return "complete";
    }

    case "poison_enhanced_checkup": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active?.statusConditions.includes("Poisoned")) {
        opponent.active.poisonCounters = effect.counters;
        logMessage(state, `Poisoned — places ${effect.counters} damage counters during Checkup.`);
      }
      return "complete";
    }

    case "discard_special_energy_opponent_all": {
      const opponent = opponentPlayer(state, ctx);
      let discarded = 0;
      for (const pokemon of allPokemonInPlay(opponent)) {
        const toDiscard = pokemon.attachedEnergy.filter((e) => {
          const def = getDefinitionSafe(state, e.definitionId);
          return def.supertype === "Energy" && !def.subtypes.includes("Basic");
        });
        for (const e of toDiscard) {
          pokemon.attachedEnergy.splice(pokemon.attachedEnergy.indexOf(e), 1);
          e.zone = Zone.Discard;
          opponent.discard.push(e);
          discarded++;
        }
      }
      if (discarded > 0) {
        logMessage(state, `Discarded ${discarded} Special Energy card(s) from opponent's Pokémon.`);
      }
      return "complete";
    }

    case "retaliate_damage_counters": {
      logMessage(state, `Retaliate with ${effect.counters} damage counters when damaged (tracked on attack).`);
      return "complete";
    }

    case "damage_choose_opponent_repeat": {
      const opponent = opponentPlayer(state, ctx);
      const target = opponent.active ?? opponent.bench[0];
      if (!target) return "complete";
      target.damageCounters += effect.amount * effect.times;
      logMessage(
        state,
        `${effect.amount} damage to ${getDefinitionSafe(state, target.definitionId).name} × ${effect.times}.`,
      );
      return "complete";
    }

    case "damage_each_damaged_except_self": {
      const player = selfPlayer(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      for (const pokemon of [...allPokemonInPlay(player), ...allPokemonInPlay(opponent)]) {
        if (pokemon.instanceId === ctx.sourcePokemon.instanceId) continue;
        if (pokemon.damageCounters <= 0) continue;
        pokemon.damageCounters += effect.amount;
      }
      logMessage(state, `${effect.amount} damage to each damaged Pokémon (except attacker).`);
      return "complete";
    }

    case "coin_multi_discard_self_energy": {
      const coinCount = effect.coinCount ?? 1;
      let tails = 0;
      for (let i = 0; i < coinCount; i += 1) {
        if (!flipCoin(state)) tails += 1;
      }
      const discarded: CardInstance[] = [];
      for (let i = 0; i < tails * effect.perTails; i += 1) {
        if (ctx.sourcePokemon.attachedEnergy.length === 0) break;
        const energy = ctx.sourcePokemon.attachedEnergy[0]!;
        discardAttachedEnergy(
          state,
          ctx.playerId,
          ctx.sourcePokemon.instanceId,
          energy.instanceId,
          false,
        );
        discarded.push(energy);
      }
      if (tails > 0) {
        logMessage(state, `Discarded ${tails} Energy after ${tails} tail flip(s).`);
      }
      returnNitroFireAfterSelfAttackDiscard(state, ctx.sourcePokemon, discarded);
      return "complete";
    }

    case "coin_multi_discard_random_hand": {
      const opponent = opponentPlayer(state, ctx);
      const coinCount = effect.coinCount ?? 1;
      let heads = 0;
      for (let i = 0; i < coinCount; i += 1) {
        if (flipCoin(state)) heads += 1;
      }
      for (let i = 0; i < heads * effect.perHeads && opponent.hand.length > 0; i += 1) {
        state.rngSeed += 1;
        const rng = createRng(state.rngSeed + opponent.hand.length);
        const index = Math.floor(rng.next() * opponent.hand.length);
        const card = opponent.hand.splice(index, 1)[0]!;
        moveToDiscard(opponent, card);
      }
      if (heads > 0) {
        logMessage(state, `Discarded ${heads} random card(s) from opponent's hand.`);
      }
      return "complete";
    }

    case "recover_energy_from_discard": {
      const player = selfPlayer(state, ctx);
      const type = effect.energyType.toLowerCase();
      const matchIndex = player.discard.findIndex((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        if (!isBasicEnergy(def)) return false;
        return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
      });
      if (matchIndex === -1) return "complete";
      const card = player.discard.splice(matchIndex, 1)[0]!;
      card.zone = Zone.Hand;
      player.hand.push(card);
      logMessage(state, `Put ${getDefinitionSafe(state, card.definitionId).name} into hand from discard.`);
      return "complete";
    }

    case "self_place_counters_optional": {
      ctx.sourcePokemon.damageCounters += effect.max * 10;
      logMessage(state, `Placed ${effect.max} damage counters on this Pokémon.`);
      return "complete";
    }

    case "damage_all_benched": {
      const player = selfPlayer(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      for (const bench of [...player.bench, ...opponent.bench]) {
        bench.damageCounters += effect.amount;
      }
      logMessage(state, `${effect.amount} damage to each Benched Pokémon.`);
      return "complete";
    }

    case "coin_both_tails_status": {
      const results = state.turnFlags.lastCoinFlipResults;
      if (results && results.length > 0 && results.every((heads) => !heads)) {
        const opponent = opponentPlayer(state, ctx);
        if (opponent.active && applySpecialCondition(state, opponent.active, effect.status)) {
          logMessage(state, `${getDefinitionSafe(state, opponent.active.definitionId).name} is now ${effect.status}.`);
        }
      }
      return "complete";
    }

    case "coin_attach_energy_from_discard": {
      const player = selfPlayer(state, ctx);
      const coinCount = effect.coinCount ?? 1;
      let heads = 0;
      for (let i = 0; i < coinCount; i += 1) {
        if (flipCoin(state)) heads += 1;
      }
      const type = effect.energyType.toLowerCase();
      const targets = effect.target === "benched" ? player.bench : allPokemonInPlay(player);
      let attached = 0;
      for (let i = 0; i < heads && attached < heads; i += 1) {
        const matchIndex = player.discard.findIndex((card) => {
          const def = getDefinitionSafe(state, card.definitionId);
          if (!isBasicEnergy(def)) return false;
          if (type === "any") return true;
          return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
        });
        if (matchIndex === -1) break;
        const target = targets[attached % Math.max(targets.length, 1)];
        if (!target) break;
        const energy = player.discard.splice(matchIndex, 1)[0]!;
        attachEnergyToPokemon(state, ctx.playerId, energy, target);
        attached += 1;
      }
      if (attached > 0) {
        logMessage(state, `Attached ${attached} Basic ${effect.energyType} Energy from discard.`);
      }
      return "complete";
    }

    case "attach_energy_from_discard": {
      const player = selfPlayer(state, ctx);
      const type = effect.energyType.toLowerCase();
      const targets =
        effect.target === "benched"
          ? player.bench
          : effect.target === "self"
            ? player.active
              ? [player.active]
              : []
            : allPokemonInPlay(player);
      if (targets.length === 0) return "complete";

      let attached = 0;
      for (let n = 0; n < effect.count; n += 1) {
        const matchIndex = player.discard.findIndex((card) => {
          const def = getDefinitionSafe(state, card.definitionId);
          if (!isBasicEnergy(def)) return false;
          if (type === "any") return true;
          return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
        });
        if (matchIndex === -1) break;
        const target = targets[attached % targets.length]!;
        const energy = player.discard.splice(matchIndex, 1)[0]!;
        attachEnergyToPokemon(state, ctx.playerId, energy, target);
        attached += 1;
      }
      if (attached > 0) {
        logMessage(state, `Attached ${attached} Energy from discard.`);
      }
      return "complete";
    }

    case "search_any_to_hand": {
      const player = selfPlayer(state, ctx);
      if (player.deck.length === 0) {
        logMessage(state, "No cards found in deck.");
        return "complete";
      }
      const slots = Math.min(effect.count ?? 1, player.deck.length);
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "ANY_POKEMON",
        options: player.deck.map((entry) => entry.instanceId),
        slotsRemaining: slots > 1 ? slots : undefined,
      };
      logMessage(state, `Search your deck for ${slots > 1 ? `up to ${slots} cards` : "a card"}.`);
      return "pending";
    }

    case "search_stadium_to_hand": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        return def.supertype === "Trainer" && isStadium(def);
      });
      if (matches.length === 0) {
        logMessage(state, "No Stadium cards found in deck.");
        return "complete";
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "ANY_POKEMON",
        options: matches.map((entry) => entry.instanceId),
      };
      logMessage(state, "Search your deck for a Stadium card.");
      return "pending";
    }

    case "reveal_deck_top": {
      const player = selfPlayer(state, ctx);
      const top = player.deck.slice(0, effect.count ?? 1);
      if (top.length === 0) return "complete";
      const names = top.map((card) => getDefinitionSafe(state, card.definitionId).name);
      logMessage(state, `Revealed top of deck: ${names.join(", ")}.`);
      return "complete";
    }

    case "shuffle_self_bench_to_deck": {
      const player = selfPlayer(state, ctx);
      const bench = [...player.bench];
      player.bench.length = 0;
      for (const pokemon of bench) {
        pokemon.zone = Zone.Deck;
        pokemon.damageCounters = 0;
        pokemon.statusConditions = [];
        for (const energy of pokemon.attachedEnergy) {
          moveToDiscard(player, energy);
        }
        pokemon.attachedEnergy = [];
        player.deck.push(pokemon);
      }
      shufflePlayerDeck(state, ctx.playerId);
      logMessage(state, "Shuffled Benched Pokémon into your deck.");
      return "complete";
    }

    case "recover_pokemon_from_discard": {
      const player = selfPlayer(state, ctx);
      const target = effect.target ?? "hand";
      const matches = player.discard.filter((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        return def.supertype === "Pokémon" && pokemonMatchesNameFilter(state, card, effect.nameFilter);
      });
      if (matches.length === 0) {
        logMessage(state, "No matching Pokémon in discard.");
        return "complete";
      }
      if (target === "bench") {
        const benchSlots = getMaxBenchSize(state, ctx.playerId) - player.bench.length;
        if (benchSlots <= 0) {
          logMessage(state, "Bench is full.");
          return "complete";
        }
        const maxPick = Math.min(effect.count, benchSlots, matches.length);
        if (maxPick <= 0) return "complete";
        if (matches.length === 1) {
          const placed = placePokemonFromDiscardToBench(state, ctx.playerId, matches[0]!.instanceId);
          if (placed) {
            logMessage(
              state,
              `Put ${getDefinitionSafe(state, placed.definitionId).name} onto your Bench from discard.`,
            );
          }
          return "complete";
        }
        state.pendingAction = {
          type: "PICK_DISCARD",
          playerId: ctx.playerId,
          options: matches.map((entry) => entry.instanceId),
          slotsRemaining: maxPick,
          toBench: true,
          nameFilter: effect.nameFilter,
        };
        logMessage(
          state,
          `Choose up to ${maxPick} ${effect.nameFilter} from your discard pile to put onto your Bench.`,
        );
        return "pending";
      }
      if (matches.length === 1 && effect.count >= 1) {
        const index = player.discard.findIndex((card) => card.instanceId === matches[0]!.instanceId);
        const card = player.discard.splice(index, 1)[0]!;
        card.zone = Zone.Hand;
        player.hand.push(card);
        logMessage(state, `Put ${getDefinitionSafe(state, card.definitionId).name} into hand from discard.`);
        return "complete";
      }
      state.pendingAction = {
        type: "PICK_DISCARD",
        playerId: ctx.playerId,
        options: matches.map((entry) => entry.instanceId),
        slotsRemaining: Math.min(effect.count, matches.length),
      };
      logMessage(
        state,
        `Choose up to ${Math.min(effect.count, matches.length)} Pokémon from your discard pile.`,
      );
      return "pending";
    }

    case "switch_bench_named_to_active":
    case "switch_bench_typed_to_active": {
      const player = selfPlayer(state, ctx);
      if (!player.active) return "complete";
      const eligible =
        effect.kind === "switch_bench_typed_to_active"
          ? getEligibleTypedBenchPokemon(state, ctx.playerId, effect.typeFilter, effect.excludeName)
          : player.bench.filter(
              (pokemon) =>
                pokemonMatchesNameFilter(state, pokemon, effect.nameFilter) &&
                !pokemonIsExcludedByName(state, pokemon, effect.excludeName),
            );
      if (eligible.length === 0) {
        logMessage(state, "No eligible Benched Pokémon to switch.");
        return "complete";
      }
      if (eligible.length === 1) {
        performBenchToActiveSwitch(state, ctx.playerId, eligible[0]!.instanceId, effect.applyStatus);
        return "complete";
      }
      state.pendingAction = {
        type: "SWITCH_TYPED_BENCH",
        playerId: ctx.playerId,
        typeFilter:
          effect.kind === "switch_bench_typed_to_active" ? effect.typeFilter : effect.nameFilter,
        excludeName: effect.excludeName,
        applyStatus: effect.applyStatus,
        options: eligible.map((pokemon) => pokemon.instanceId),
      };
      logMessage(state, "Choose a Benched Pokémon to switch with your Active Pokémon.");
      return "pending";
    }

    case "search_attach_energy_any":
    case "search_attach_energy_typed":
      return searchAttachEnergyFromDeck(
        state,
        ctx,
        effect as Extract<ParsedEffect, { kind: "search_attach_energy_any" | "search_attach_energy_typed" }>,
      );

    case "bonus_prize_on_defender_ko_next_turn":
    case "move_energy_to_new_bench_after_search":
    case "self_hand_equal_damage_bonus":
    case "copy_opponent_active_attack":
    case "on_bench_play_switch_and_move_energy":
    case "on_bench_play_trigger":
    case "allow_attack_first_turn_if_go_first":
    case "knock_out_self_on_ability_use":
    case "ability_only_while_active":
    case "evolve_trigger_ability":
    case "ability_use_limit_per_turn":
    case "poison_attacker_when_damaged_from_opponent":
    case "prevent_damage_from_ability_pokemon":
    case "attach_hand_energy_to_benched":
    case "search_attach_energy_each_bench":
    case "discard_special_energy_opponent":
    case "search_item_to_hand":
    case "move_opponent_energy_to_bench":
    case "shuffle_attached_energy_to_deck":
    case "cant_reuse_attack_until_leave_active":
    case "cant_use_named_attack_next_turn":
    case "if_damaged_flip_coin":
    case "coin_flip_attack_fails_on_tails_defending":
    case "requires_stadium_in_play":
    case "attach_unlimited_basic_energy_from_hand":
    case "shuffle_hand_into_deck":
    case "damage_per_all_in_play":
    case "require_discard_energy_to_use_ability":
    case "prevent_item_supporter_effects_on_self":
    case "no_retreat_cost_if_no_energy":
    case "mill_self_deck":
    case "search_attach_energy_to_self":
    case "choose_two_opponent_bench":
    case "coin_flip_ko_basic":
    case "damage_per_named_attack_in_play":
    case "discard_typed_energy_optional":
    case "return_typed_energy_to_hand":
    case "attack_cost_reduction_per_discard_name":
    case "evolve_place_counters_on_two_opponent":
    case "reduce_prize_when_named_ko_by_ex":
    case "require_hand_energy_in_active":
    case "damage_per_energy_in_opponent_discard":
    case "recover_supporter_from_discard":
    case "damage_bonus_if_self_poisoned":
    case "delayed_counters_on_defender":
    case "move_energy_from_yours_to_self":
    case "look_deck_attach_energy":
    case "damage_per_typed_energy_in_discard":
    case "evolve_each_bench_from_deck":
    case "shuffle_opponent_pokemon_to_deck":
    case "opponent_choose_shuffle_hand":
    case "damage_per_named_in_play":
    case "discard_named_energy":
    case "discard_opponent_active":
    case "discard_typed_energy_up_to":
    case "reorder_opponent_deck_top":
    case "damage_bonus_if_opponent_stage":
    case "damage_bonus_if_opponent_damaged":
    case "damage_bonus_if_self_undamaged":
    case "damage_per_trainer_in_revealed":
    case "attack_fails_if_bench_at_most":
    case "named_attack_bonus_next_turn":
    case "damage_bonus_if_extra_energy":
    case "ko_if_exact_counters_on_opponent":
    case "reveal_and_discard_opponent_hand":
    case "damage_bonus_if_self_damaged":
    case "damage_per_opponent_hand_size":
    case "damage_bonus_if_stadium":
    case "discard_hand_energy_for_damage":
    case "blocked_if_go_second_first_turn_only":
    case "cant_retreat_self_next_turn":
    case "coin_multi_discard_energy":
    case "optional_damage_bonus":
    case "shuffle_revealed_to_deck":
    case "cant_use_if_named_attack_last_turn":
    case "damage_per_benched_named_counters":
    case "require_discard_hand_for_ability":
    case "can_evolve_first_turn_while_active":
    case "special_evolve_from_eevee":
    case "evolve_reveal_basic_to_opponent_bench":
    case "disable_opponent_active_abilities":
    case "attach_dual_type_energy_from_hand":
    case "checkup_counter_on_ability_pokemon":
    case "look_deck_supporter_to_hand":
    case "evolve_switch_low_hp_opponent_bench":
    case "evolve_search_trainers_if_tera":
    case "prevent_damage_on_bench":
    case "disable_rule_box_abilities_except_future":
    case "darkness_energy_boost":
    case "burn_attacker_when_damaged_from_opponent":
    case "evolve_heal_all_evolution":
    case "discard_energy_after_heal_evolution":
    case "no_retreat_if_typed_energy":
    case "prevent_attack_effects_on_self":
    case "prevent_damage_from_tera_on_self":
    case "coin_flip_on_opponent_ko":
    case "bonus_prize_on_coin_heads":
    case "basic_pokemon_no_retreat":
    case "evolve_attach_energy_from_discard":
    case "prevent_damage_from_ex_on_self":
    case "team_damage_bonus_to_opponent_active":
    case "block_opponent_items_and_tools_while_active":
    case "bonus_prize_on_ko_basic":
    case "search_evolution_typed_to_hand":
    case "move_typed_energy_between_yours":
    case "allow_extra_tools":
    case "discard_extra_tools_when_ability_lost":
    case "disable_self_ko_abilities":
    case "survive_ko_coin_heads_hp":
    case "prevent_opponent_ability_effects_on_self":
    case "coin_choose_opponent_bench":
    case "move_counters_from_bench_to_opponent":
    case "search_attach_energy_named":
    case "damage_bonus_if_opponent_prize_at_most":
    case "choose_opponent_bench":
    case "shuffle_unchosen_opponent_bench":
    case "damage_bonus_if_bench_type":
    case "attack_fails_unless_opponent_status":
    case "discard_hand_energy_optional":
    case "damage_bonus_if_opponent_type":
    case "attach_energy_each_bench":
    case "damage_per_named_in_discard":
    case "put_basic_opponent_bench":
    case "return_opponent_active_energy_to_hand":
    case "damage_per_special_energy_on_self":
    case "damage_bonus_if_all_bench_damaged":
    case "delayed_ko_defender":
    case "damage_per_opponent_typed_energy":
    case "mill_both_decks":
    case "self_attack_bonus_next_turn":
    case "damage_bonus_if_shared_type":
    case "block_opponent_supporters_next_turn":
    case "damage_bonus_if_opponent_has_tool":
    case "damage_bonus_if_more_prizes":
    case "damage_bonus_if_ko_last_turn":
    case "discard_self_and_attached":
    case "reveal_prize_card":
    case "damage_per_opponent_status_count":
    case "search_attach_dual_energy":
    case "attack_fails_if_hand_count_mismatch":
    case "damage_until_hp_remaining":
    case "search_tool_to_hand":
    case "damage_per_energy_in_self_discard":
    case "attach_hand_energy_typed":
    case "attack_fails_unless_bench_names":
    case "damage_per_all_opponent_counters":
    case "defending_damage_increase_next_turn":
    case "damage_each_opponent_tag":
    case "clear_self_special_conditions":
    case "reveal_opponent_deck_top":
    case "damage_bonus_if_discard_energy_at_least":
    case "return_bench_to_hand":
    case "move_counters_bench_to_opponent":
    case "damage_less_per_retreat_colorless":
    case "damage_bonus_if_bench_name":
    case "set_named_attack_base_next_turn":
    case "recover_from_discard_per_heads":
    case "ko_lowest_hp_in_play":
    case "damage_bonus_if_exact_prizes":
    case "damage_per_energy_in_opponent_hand":
    case "damage_bonus_if_named_ko_last_turn":
    case "attach_discard_energy_match_opponent":
    case "ko_opponent_at_hp_or_less":
    case "damage_per_revealed_from_hand":
    case "team_typed_damage_bonus":
    case "damage_reduction_passive_typed":
    case "attack_cost_reduction_per_opponent_bench":
    case "evolved_can_use_previous_attacks":
    case "counter_on_opponent_energy_attach":
    case "move_counters_between_yours":
    case "can_evolve_if_name_in_play":
    case "hp_bonus_per_typed_energy":
    case "put_basic_opponent_bench_from_hand":
    case "trigger_on_retreat_to_bench":
    case "require_hand_energy_if_name":
    case "poison_on_attach_energy":
    case "counter_on_opponent_switch":
    case "devolve_each_opponent": {
      devolveEachOpponentEvolved(state, ctx.playerId);
      return "complete";
    }
    case "generic_effect_stub":
      logMessage(state, `Effect applied: ${effect.kind.replace(/_/g, " ")}.`);
      return "complete";

    case "return_self_to_hand": {
      returnPokemonToHand(state, ctx.playerId, ctx.sourcePokemon);
      logMessage(state, "Returned this Pokémon to hand.");
      // If the Active spot is now empty, promote a bench Pokémon.
      const retPlayer = getPlayer(state, ctx.playerId);
      if (!retPlayer.active && retPlayer.bench.length > 0) {
        state.pendingAction = { type: "PROMOTE", playerId: ctx.playerId };
      }
      return "complete";
    }

    case "shuffle_self_active_to_deck": {
      // Abra's Teleporter: shuffle the active Pokémon and all attached cards into the deck,
      // then promote a Bench Pokémon to fill the empty Active spot.
      shufflePokemonAndAttachmentsToDeck(state, ctx.playerId, ctx.sourcePokemon);
      logMessage(state, "Shuffled this Pokémon and all attached cards into the deck.");
      const shufflePlayer = getPlayer(state, ctx.playerId);
      if (!shufflePlayer.active && shufflePlayer.bench.length > 0) {
        state.pendingAction = { type: "PROMOTE", playerId: ctx.playerId };
      }
      return "complete";
    }

    case "shuffle_self_to_deck_if_drew": {
      if ((ctx.cardsDrawnThisSequence ?? 0) > 0) {
        shufflePokemonAndAttachmentsToDeck(state, ctx.playerId, ctx.sourcePokemon);
        logMessage(state, "Shuffled this Pokémon and all attached cards into your deck.");
      }
      return "complete";
    }

    case "disable_opponent_attack_next_turn": {
      const opponent = opponentPlayer(state, ctx);
      if (!opponent.active) return "complete";
      const attacks = getDefinitionSafe(state, opponent.active.definitionId).attacks ?? [];
      if (attacks.length === 0) return "complete";
      if (attacks.length === 1) {
        opponent.active.blockedAttackNextOpponentTurn = {
          name: attacks[0]!.name,
          phase: "pending",
        };
        logMessage(
          state,
          `${getDefinitionSafe(state, opponent.active.definitionId).name} can't use ${attacks[0]!.name} during its next turn.`,
        );
        return "complete";
      }
      state.pendingAction = {
        type: "CHOOSE_BLOCKED_ATTACK",
        playerId: ctx.playerId,
        targetPokemonId: opponent.active.instanceId,
        options: attacks.map((entry) => entry.name),
      };
      logMessage(state, "Choose 1 of your opponent's Active Pokémon's attacks to block next turn.");
      return "pending";
    }

    case "reveal_opponent_hand": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.hand.length === 0) {
        logMessage(state, `${opponent.name} has no cards in hand.`);
        return "complete";
      }
      const names = opponent.hand.map((card) => getDefinitionSafe(state, card.definitionId).name);
      logMessage(state, `${opponent.name} reveals their hand: ${names.join(", ")}.`);
      return "complete";
    }

    case "prevent_damage_from_basic_non_colorless": {
      ctx.sourcePokemon.preventDamageFromBasicNonColorless = "pending";
      logMessage(
        state,
        "This Pokémon is protected from Basic non-Colorless Pokémon during your opponent's next turn.",
      );
      return "complete";
    }

    case "heal_matching_damage_dealt": {
      const healed = ctx.lastDamageToOpponentActive ?? 0;
      if (healed > 0) {
        ctx.sourcePokemon.damageCounters = Math.max(0, ctx.sourcePokemon.damageCounters - healed);
        logMessage(state, `Healed ${healed} damage from this Pokémon.`);
      }
      return "complete";
    }

    case "return_energy_to_hand": {
      const player = selfPlayer(state, ctx);
      const pokemon = ctx.sourcePokemon;
      if (pokemon.attachedEnergy.length === 0) return "complete";
      const energy = pokemon.attachedEnergy.shift()!;
      energy.zone = Zone.Hand;
      player.hand.push(energy);
      logMessage(
        state,
        `Returned ${getDefinitionSafe(state, energy.definitionId).name} to hand.`,
      );
      return "complete";
    }

    case "damage_two_opponent": {
      const opponent = opponentPlayer(state, ctx);
      const options = [
        ...(opponent.active ? [opponent.active.instanceId] : []),
        ...opponent.bench.map((entry) => entry.instanceId),
      ];
      if (options.length === 0) return "complete";
      if (options.length <= 2) {
        for (const id of options) {
          const target =
            opponent.active?.instanceId === id
              ? opponent.active
              : opponent.bench.find((entry) => entry.instanceId === id);
          if (target) target.damageCounters += effect.amount;
        }
        logMessage(state, `${effect.amount} damage to ${options.length} opponent Pokémon.`);
        return "complete";
      }
      state.pendingAction = {
        type: "DAMAGE_TWO_OPPONENT",
        playerId: ctx.playerId,
        amount: effect.amount,
        picksRemaining: 2,
        pickedIds: [],
      };
      logMessage(state, `Choose 2 of your opponent's Pokémon to deal ${effect.amount} damage to.`);
      return "pending";
    }

    case "shuffle_random_opponent_hand_to_deck": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.hand.length === 0) return "complete";
      state.rngSeed += 1;
      const rng = createRng(state.rngSeed + opponent.hand.length);
      const index = Math.floor(rng.next() * opponent.hand.length);
      const card = opponent.hand.splice(index, 1)[0]!;
      card.zone = Zone.Deck;
      opponent.deck.push(card);
      logMessage(
        state,
        `${getPlayer(state, ctx.opponentId).name} shuffled ${getDefinitionSafe(state, card.definitionId).name} from their hand into their deck.`,
      );
      return "complete";
    }

    case "search_evolution_from_deck": {
      const player = selfPlayer(state, ctx);
      const sourceDef = getDefinitionSafe(state, ctx.sourcePokemon.definitionId);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def && canEvolveInto(sourceDef, def);
      });
      if (matches.length === 0) {
        logMessage(state, "No evolution card found in deck.");
        return "complete";
      }
      if (matches.length === 1) {
        evolvePokemonFromDeck(
          state,
          ctx.playerId,
          ctx.sourcePokemon.instanceId,
          matches[0]!.instanceId,
        );
        shufflePlayerDeck(state, ctx.playerId);
        return "complete";
      }
      state.pendingAction = {
        type: "SEARCH_EVOLUTION",
        playerId: ctx.playerId,
        targetId: ctx.sourcePokemon.instanceId,
        options: matches.map((entry) => entry.instanceId),
        attackName: ctx.attackName,
      };
      logMessage(state, "Choose an evolution card from your deck.");
      return "pending";
    }

    case "search_supporter_to_hand": {
      const player = selfPlayer(state, ctx);
      const matches = player.deck.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def && isSupporter(def);
      });
      if (matches.length === 0) {
        logMessage(state, "No Supporter card found in deck.");
        return "complete";
      }
      state.pendingAction = {
        type: "SEARCH_DECK",
        playerId: ctx.playerId,
        filter: "SUPPORTER_HAND",
        options: matches.map((entry) => entry.instanceId),
      };
      logMessage(state, "Search your deck for a Supporter card.");
      return "pending";
    }

    case "festival_grounds_double_attack":
    case "copy_benched_attack":
    case "attack_cost_reduction_per_opponent_prize":
    case "override_opponent_dragon_weakness":
    case "ignore_opponent_active_modifiers":
    case "future_pokemon_active_damage_bonus":
    case "cant_attack_unless_name_count_in_play":
      return "complete";

    case "damage_per_tools_on_your_pokemon":
      return "complete";

    case "attach_basic_energy_from_hand": {
      const player = selfPlayer(state, ctx);
      const matchingEnergy = player.hand.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        if (!def || !isBasicEnergy(def)) return false;
        const type = effect.energyType.toLowerCase();
        return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
      });
      if (matchingEnergy.length === 0) return "complete";

      const targets = allPokemonInPlay(player).filter((mon) =>
        pokemonMatchesNameFilter(state, mon, effect.nameFilter),
      );
      if (targets.length === 0) return "complete";

      if (targets.length === 1 && matchingEnergy.length === 1) {
        const energy = player.hand.splice(
          player.hand.findIndex((c) => c.instanceId === matchingEnergy[0]!.instanceId),
          1,
        )[0]!;
        attachEnergyToPokemon(state, ctx.playerId, energy, targets[0]!);
        if (effect.drawOnAttach) drawCards(state, ctx.playerId, 1);
        if (effect.healOnAttach) {
          targets[0]!.damageCounters = Math.max(0, targets[0]!.damageCounters - effect.healOnAttach);
        }
        return "complete";
      }

      state.pendingAction = {
        type: "ATTACH_HAND_ENERGY",
        playerId: ctx.playerId,
        energyType: effect.energyType,
        energyId: matchingEnergy[0]!.instanceId,
        nameFilter: effect.nameFilter,
        targetIds: targets.map((entry) => entry.instanceId),
        drawOnAttach: effect.drawOnAttach,
        healOnAttach: effect.healOnAttach,
      };
      logMessage(state, "Choose a Pokémon to attach Energy to.");
      return "pending";
    }

    case "survive_ko_full_hp":
    case "survive_ko_coin":
    case "blocked_if_second_player_first_turn":
      return "complete";

    case "recon_directive": {
      const player = selfPlayer(state, ctx);
      if (player.deck.length === 0) return "complete";

      if (player.deck.length === 1) {
        const card = player.deck.shift()!;
        card.zone = Zone.Hand;
        player.hand.push(card);
        logMessage(
          state,
          `Recon Directive: put ${getDefinitionSafe(state, card.definitionId).name} into hand.`,
        );
        return "complete";
      }

      const topTwo = player.deck.slice(0, 2);
      state.pendingAction = {
        type: "RECON_DIRECTIVE",
        playerId: ctx.playerId,
        options: topTwo.map((card) => card.instanceId),
      };
      logMessage(state, "Recon Directive: choose 1 of the top 2 cards of your deck.");
      return "pending";
    }

    case "coin_flip": {
      const heads = flipCoin(state);
      const branch = heads ? effect.heads : effect.tails;
      for (const sub of branch) {
        const result = executeSingleEffect(state, ctx, sub);
        if (result === "pending") return "pending";
      }
      return "complete";
    }

    case "unknown":
      logMessage(state, `Effect not automated: ${effect.text}`);
      return "complete";

    default:
      return "complete";
  }
}

export function executeEffects(
  state: EngineState,
  ctx: EffectContext,
  effects: ParsedEffect[],
): ExecuteResult {
  for (const effect of effects) {
    const result = executeSingleEffect(state, ctx, effect);
    if (result !== "complete") return result;
  }
  return "complete";
}

export function resolveAttachHandEnergyToPokemon(
  state: EngineState,
  playerId: PlayerId,
  pokemonId: string,
  energyId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "ATTACH_HAND_ENERGY" || pending.playerId !== playerId) return "failed";
  if (!pending.targetIds.includes(pokemonId)) return "failed";

  const player = getPlayer(state, playerId);
  const energyIndex = player.hand.findIndex((card) => card.instanceId === energyId);
  if (energyIndex === -1) return "failed";

  const target =
    player.active?.instanceId === pokemonId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pokemonId);
  if (!target || !pokemonMatchesNameFilter(state, target, pending.nameFilter)) return "failed";

  const energy = player.hand.splice(energyIndex, 1)[0]!;
  attachEnergyToPokemon(state, playerId, energy, target);
  if (pending.drawOnAttach) drawCards(state, playerId, 1);
  if (pending.healOnAttach) {
    target.damageCounters = Math.max(0, target.damageCounters - pending.healOnAttach);
  }
  state.pendingAction = null;
  return "complete";
}

export function chooseOpponentPokemonDamage(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "CHOOSE_OPPONENT_POKEMON_DAMAGE" || pending.playerId !== playerId) {
    return "failed";
  }
  if (!pending.options.includes(targetId)) return "failed";

  const opponent = getPlayer(state, getOpponentId(playerId));
  const target =
    opponent.active?.instanceId === targetId
      ? opponent.active
      : opponent.bench.find((entry) => entry.instanceId === targetId);
  if (!target) return "failed";

  target.damageCounters += pending.amount;
  logMessage(
    state,
    `${pending.amount} damage to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );
  state.pendingAction = null;
  return "complete";
}

export function resolveSearchEvolutionPick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "SEARCH_EVOLUTION" || pending.playerId !== playerId) return "failed";
  if (!pending.options.includes(instanceId)) return "failed";

  if (!evolvePokemonFromDeck(state, playerId, pending.targetId, instanceId)) return "failed";
  shufflePlayerDeck(state, playerId);
  state.pendingAction = null;
  return "complete";
}

export function resolveChooseOpponentDamage(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "DAMAGE_TWO_OPPONENT" || pending.playerId !== playerId) return "failed";
  if (pending.pickedIds.includes(targetId)) return "failed";

  const opponent = getPlayer(state, getOpponentId(playerId));
  const target =
    opponent.active?.instanceId === targetId
      ? opponent.active
      : opponent.bench.find((entry) => entry.instanceId === targetId);
  if (!target) return "failed";

  target.damageCounters += pending.amount;
  pending.pickedIds.push(targetId);
  pending.picksRemaining -= 1;
  logMessage(
    state,
    `${pending.amount} damage to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );

  if (pending.picksRemaining <= 0) {
    state.pendingAction = null;
    return "complete";
  }
  return "pending";
}

export function resolveMoveEnergyToBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "MOVE_ENERGY_TO_BENCH" || pending.playerId !== playerId) return "failed";

  const player = getPlayer(state, playerId);
  const source =
    player.active?.instanceId === pending.sourceId
      ? player.active
      : player.bench.find((entry) => entry.instanceId === pending.sourceId);
  if (!source || source.attachedEnergy.length === 0) return "failed";

  const target = player.bench.find((entry) => entry.instanceId === benchInstanceId);
  if (!target) return "failed";

  moveEnergyBetweenPokemon(state, source, target, source.attachedEnergy[0]!.instanceId);
  state.pendingAction = null;
  return "complete";
}

export function resolveSwitchWithBench(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "SWITCH_WITH_BENCH" || pending.playerId !== playerId) return "failed";

  const player = getPlayer(state, playerId);
  if (!player.active) return "failed";
  const benchIndex = player.bench.findIndex((card) => card.instanceId === benchInstanceId);
  if (benchIndex === -1) return "failed";

  const incoming = player.bench.splice(benchIndex, 1)[0]!;
  const outgoing = player.active;
  outgoing.zone = Zone.Bench;
  player.bench.push(outgoing);
  incoming.zone = Zone.Active;
  player.active = incoming;
  markMovedFromBenchToActive(state, incoming.instanceId);
  state.pendingAction = null;
  logMessage(
    state,
    `Switched ${getDefinitionSafe(state, outgoing.definitionId).name} with ${getDefinitionSafe(state, incoming.definitionId).name}.`,
  );
  return "complete";
}

export function resolveSwitchTypedBenchToActive(
  state: EngineState,
  playerId: PlayerId,
  benchInstanceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "SWITCH_TYPED_BENCH" || pending.playerId !== playerId) return "failed";
  if (!pending.options.includes(benchInstanceId)) return "failed";
  if (!performBenchToActiveSwitch(state, playerId, benchInstanceId, pending.applyStatus)) return "failed";
  state.pendingAction = null;
  return "complete";
}

export function continueRecoverToBenchPick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): void {
  const pending = state.pendingAction;
  if (pending?.type !== "PICK_DISCARD" || pending.playerId !== playerId || !pending.toBench) return;
  if (!pending.options.includes(instanceId)) return;

  const player = getPlayer(state, playerId);
  if (player.bench.length >= getMaxBenchSize(state, playerId)) {
    state.pendingAction = null;
    return;
  }

  const placed = placePokemonFromDiscardToBench(state, playerId, instanceId);
  if (!placed) return;

  logMessage(
    state,
    `${player.name} put ${getDefinitionSafe(state, placed.definitionId).name} onto their Bench from discard.`,
  );

  const remainingSlots = (pending.slotsRemaining ?? 1) - 1;
  const remaining = player.discard.filter((card) => {
    const def = getDefinitionSafe(state, card.definitionId);
    return def.supertype === "Pokémon" && pokemonMatchesNameFilter(state, card, pending.nameFilter);
  });
  const benchSlots = getMaxBenchSize(state, playerId) - player.bench.length;
  if (remainingSlots > 0 && remaining.length > 0 && benchSlots > 0) {
    state.pendingAction = {
      type: "PICK_DISCARD",
      playerId,
      options: remaining.map((entry) => entry.instanceId),
      slotsRemaining: Math.min(remainingSlots, benchSlots),
      toBench: true,
      nameFilter: pending.nameFilter,
    };
    logMessage(state, "Choose another Pokémon to put onto your Bench (optional).");
    return;
  }

  state.pendingAction = null;
}

export function resolveReconDirectivePick(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "RECON_DIRECTIVE" || pending.playerId !== playerId) return "failed";
  if (!pending.options.includes(instanceId)) return "failed";

  const player = getPlayer(state, playerId);
  const topTwo = player.deck.slice(0, 2).filter((card) => pending.options.includes(card.instanceId));
  const picked = topTwo.find((card) => card.instanceId === instanceId);
  if (!picked) return "failed";

  const other = topTwo.find((card) => card.instanceId !== instanceId) ?? null;

  player.deck = player.deck.filter((card) => !topTwo.some((entry) => entry.instanceId === card.instanceId));

  picked.zone = Zone.Hand;
  player.hand.push(picked);

  if (other) {
    other.zone = Zone.Deck;
    player.deck.push(other);
    logMessage(
      state,
      `Recon Directive: put ${getDefinitionSafe(state, picked.definitionId).name} into hand and ${getDefinitionSafe(state, other.definitionId).name} on the bottom of the deck.`,
    );
  } else {
    logMessage(
      state,
      `Recon Directive: put ${getDefinitionSafe(state, picked.definitionId).name} into hand.`,
    );
  }

  state.pendingAction = null;
  return "complete";
}

function performDrawUntilHand(
  state: EngineState,
  playerId: PlayerId,
  targetCount: number,
): ExecuteResult {
  const player = getPlayer(state, playerId);
  let drawn = 0;
  while (player.hand.length < targetCount && player.deck.length > 0) {
    drawCards(state, playerId, 1);
    drawn += 1;
  }
  if (drawn > 0) {
    logMessage(state, `Drew ${drawn} card(s) until ${player.hand.length} in hand.`);
  }
  return "complete";
}

export function confirmDrawUntilHand(state: EngineState, playerId: PlayerId): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "DRAW_UNTIL_HAND" || pending.playerId !== playerId) return "failed";
  performDrawUntilHand(state, playerId, pending.targetCount);
  state.pendingAction = null;
  return "complete";
}

export function assignBenchDamageCounter(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "DISTRIBUTE_BENCH_DAMAGE" || pending.playerId !== playerId) return "failed";
  if (pending.countersRemaining <= 0) return "failed";

  const opponent = getPlayer(state, getOpponentId(playerId));
  const target = opponent.bench.find((b) => b.instanceId === targetId);
  if (!target || !canReceiveBenchAttackDamage(state, target, playerId)) return "failed";

  target.damageCounters += 10;
  pending.countersRemaining -= 1;
  logMessage(
    state,
    `Placed 1 damage counter on ${getDefinitionSafe(state, target.definitionId).name} (${pending.countersRemaining} remaining).`,
  );

  if (pending.countersRemaining <= 0) {
    state.pendingAction = null;
    return "complete";
  }
  return "pending";
}

export function chooseBenchDamage(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "CHOOSE_BENCH_DAMAGE" || pending.playerId !== playerId) return "failed";
  if (!pending.options.includes(targetId)) return "failed";

  const opponent = getPlayer(state, getOpponentId(playerId));
  const target = opponent.bench.find((b) => b.instanceId === targetId);
  if (!target) return "failed";

  target.damageCounters += pending.amount;
  logMessage(state, `${pending.amount} damage to ${getDefinitionSafe(state, target.definitionId).name}.`);
  state.pendingAction = null;
  return "complete";
}

export function selectMoveDamageSource(
  state: EngineState,
  playerId: PlayerId,
  sourceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "MOVE_DAMAGE" || pending.step !== "SOURCE" || pending.playerId !== playerId) {
    return "failed";
  }

  const player = getPlayer(state, playerId);
  const source = allPokemonInPlay(player).find((p) => p.instanceId === sourceId);
  if (!source || source.damageCounters <= 0) return "failed";

  const maxMove = Math.min(pending.maxCounters * 10, source.damageCounters);
  pending.sourceId = sourceId;
  pending.step = "TARGET";
  pending.amountToMove = maxMove;
  logMessage(
    state,
    `Move up to ${pending.maxCounters} damage counters from ${getDefinitionSafe(state, source.definitionId).name} — choose target.`,
  );
  return "pending";
}

export function selectMoveDamageTarget(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (
    pending?.type !== "MOVE_DAMAGE" ||
    pending.step !== "TARGET" ||
    !pending.sourceId ||
    pending.playerId !== playerId
  ) {
    return "failed";
  }

  const sourceOwner = getPlayer(state, playerId);
  const source =
    sourceOwner.active?.instanceId === pending.sourceId
      ? sourceOwner.active
      : sourceOwner.bench.find((p) => p.instanceId === pending.sourceId);
  if (!source) return "failed";

  const targetSide = pending.targetSide === "opponent" ? getOpponentId(playerId) : playerId;
  const targetPlayer = getPlayer(state, targetSide);
  const target =
    targetPlayer.active?.instanceId === targetId
      ? targetPlayer.active
      : targetPlayer.bench.find((p) => p.instanceId === targetId);
  if (!target) return "failed";

  const amount = pending.amountToMove ?? countersToDamage(pending.maxCounters);
  const moved = Math.min(amount, source.damageCounters);
  source.damageCounters -= moved;
  target.damageCounters += moved;
  logMessage(
    state,
    `Moved ${moved} damage from ${getDefinitionSafe(state, source.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );
  state.pendingAction = null;
  return "complete";
}

function canContinueOpponentRedistribute(state: EngineState, playerId: PlayerId): boolean {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const inPlay = allPokemonInPlay(opponent);
  const withCounters = inPlay.filter((pokemon) => pokemon.damageCounters > 0);
  if (withCounters.length === 0) return false;
  return withCounters.some((source) =>
    inPlay.some((target) => target.instanceId !== source.instanceId),
  );
}

function findOpponentPokemon(
  state: EngineState,
  playerId: PlayerId,
  instanceId: string,
): CardInstance | null {
  const opponent = getPlayer(state, getOpponentId(playerId));
  return allPokemonInPlay(opponent).find((pokemon) => pokemon.instanceId === instanceId) ?? null;
}

export function selectRedistributeOpponentSource(
  state: EngineState,
  playerId: PlayerId,
  sourceId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (
    pending?.type !== "REDISTRIBUTE_OPPONENT_COUNTERS" ||
    pending.step !== "SOURCE" ||
    pending.playerId !== playerId
  ) {
    return "failed";
  }

  const source = findOpponentPokemon(state, playerId, sourceId);
  if (!source || source.damageCounters <= 0) return "failed";

  pending.sourceId = sourceId;
  pending.step = "TARGET";
  logMessage(
    state,
    `Move damage counters from ${getDefinitionSafe(state, source.definitionId).name} — choose target.`,
  );
  return "pending";
}

export function selectRedistributeOpponentTarget(
  state: EngineState,
  playerId: PlayerId,
  targetId: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (
    pending?.type !== "REDISTRIBUTE_OPPONENT_COUNTERS" ||
    pending.step !== "TARGET" ||
    !pending.sourceId ||
    pending.playerId !== playerId
  ) {
    return "failed";
  }
  if (pending.sourceId === targetId) return "failed";

  const source = findOpponentPokemon(state, playerId, pending.sourceId);
  const target = findOpponentPokemon(state, playerId, targetId);
  if (!source || !target || source.damageCounters <= 0) return "failed";

  const moved = source.damageCounters;
  source.damageCounters = 0;
  target.damageCounters += moved;
  logMessage(
    state,
    `Moved ${moved} damage from ${getDefinitionSafe(state, source.definitionId).name} to ${getDefinitionSafe(state, target.definitionId).name}.`,
  );

  if (canContinueOpponentRedistribute(state, playerId)) {
    pending.sourceId = undefined;
    pending.step = "SOURCE";
    logMessage(state, "Choose another opponent's Pokémon to move damage counters from.");
    return "pending";
  }

  state.pendingAction = null;
  return "complete";
}

export function resolveChooseBlockedAttack(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
): ExecuteResult {
  const pending = state.pendingAction;
  if (pending?.type !== "CHOOSE_BLOCKED_ATTACK" || pending.playerId !== playerId) return "failed";
  if (!pending.options.some((name) => name.toLowerCase() === attackName.toLowerCase())) return "failed";

  const opponent = getPlayer(state, getOpponentId(playerId));
  const target =
    opponent.active?.instanceId === pending.targetPokemonId
      ? opponent.active
      : [...opponent.bench].find((entry) => entry.instanceId === pending.targetPokemonId);
  if (!target) return "failed";

  target.blockedAttackNextOpponentTurn = { name: attackName, phase: "pending" };
  logMessage(
    state,
    `${getDefinitionSafe(state, target.definitionId).name} can't use ${attackName} during its next turn.`,
  );
  state.pendingAction = null;
  return "complete";
}

export function resolveBenchKnockouts(state: EngineState): void {
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    const attackerId = getOpponentId(playerId);
    const attacker = getPlayer(state, attackerId);

    for (let i = player.bench.length - 1; i >= 0; i -= 1) {
      const benchMon = player.bench[i]!;
      if (!isKnockedOut(state, benchMon)) continue;

      const def = getDefinitionSafe(state, benchMon.definitionId);
      const prizeCount = countPrizeCards(def);
      for (let p = 0; p < prizeCount; p += 1) {
        const prize = attacker.prizes.shift();
        if (prize) {
          prize.zone = Zone.Hand;
          attacker.hand.push(prize);
        }
      }
      // discardPokemonAttachments already moves attached Energy AND Tools to
      // the discard and clears the arrays — do NOT also loop attachedEnergy
      // here, or each Energy is discarded twice (duplicate instances in the
      // discard pile / inflated card count). Matches the Active-KO path.
      discardPokemonAttachments(state, player, benchMon);
      moveToDiscard(player, benchMon);
      player.bench.splice(i, 1);
      logMessage(state, `${def.name} on the Bench was Knocked Out! ${attacker.name} took ${prizeCount} Prize card(s).`);
    }
  }
}

export function checkKnockoutsAfterEffect(state: EngineState, actingPlayerId: PlayerId): boolean {
  let changed = false;
  for (const playerId of [actingPlayerId, getOpponentId(actingPlayerId)] as const) {
    const player = getPlayer(state, playerId);
    if (player.active && isKnockedOut(state, player.active)) {
      changed = true;
    }
    for (const bench of player.bench) {
      if (isKnockedOut(state, bench)) changed = true;
    }
  }
  return changed;
}
