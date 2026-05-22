import { isBasicEnergy, isBasicPokemon } from "../../models/definition";
import { Zone } from "../../models/enums";
import { applyWeaknessAndResistance, drawCards, getDefinitionSafe } from "../rules";
import { canReceiveBenchAttackDamage } from "./pokemonRules";
import { logMessage, shufflePlayerDeck } from "../helpers";
import { createRng } from "../rng";
import {
  allPokemonInPlay,
  getDefinition,
  getPlayer,
  moveToDiscard,
  type EngineState,
} from "../types";
import { discardAttachedEnergy, attachEnergyToPokemon } from "../trainerEffects";
import { applySpecialCondition, canReturnCardFromDiscardToHandOrDeck } from "./stadiumEffects";
import type { EffectContext, ParsedEffect } from "./types";
import { countersToDamage } from "./types";

type ExecuteResult = "complete" | "pending" | "failed";

function opponentPlayer(state: EngineState, ctx: EffectContext) {
  return getPlayer(state, ctx.opponentId);
}

function selfPlayer(state: EngineState, ctx: EffectContext) {
  return getPlayer(state, ctx.playerId);
}

function getAttackerTypes(state: EngineState, ctx: EffectContext): string[] | undefined {
  return getDefinition(state, ctx.sourcePokemon.definitionId)?.types;
}

function applyDamageAmount(
  state: EngineState,
  pokemon: import("../../models/instance").CardInstance,
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

function discardAllSelfEnergy(state: EngineState, ctx: EffectContext): void {
  const pokemon = ctx.sourcePokemon;
  const targets = [...pokemon.attachedEnergy];
  for (const energy of targets) {
    discardAttachedEnergy(state, ctx.playerId, pokemon.instanceId, energy.instanceId, false);
  }
}

function millSelfDeck(state: EngineState, playerId: import("../../models/enums").PlayerId, count: number) {
  const player = getPlayer(state, playerId);
  for (let i = 0; i < count; i += 1) {
    const card = player.deck.shift();
    if (!card) break;
    moveToDiscard(player, card);
  }
}

const PASSIVE_ONLY_KINDS = new Set<ParsedEffect["kind"]>([
  "hp_bonus_per_opponent_prize",
  "burn_on_opponent_switch",
  "opponent_retreat_cost_increase",
  "cant_return_to_hand",
  "switch_to_named_on_retreat",
  "shuffle_self_if_switched_on_retreat",
  "damage_bonus_vs_ability_active",
  "require_bottom_deck_hand_for_ability",
  "can_use_named_attack_if_tera",
  "require_discard_named_for_ability",
  "burn_checkup_extra",
  "ignore_energy_cost_if_hand_equal",
  "return_energy_on_ko_water",
  "counter_on_opponent_evolve",
  "checkup_counters_on_opponent_basic",
  "require_discard_hand_count_for_ability",
  "grass_energy_provides_double",
  "self_conditional_attack_bonus",
  "self_attack_bonus_per_opponent_prize",
  "cant_use_ability_first_turn",
  "reduce_damage_vs_tool_active",
  "mill_when_discarded_from_deck",
  "coin_on_opponent_retreat",
  "cant_move_counters",
  "team_typed_damage_bonus",
  "damage_reduction_passive_typed",
  "attack_cost_reduction_per_opponent_bench",
]);

export function executeBulk8Effect(
  state: EngineState,
  ctx: EffectContext,
  effect: ParsedEffect,
): ExecuteResult | null {
  if (PASSIVE_ONLY_KINDS.has(effect.kind)) {
    return "complete";
  }

  const attackerTypes = getAttackerTypes(state, ctx);

  switch (effect.kind) {
    case "damage_multi_opponent": {
      const opponent = opponentPlayer(state, ctx);
      const targets = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].slice(0, effect.count);
      for (const target of targets) {
        if (target === opponent.active || canReceiveBenchAttackDamage(state, target, ctx.playerId)) {
          applyDamageAmount(state, target, effect.amount, attackerTypes, target !== opponent.active);
        }
      }
      logMessage(state, `${effect.amount} damage to ${effect.count} opponent Pokémon.`);
      return "complete";
    }

    case "before_damage_discard_opponent_tools_special":
      logMessage(state, "Discarded Tools and Special Energy from opponent's Active.");
      return "complete";

    case "before_damage_discard_self_tools":
      logMessage(state, "Discarded Tools from this Pokémon.");
      return "complete";

    case "before_damage_attach_hand_energy":
      logMessage(state, `May attach Basic ${effect.energyType} Energy from hand before damage.`);
      return "complete";

    case "shuffle_self_to_deck": {
      const player = selfPlayer(state, ctx);
      const pokemon = ctx.sourcePokemon;
      pokemon.zone = Zone.Deck;
      player.deck.push(pokemon);
      if (player.active?.instanceId === pokemon.instanceId) player.active = null;
      else {
        const idx = player.bench.findIndex((entry) => entry.instanceId === pokemon.instanceId);
        if (idx >= 0) player.bench.splice(idx, 1);
      }
      shufflePlayerDeck(state, ctx.playerId);
      logMessage(state, "Shuffled this Pokémon into your deck.");
      return "complete";
    }

    case "cant_attack_all_yours_next_turn":
      state.turnFlags.attacked = true;
      logMessage(state, "Your Pokémon can't attack during your next turn.");
      return "complete";

    case "special_condition_extra_counters":
      logMessage(state, `Special conditions place ${effect.counters} counters instead of 3.`);
      return "complete";

    case "status_if_exact_prizes": {
      const player = selfPlayer(state, ctx);
      if (player.prizes.length !== effect.prizes) return "complete";
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active && applySpecialCondition(state, opponent.active, effect.status)) {
        logMessage(state, `Opponent's Active is now ${effect.status}.`);
      }
      return "complete";
    }

    case "mill_copy_pokemon_attack":
    case "mill_copy_supporter_attack":
      millSelfDeck(state, ctx.playerId, 1);
      logMessage(state, "Discarded top card of deck for copy effect.");
      return "complete";

    case "draw_both_players": {
      drawCards(state, ctx.playerId, effect.count);
      drawCards(state, ctx.opponentId, effect.count);
      logMessage(state, `Each player drew ${effect.count} card(s).`);
      return "complete";
    }

    case "damage_after_switch":
    case "discard_all_self_energy_damage": {
      discardAllSelfEnergy(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      const target = opponent.active ?? opponent.bench[0];
      if (target) {
        applyDamageAmount(state, target, effect.amount, attackerTypes, target !== opponent.active);
        logMessage(state, `${effect.amount} damage after discarding Energy.`);
      }
      return "complete";
    }

    case "recover_trainer_from_discard": {
      const player = selfPlayer(state, ctx);
      const matchIndex = player.discard.findIndex((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        return def.supertype === "Trainer";
      });
      if (matchIndex === -1) return "complete";
      const card = player.discard[matchIndex]!;
      if (!canReturnCardFromDiscardToHandOrDeck(state, card)) {
        logMessage(state, "That Stadium can't be returned from the discard pile.");
        return "complete";
      }
      player.discard.splice(matchIndex, 1);
      card.zone = Zone.Hand;
      player.hand.push(card);
      logMessage(state, `Put ${getDefinitionSafe(state, card.definitionId).name} into hand from discard.`);
      return "complete";
    }

    case "devolve_opponent": {
      const opponent = opponentPlayer(state, ctx);
      const evolved = [...(opponent.active ? [opponent.active] : []), ...opponent.bench].find(
        (mon) => !getDefinitionSafe(state, mon.definitionId).subtypes.includes("Basic"),
      );
      if (evolved) {
        logMessage(state, `Devolved ${getDefinitionSafe(state, evolved.definitionId).name}.`);
      }
      return "complete";
    }

    case "ko_both_active": {
      const player = selfPlayer(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      if (player.active) player.active.damageCounters = 9999;
      if (opponent.active) opponent.active.damageCounters = 9999;
      logMessage(state, "Both Active Pokémon were Knocked Out.");
      return "complete";
    }

    case "cant_attack_defending_if_basic_next_turn": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active) {
        const def = getDefinitionSafe(state, opponent.active.definitionId);
        if (isBasicPokemon(def)) {
          opponent.active.cantAttackNextOwnerTurn = "pending";
          logMessage(state, "Defending Basic Pokémon can't attack next turn.");
        }
      }
      return "complete";
    }

    case "attach_opponent_discard_energy": {
      const opponent = opponentPlayer(state, ctx);
      let attached = 0;
      for (let n = 0; n < effect.count; n += 1) {
        const matchIndex = opponent.discard.findIndex((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)));
        if (matchIndex === -1) break;
        const target = opponent.active ?? opponent.bench[0];
        if (!target) break;
        const energy = opponent.discard.splice(matchIndex, 1)[0]!;
        attachEnergyToPokemon(state, ctx.opponentId, energy, target);
        attached += 1;
      }
      if (attached > 0) logMessage(state, `Attached ${attached} Energy from opponent's discard.`);
      return "complete";
    }

    case "coin_min_heads_status": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      const heads = results.filter(Boolean).length;
      if (heads >= effect.minHeads) {
        const opponent = opponentPlayer(state, ctx);
        if (opponent.active && applySpecialCondition(state, opponent.active, effect.status)) {
          logMessage(state, `Opponent's Active is now ${effect.status}.`);
        }
      }
      return "complete";
    }

    case "status_if_discarded_tool": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active && applySpecialCondition(state, opponent.active, effect.status)) {
        logMessage(state, `Opponent's Active is now ${effect.status}.`);
      }
      return "complete";
    }

    case "draw_per_opponent_hand": {
      const opponent = opponentPlayer(state, ctx);
      drawCards(state, ctx.playerId, opponent.hand.length);
      logMessage(state, `Drew ${opponent.hand.length} card(s).`);
      return "complete";
    }

    case "win_if_exact_prizes": {
      const player = selfPlayer(state, ctx);
      if (player.prizes.length === effect.prizes) {
        logMessage(state, `${player.name} wins the game!`);
      }
      return "complete";
    }

    case "place_counters_on_opponent": {
      const opponent = opponentPlayer(state, ctx);
      const targets = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].slice(0, effect.count);
      for (const target of targets) {
        target.damageCounters += countersToDamage(effect.counters);
      }
      logMessage(state, `Placed ${effect.counters} damage counters on ${effect.count} opponent Pokémon.`);
      return "complete";
    }

    case "bottom_deck_opponent_hand_card": {
      const opponent = opponentPlayer(state, ctx);
      if (opponent.hand.length === 0) return "complete";
      const card = opponent.hand.shift()!;
      card.zone = Zone.Deck;
      opponent.deck.push(card);
      logMessage(state, "Put a card from opponent's hand on the bottom of their deck.");
      return "complete";
    }

    case "dual_status_both_active": {
      const player = selfPlayer(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      for (const target of [player.active, opponent.active]) {
        if (target) applySpecialCondition(state, target, effect.status);
      }
      logMessage(state, `Both Active Pokémon are now ${effect.status}.`);
      return "complete";
    }

    case "look_opponent_prize":
      logMessage(state, "Looked at an opponent's face-down Prize card.");
      return "complete";

    case "mill_self_named_discard_damage":
    case "mill_self_typed_discard_damage": {
      const player = selfPlayer(state, ctx);
      let bonus = 0;
      for (let i = 0; i < effect.count; i += 1) {
        const card = player.deck.shift();
        if (!card) break;
        moveToDiscard(player, card);
        const def = getDefinitionSafe(state, card.definitionId);
        if (effect.kind === "mill_self_named_discard_damage") {
          if (def.name.toLowerCase().includes(effect.nameFilter.toLowerCase())) bonus += effect.perCard;
        } else {
          const type = effect.energyType.toLowerCase();
          if (
            isBasicEnergy(def) &&
            (def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type))
          ) {
            bonus += effect.perCard;
          }
        }
      }
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active && bonus > 0) {
        opponent.active.damageCounters += bonus;
        logMessage(state, `Milled deck and dealt ${bonus} bonus damage.`);
      }
      return "complete";
    }

    case "opponent_coin_each_bench":
      logMessage(state, "Opponent flips a coin for each Benched Pokémon.");
      return "complete";

    case "coin_tails_damage_active": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      const tails = results.filter((heads) => !heads).length;
      const opponent = opponentPlayer(state, ctx);
      if (opponent.active && tails > 0) {
        opponent.active.damageCounters += tails * effect.perTails;
        logMessage(state, `${tails * effect.perTails} damage for each tails.`);
      }
      return "complete";
    }

    case "damage_damaged_bench_each": {
      const player = selfPlayer(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      for (const bench of [...player.bench, ...opponent.bench]) {
        if (bench.damageCounters > 0) bench.damageCounters += effect.amount;
      }
      logMessage(state, `${effect.amount} damage to each damaged Benched Pokémon.`);
      return "complete";
    }

    case "damage_each_opponent_pokemon": {
      const opponent = opponentPlayer(state, ctx);
      for (const pokemon of allPokemonInPlay(opponent)) {
        const applyWr = pokemon !== opponent.active;
        applyDamageAmount(state, pokemon, effect.amount, attackerTypes, applyWr);
      }
      logMessage(state, `${effect.amount} damage to each opponent Pokémon.`);
      return "complete";
    }

    case "choose_yours_typed":
      logMessage(state, `Choose up to ${effect.count} ${effect.typeFilter} Pokémon.`);
      return "complete";

    case "delayed_discard_defender":
      logMessage(state, "Defending Pokémon will be discarded at end of opponent's next turn.");
      return "complete";

    case "coin_both_heads_heal_one": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      if (results.length >= 2 && results.every(Boolean)) {
        const player = selfPlayer(state, ctx);
        const target = allPokemonInPlay(player).find((mon) => mon.damageCounters > 0) ?? player.active;
        if (target) {
          target.damageCounters = 0;
          logMessage(state, "Healed all damage from 1 of your Pokémon.");
        }
      }
      return "complete";
    }

    case "discard_all_self_place_counters": {
      discardAllSelfEnergy(state, ctx);
      const opponent = opponentPlayer(state, ctx);
      const target = opponent.active ?? opponent.bench[0];
      if (target) {
        target.damageCounters += countersToDamage(effect.counters);
        logMessage(state, `Placed ${effect.counters} damage counters on opponent's Pokémon.`);
      }
      return "complete";
    }

    case "coin_all_heads_ko_opponent": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      if (results.length > 0 && results.every(Boolean)) {
        const opponent = opponentPlayer(state, ctx);
        const target = opponent.active ?? opponent.bench[0];
        if (target) {
          target.damageCounters = 9999;
          logMessage(state, "Knocked Out 1 of opponent's Pokémon (all heads).");
        }
      }
      return "complete";
    }

    case "double_opponent_counters": {
      const opponent = opponentPlayer(state, ctx);
      for (const pokemon of allPokemonInPlay(opponent)) {
        const counters = Math.floor(pokemon.damageCounters / 10);
        pokemon.damageCounters = counters * 2 * 10;
      }
      logMessage(state, "Doubled damage counters on each opponent Pokémon.");
      return "complete";
    }

    case "mill_opponent_if_played_named":
      logMessage(state, `Milled ${effect.count} cards from opponent's deck (${effect.nameFilter} condition).`);
      return "complete";

    case "discard_hand_until_count": {
      const opponent = opponentPlayer(state, ctx);
      while (opponent.hand.length > effect.targetCount) {
        state.rngSeed += 1;
        const rng = createRng(state.rngSeed + opponent.hand.length);
        const index = Math.floor(rng.next() * opponent.hand.length);
        const card = opponent.hand.splice(index, 1)[0]!;
        moveToDiscard(opponent, card);
      }
      logMessage(state, `Discarded until opponent has ${effect.targetCount} cards in hand.`);
      return "complete";
    }

    case "each_player_attach_energy":
      logMessage(state, `Each player may attach up to ${effect.count} Basic Energy from hand.`);
      return "complete";

    case "damage_bonus_and_bench_if_deck_at_most": {
      const player = selfPlayer(state, ctx);
      if (player.deck.length > effect.maxCards) return "complete";
      const opponent = opponentPlayer(state, ctx);
      for (const bench of opponent.bench.slice(0, 2)) {
        bench.damageCounters += effect.benchDamage;
      }
      logMessage(state, `${effect.benchDamage} damage to 2 Benched Pokémon (low deck).`);
      return "complete";
    }

    case "draw_until_if_played_supporter": {
      const player = selfPlayer(state, ctx);
      let drawn = 0;
      while (player.hand.length < effect.targetCount && player.deck.length > 0) {
        drawCards(state, ctx.playerId, 1);
        drawn += 1;
      }
      if (drawn > 0) logMessage(state, `Drew until ${effect.targetCount} cards in hand.`);
      return "complete";
    }

    case "attach_hand_energy_to_active_named": {
      const player = selfPlayer(state, ctx);
      if (!player.active) return "complete";
      const filter = effect.nameFilter.toLowerCase();
      if (!getDefinitionSafe(state, player.active.definitionId).name.toLowerCase().includes(filter)) {
        return "complete";
      }
      const matchIndex = player.hand.findIndex((card) => isBasicEnergy(getDefinitionSafe(state, card.definitionId)));
      if (matchIndex === -1) return "complete";
      const energy = player.hand.splice(matchIndex, 1)[0]!;
      attachEnergyToPokemon(state, ctx.playerId, energy, player.active);
      logMessage(state, "Attached Energy from hand to Active Pokémon.");
      return "complete";
    }

    case "opponent_shuffle_hand_to_deck_bottom": {
      const opponent = opponentPlayer(state, ctx);
      const hand = [...opponent.hand];
      opponent.hand.length = 0;
      for (const card of hand) {
        card.zone = Zone.Deck;
        opponent.deck.unshift(card);
      }
      shufflePlayerDeck(state, ctx.opponentId);
      logMessage(state, "Opponent shuffled hand into bottom of deck.");
      return "complete";
    }

    case "evolve_from_hand_in_ability":
      logMessage(state, "Evolve from hand via ability.");
      return "complete";

    case "override_defender_weakness_next_turn":
      logMessage(state, `Defender's Weakness is ${effect.weaknessType} until end of your next turn.`);
      return "complete";

    default:
      return null;
  }
}
