import { isBasicEnergy, type CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import type { PlayerId } from "../../models/enums";
import { getDefinition, getPlayer, type EngineState } from "../types";
import {
  abilityRequiresKnockOutSelf,
  getExecutableAbilityEffects,
  hasActivatableAbility,
} from "./abilityMeta";
import { isAbilityDisabledOnPokemon } from "./abilityHooks";
import type { AbilityCondition, ParsedAbility, ParsedEffect } from "./types";
import { parseAbilityText } from "./parseText";

export { getExecutableAbilityEffects, hasActivatableAbility, abilityRequiresKnockOutSelf };

function handHasBasicEnergyOfType(state: EngineState, playerId: PlayerId, energyType: string): boolean {
  const player = getPlayer(state, playerId);
  const type = energyType.toLowerCase();
  return player.hand.some((card) => {
    const def = getDefinition(state, card.definitionId);
    if (!def || !isBasicEnergy(def)) return false;
    return def.name.toLowerCase().includes(type) || def.types?.some((t) => t.toLowerCase() === type);
  });
}

function abilityNeedsHandEnergy(effects: ParsedEffect[]): ParsedEffect | null {
  for (const effect of effects) {
    if (effect.kind === "attach_basic_energy_from_hand") return effect;
    if (effect.kind === "require_hand_energy_in_active") return effect;
  }
  return null;
}

function isPlayersFirstTurn(state: EngineState, playerId: PlayerId): boolean {
  if (playerId === state.firstPlayerId) {
    return state.turnNumber === 1 && state.currentPlayerId === playerId;
  }
  return state.turnNumber === 2 && state.currentPlayerId === playerId;
}

export function getPokemonAbilities(def: CardDefinition): ParsedAbility[] {
  return (def.abilities ?? []).map((ability) => parseAbilityText(ability));
}

function energyMatchesType(energyDef: CardDefinition, energyType: string): boolean {
  const name = energyDef.name.toLowerCase();
  const type = energyType.toLowerCase();
  if (type === "darkness" || type === "dark") {
    return name.includes("dark") || energyDef.types?.includes("Darkness") === true;
  }
  return energyDef.types?.some((t) => t.toLowerCase() === type) ?? name.includes(type);
}

export function meetsAbilityConditions(
  state: EngineState,
  pokemon: CardInstance,
  conditions: AbilityCondition[],
): boolean {
  if (conditions.length === 0) return true;

  for (const condition of conditions) {
    if (condition.type === "has_any_energy") {
      if (pokemon.attachedEnergy.length === 0) return false;
      continue;
    }
    if (condition.type === "has_energy_type") {
      const hasType = pokemon.attachedEnergy.some((energy) => {
        const def = getDefinition(state, energy.definitionId);
        return def && energyMatchesType(def, condition.energyType);
      });
      if (!hasType) return false;
    }
  }
  return true;
}

export function abilityUsageKey(pokemonId: string, abilityName: string): string {
  return `${pokemonId}:${abilityName}`;
}

export function canUseAbilityNow(
  state: EngineState,
  pokemon: CardInstance,
  parsed: ParsedAbility,
): boolean {
  if (parsed.frequency === "passive") return false;
  if (!hasActivatableAbility(parsed)) return false;
  if (isAbilityDisabledOnPokemon(state, pokemon)) return false;

  const player = getPlayer(state, pokemon.ownerId);
  if (parsed.effects.some((effect) => effect.kind === "ability_only_while_active")) {
    if (player.active?.instanceId !== pokemon.instanceId) return false;
  }

  if (parsed.effects.some((effect) => effect.kind === "cant_use_ability_first_turn")) {
    if (isPlayersFirstTurn(state, pokemon.ownerId)) return false;
  }

  if (parsed.effects.some((effect) => effect.kind === "once_during_first_turn")) {
    if (!isPlayersFirstTurn(state, pokemon.ownerId)) return false;
  }

  for (const effect of parsed.effects) {
    if (effect.kind === "ability_use_limit_per_turn") {
      const pattern = effect.namePattern.toLowerCase();
      if (state.turnFlags.namedAbilitiesUsedThisTurn.some((name) => name.includes(pattern))) {
        return false;
      }
    }
    if (effect.kind === "require_discard_hand_count_for_ability") {
      if (player.hand.length < effect.count) return false;
    }
    if (effect.kind === "require_discard_named_for_ability") {
      const filter = effect.nameFilter.toLowerCase();
      if (!player.hand.some((card) => getDefinition(state, card.definitionId)?.name.toLowerCase().includes(filter))) {
        return false;
      }
    }
    if (effect.kind === "require_bottom_deck_hand_for_ability" && player.hand.length === 0) {
      return false;
    }
    if (effect.kind === "require_discard_energy_to_use_ability") {
      const hasEnergy = pokemon.attachedEnergy.some((energy) => {
        const def = getDefinition(state, energy.definitionId);
        return def && energyMatchesType(def, effect.energyType);
      });
      if (!hasEnergy) return false;
    }
  }

  if (parsed.frequency === "once_per_turn") {
    const key = abilityUsageKey(pokemon.instanceId, parsed.name);
    if (state.turnFlags.abilitiesUsed.includes(key)) return false;
  }
  if (!meetsAbilityConditions(state, pokemon, parsed.conditions)) return false;

  if (parsed.conditions.some((condition) => condition.type === "discard_from_hand_to_use")) {
    if (player.hand.length === 0) return false;
  }

  const attachEffect = abilityNeedsHandEnergy(parsed.effects);
  if (attachEffect && "energyType" in attachEffect) {
    if (!handHasBasicEnergyOfType(state, pokemon.ownerId, attachEffect.energyType)) {
      return false;
    }
  }

  for (const effect of parsed.effects) {
    if (effect.kind === "recon_directive" && player.deck.length === 0) {
      return false;
    }
  }
  return true;
}

export function markAbilityUsed(
  state: EngineState,
  pokemon: CardInstance,
  abilityName: string,
  parsed: ParsedAbility,
): void {
  if (parsed.frequency === "once_per_turn") {
    const key = abilityUsageKey(pokemon.instanceId, abilityName);
    if (!state.turnFlags.abilitiesUsed.includes(key)) {
      state.turnFlags.abilitiesUsed.push(key);
    }
  }
  for (const effect of parsed.effects) {
    if (effect.kind === "ability_use_limit_per_turn") {
      const pattern = effect.namePattern.toLowerCase();
      if (!state.turnFlags.namedAbilitiesUsedThisTurn.includes(pattern)) {
        state.turnFlags.namedAbilitiesUsedThisTurn.push(pattern);
      }
    }
  }
}

export function summarizeAbility(parsed: ParsedAbility): string {
  const parts: string[] = [];
  if (parsed.frequency === "passive") {
    parts.push("Passive");
  }
  if (parsed.conditions.some((c) => c.type === "has_energy_type")) {
    parts.push("Requires matching Energy attached");
  }
  const executable = getExecutableAbilityEffects(parsed.effects);
  if (executable.length > 0) {
    parts.push(
      executable
        .map((e) => {
          if (e.kind === "move_damage") return `Move up to ${e.maxCounters} damage counters`;
          if (e.kind === "recon_directive") return "Look at top 2 of deck, pick 1";
          if (e.kind === "draw") return `Draw ${e.count}`;
          if (e.kind === "search_any_to_hand") return "Search deck";
          if (e.kind === "heal") return `Heal ${e.amount}`;
          return e.kind.replace(/_/g, " ");
        })
        .join(", "),
    );
  }
  return parts.join(" · ") || parsed.rawText.slice(0, 80);
}
