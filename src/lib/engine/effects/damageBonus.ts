import { isBasicPokemon } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { getDefinitionSafe } from "../rules";
import { getPlayer, allPokemonInPlay, type EngineState } from "../types";
import type { ParsedEffect } from "./types";
import { countPrizesTakenByPlayer } from "./passiveRules";
import { countToolsOnPlayerPokemon } from "./toolEffects";

export function isBasicNonColorlessPokemon(def: ReturnType<typeof getDefinitionSafe>): boolean {
  if (!isBasicPokemon(def)) return false;
  const types = def.types ?? [];
  return !(types.length === 1 && types[0] === "Colorless");
}

export function hasSpecialCondition(pokemon: CardInstance): boolean {
  return pokemon.statusConditions.length > 0;
}

export function computePreDamageBonus(
  state: EngineState,
  effect: ParsedEffect,
  playerId: import("../../models/enums").PlayerId,
  source: CardInstance,
  opponentId: import("../../models/enums").PlayerId,
): number {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, opponentId);

  switch (effect.kind) {
    case "damage_per_self_counter":
    case "damage_per_self_counter_more": {
      const counters = Math.floor(source.damageCounters / 10);
      return counters * effect.perCounter;
    }
    case "damage_per_energy_both_actives": {
      const selfEnergy = source.attachedEnergy.length;
      const oppEnergy = opponent.active?.attachedEnergy.length ?? 0;
      return (selfEnergy + oppEnergy) * effect.perEnergy;
    }
    case "damage_bonus_if_special_condition": {
      if (opponent.active && hasSpecialCondition(opponent.active)) {
        return effect.amount;
      }
      return 0;
    }
    case "damage_per_all_benched":
      return (player.bench.length + opponent.bench.length) * effect.perBench;
    case "damage_per_own_benched":
      return player.bench.length * effect.perBench;
    case "damage_per_energy_on_self":
      return source.attachedEnergy.length * effect.perEnergy;
    case "damage_per_energy_opponent_active":
      return (opponent.active?.attachedEnergy.length ?? 0) * effect.perEnergy;
    case "damage_per_tools_on_your_pokemon":
      return countToolsOnPlayerPokemon(state, playerId) * effect.perTool;
    case "damage_bonus_per_opponent_prize": {
      const taken = countPrizesTakenByPlayer(state, opponentId);
      return taken * effect.perPrize;
    }
    case "damage_per_typed_energy": {
      if (effect.scope === "all_yours") {
        const total = allPokemonInPlay(player).reduce(
          (sum, mon) => sum + mon.attachedEnergy.length,
          0,
        );
        return total * effect.perEnergy;
      }
      return source.attachedEnergy.filter((energy) => {
        const def = getDefinitionSafe(state, energy.definitionId);
        const type = effect.energyType.toLowerCase();
        return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
      }).length * effect.perEnergy;
    }
    case "damage_per_opponent_active_counter": {
      const counters = Math.floor((opponent.active?.damageCounters ?? 0) / 10);
      return counters * effect.perCounter;
    }
    case "damage_per_opponent_benched":
      return opponent.bench.length * effect.perBench;
    case "damage_less_per_self_counter": {
      const counters = Math.floor(source.damageCounters / 10);
      return -counters * effect.perCounter;
    }
    case "damage_bonus_if_opponent_tag": {
      const def = opponent.active ? getDefinitionSafe(state, opponent.active.definitionId) : null;
      if (!def) return 0;
      if (effect.tag === "ex") {
        const isEx =
          def.subtypes.includes("ex") ||
          def.subtypes.includes("EX") ||
          def.subtypes.includes("V") ||
          def.subtypes.includes("VMAX");
        return isEx ? effect.amount : 0;
      }
      if (effect.tag === "evolution") {
        return def.subtypes.includes("Basic") ? 0 : effect.amount;
      }
      return 0;
    }
    case "damage_per_all_in_play": {
      const player = getPlayer(state, playerId);
      return allPokemonInPlay(player).length * effect.perPokemon;
    }
    case "damage_bonus_if_moved_from_bench":
      return effect.amount;
    case "damage_bonus_if_self_poisoned":
      return hasSpecialCondition(source) ? effect.amount : 0;
    case "damage_per_energy_in_opponent_discard": {
      const opponent = getPlayer(state, opponentId);
      const count = opponent.discard.filter((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        return def.supertype === "Energy" && def.subtypes.includes("Basic");
      }).length;
      return count * effect.perEnergy;
    }
    case "damage_bonus_if_opponent_damaged":
      return (opponent.active?.damageCounters ?? 0) > 0 ? effect.amount : 0;
    case "damage_bonus_if_self_undamaged":
      return source.damageCounters === 0 ? effect.amount : 0;
    case "damage_bonus_if_self_damaged":
      return source.damageCounters > 0 ? effect.amount : 0;
    case "damage_bonus_if_stadium":
      return state.stadium ? effect.amount : 0;
    case "damage_bonus_if_extra_energy":
      return effect.amount;
    case "damage_bonus_if_opponent_stage": {
      const def = opponent.active ? getDefinitionSafe(state, opponent.active.definitionId) : null;
      if (!def) return 0;
      const stageMatch = def.subtypes.find((s) => /^Stage \d+$/.test(s));
      const stage = stageMatch ? parseInt(stageMatch.replace("Stage ", ""), 10) : 1;
      return stage >= effect.stage ? effect.amount : 0;
    }
    case "damage_per_opponent_hand_size":
      return opponent.hand.length * effect.perCard;
    case "damage_per_typed_energy_in_discard": {
      const type = effect.energyType.toLowerCase();
      const count = player.discard.filter((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        if (def.supertype !== "Energy" || !def.subtypes.includes("Basic")) return false;
        return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
      }).length;
      return count * effect.counters * 10;
    }
    case "damage_per_named_in_play": {
      const filter = effect.nameFilter.toLowerCase();
      const count = allPokemonInPlay(player).filter((mon) => {
        const def = getDefinitionSafe(state, mon.definitionId);
        return def.name.toLowerCase().includes(filter);
      }).length;
      return count * effect.perPokemon;
    }
    case "damage_per_benched_named_counters": {
      const filter = effect.nameFilter.toLowerCase();
      const total = player.bench
        .filter((mon) => getDefinitionSafe(state, mon.definitionId).name.toLowerCase().includes(filter))
        .reduce((sum, mon) => sum + Math.floor(mon.damageCounters / 10), 0);
      return total * effect.perCounter;
    }
    case "damage_per_trainer_in_revealed":
    case "discard_hand_energy_for_damage":
    case "optional_damage_bonus":
      return effect.kind === "optional_damage_bonus" ? effect.amount : 0;
    case "attack_fails_if_bench_at_most":
      return player.bench.length <= effect.maxBench ? -Infinity : 0;
    case "damage_bonus_if_opponent_prize_at_most": {
      const remaining = opponent.prizes.length;
      return remaining <= effect.maxPrizes ? effect.amount : 0;
    }
    case "damage_bonus_if_bench_type":
      return player.bench.some((mon) => {
        const def = getDefinitionSafe(state, mon.definitionId);
        return def.types?.some((t) => t.toLowerCase() === effect.typeFilter.toLowerCase());
      })
        ? effect.amount
        : 0;
    case "attack_fails_unless_opponent_status":
      return opponent.active && hasSpecialCondition(opponent.active) ? 0 : -Infinity;
    case "damage_bonus_if_opponent_type": {
      const def = opponent.active ? getDefinitionSafe(state, opponent.active.definitionId) : null;
      return def?.types?.some((t) => t.toLowerCase() === effect.typeFilter.toLowerCase()) ? effect.amount : 0;
    }
    case "damage_per_named_in_discard": {
      const filter = effect.nameFilter.toLowerCase();
      const count = player.discard.filter((card) =>
        getDefinitionSafe(state, card.definitionId).name.toLowerCase().includes(filter),
      ).length;
      return count * effect.perCard;
    }
    case "damage_per_special_energy_on_self":
      return source.attachedEnergy.filter((energy) => {
        const def = getDefinitionSafe(state, energy.definitionId);
        return def.supertype === "Energy" && !def.subtypes.includes("Basic");
      }).length * effect.perEnergy;
    case "damage_bonus_if_all_bench_damaged":
      return player.bench.length > 0 && player.bench.every((mon) => mon.damageCounters > 0) ? effect.amount : 0;
    case "damage_per_opponent_typed_energy": {
      const type = effect.energyType.toLowerCase();
      const total = allPokemonInPlay(opponent).reduce((sum, mon) => {
        return (
          sum +
          mon.attachedEnergy.filter((energy) => {
            const def = getDefinitionSafe(state, energy.definitionId);
            return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
          }).length
        );
      }, 0);
      return total * effect.perEnergy;
    }
    case "damage_bonus_if_shared_type": {
      const yourTypes = new Set(
        allPokemonInPlay(player).flatMap((mon) => getDefinitionSafe(state, mon.definitionId).types ?? []),
      );
      const shared = allPokemonInPlay(opponent).some((mon) =>
        (getDefinitionSafe(state, mon.definitionId).types ?? []).some((t) => yourTypes.has(t)),
      );
      return shared ? effect.amount : 0;
    }
    case "damage_bonus_if_opponent_has_tool":
      return 0;
    case "damage_bonus_if_more_prizes":
      return player.prizes.length > opponent.prizes.length ? effect.amount : 0;
    case "damage_bonus_if_ko_last_turn":
      return state.ownPokemonKnockedOutOpponentLastTurn[playerId] ? effect.amount : 0;
    case "damage_per_opponent_status_count":
      return opponent.active && hasSpecialCondition(opponent.active)
        ? opponent.active.statusConditions.length * effect.perStatus
        : 0;
    case "attack_fails_if_hand_count_mismatch":
      return player.hand.length === opponent.hand.length ? 0 : -Infinity;
    case "damage_per_energy_in_self_discard": {
      const count = player.discard.filter((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        return def.supertype === "Energy";
      }).length;
      return count * effect.perEnergy;
    }
    case "attack_fails_unless_bench_names": {
      const benchNames = player.bench.map((mon) => getDefinitionSafe(state, mon.definitionId).name.toLowerCase());
      const ok = effect.names.every((name) => benchNames.some((n) => n.includes(name.toLowerCase())));
      return ok ? 0 : -Infinity;
    }
    case "damage_per_all_opponent_counters": {
      const total = allPokemonInPlay(opponent).reduce(
        (sum, mon) => sum + Math.floor(mon.damageCounters / 10),
        0,
      );
      return total * effect.perCounter;
    }
    case "damage_bonus_if_any_bench_damaged":
      return player.bench.some((mon) => mon.damageCounters > 0) ? effect.amount : 0;
    case "damage_bonus_if_energy_in_play": {
      const total = allPokemonInPlay(player).reduce((sum, mon) => sum + mon.attachedEnergy.length, 0);
      return total >= effect.minEnergy ? effect.amount : 0;
    }
    case "damage_bonus_if_typed_energy_in_play": {
      const type = effect.energyType.toLowerCase();
      const total = allPokemonInPlay(player).reduce((sum, mon) => {
        return (
          sum +
          mon.attachedEnergy.filter((energy) => {
            const def = getDefinitionSafe(state, energy.definitionId);
            return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
          }).length
        );
      }, 0);
      return total >= effect.minEnergy ? effect.amount : 0;
    }
    case "damage_bonus_if_played_named_supporter":
      return 0;
    case "damage_bonus_if_benched_named_damaged": {
      const filter = effect.nameFilter.toLowerCase();
      const damaged = player.bench.some(
        (mon) =>
          getDefinitionSafe(state, mon.definitionId).name.toLowerCase().includes(filter) &&
          mon.damageCounters > 0,
      );
      return damaged ? effect.amount : 0;
    }
    case "damage_bonus_if_retreat_cost": {
      const def = opponent.active ? getDefinitionSafe(state, opponent.active.definitionId) : null;
      const cost = def?.retreatCost?.length ?? 0;
      const min = effect.minCost.replace(/colorless/gi, "").length || 2;
      return cost >= min ? effect.amount : 0;
    }
    case "damage_bonus_if_deck_at_most":
      return player.deck.length <= effect.maxCards ? effect.amount : 0;
    case "damage_bonus_if_team_attack_last_turn":
      return effect.amount;
    case "coin_tier_damage": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      const heads = results.filter(Boolean).length;
      if (effect.heads >= 99 && heads === results.length && results.length > 0) return effect.amount;
      return heads >= effect.heads ? effect.amount : 0;
    }
    case "damage_bonus_if_discarded_any":
      return effect.amount;
    case "damage_bonus_if_bench_names": {
      const benchNames = player.bench.map((mon) =>
        getDefinitionSafe(state, mon.definitionId).name.toLowerCase(),
      );
      const ok = effect.names.every((name) => benchNames.some((n) => n.includes(name.toLowerCase())));
      return ok ? effect.amount : 0;
    }
    case "damage_bonus_if_hand_equal":
      return player.hand.length === opponent.hand.length ? effect.amount : 0;
    case "damage_bonus_if_bench_name": {
      const filter = effect.nameFilter.toLowerCase();
      return player.bench.some((mon) =>
        getDefinitionSafe(state, mon.definitionId).name.toLowerCase().includes(filter),
      )
        ? effect.amount
        : 0;
    }
    case "damage_less_per_opponent_active_energy":
      return -(opponent.active?.attachedEnergy.length ?? 0) * effect.perEnergy;
    case "coin_both_heads_damage_bonus": {
      const results = state.turnFlags.lastCoinFlipResults ?? [];
      return results.length >= 2 && results.every(Boolean) ? effect.amount : 0;
    }
    case "damage_bonus_if_bench_type_stage": {
      return player.bench.some((mon) => {
        const def = getDefinitionSafe(state, mon.definitionId);
        const stageMatch = def.subtypes.find((s) => /^Stage \d+$/.test(s));
        const stage = stageMatch ? parseInt(stageMatch.replace("Stage ", ""), 10) : 1;
        return (
          stage >= effect.stage &&
          def.types?.some((t) => t.toLowerCase() === effect.typeFilter.toLowerCase())
        );
      })
        ? effect.amount
        : 0;
    }
    case "damage_bonus_if_card_in_discard": {
      const filter = effect.nameFilter.toLowerCase();
      return player.discard.some((card) =>
        getDefinitionSafe(state, card.definitionId).name.toLowerCase().includes(filter),
      )
        ? effect.amount
        : 0;
    }
    case "attack_fails_unless_played_card":
      return -Infinity;
    default:
      return 0;
  }
}

export function isSecondPlayerFirstTurnBlocked(
  state: EngineState,
  playerId: import("../../models/enums").PlayerId,
  effects: ParsedEffect[],
): boolean {
  if (!effects.some((effect) => effect.kind === "blocked_if_second_player_first_turn")) {
    return false;
  }
  return (
    playerId !== state.firstPlayerId &&
    state.turnNumber === 2 &&
    state.currentPlayerId === playerId
  );
}

import { parseAbilityText } from "./parseText";

export function shouldPreventDamageFromAttacker(
  target: CardInstance,
  attackerDef: ReturnType<typeof getDefinitionSafe>,
): boolean {
  if (target.preventDamageFromBasicNonColorless !== "active") return false;
  return isBasicNonColorlessPokemon(attackerDef);
}

export function shouldPreventDamageFromAbilityPokemon(
  state: EngineState,
  defender: CardInstance,
  attackerDef: ReturnType<typeof getDefinitionSafe>,
): boolean {
  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  for (const ability of defenderDef.abilities ?? []) {
    for (const effect of parseAbilityText(ability).effects) {
      if (effect.kind === "prevent_damage_from_ability_pokemon" && (attackerDef.abilities?.length ?? 0) > 0) {
        return true;
      }
    }
  }
  return false;
}
