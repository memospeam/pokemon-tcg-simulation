import type { CardDefinition } from "../../models/definition";
import { hasRuleBox, isBasicPokemon, isBubblyWaterEnergy, isColorlessPokemon, isPokemonExOrV, isStage2, isStadium } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import { PlayerId, Zone } from "../../models/enums";
import { getDefinitionSafe } from "../rules";
import { logMessage } from "../helpers";
import { allPokemonInPlay, getDefinition, getPlayer, type EngineState } from "../types";
import { parseStadiumFullText } from "./parseTextTrainer";
import { resolveBenchKnockouts } from "./execute";
import type { ParsedEffect } from "./types";

export type StadiumKind =
  | "battle_cage"
  | "risky_ruins"
  | "watchtower"
  | "forest_vitality"
  | "area_zero"
  | "gravity_mountain"
  | "grand_tree"
  | "lumiose_city"
  | "team_rocket_factory"
  | "ns_castle"
  | "festival_grounds"
  | "neutralization_zone"
  | "unknown";

function toStadiumKind(kind: ParsedEffect["kind"]): StadiumKind | null {
  switch (kind) {
    case "stadium_battle_cage":
      return "battle_cage";
    case "stadium_risky_ruins":
      return "risky_ruins";
    case "stadium_watchtower":
      return "watchtower";
    case "stadium_forest_vitality":
      return "forest_vitality";
    case "stadium_area_zero":
      return "area_zero";
    case "stadium_gravity_mountain":
      return "gravity_mountain";
    case "stadium_grand_tree":
      return "grand_tree";
    case "stadium_lumiose_city":
      return "lumiose_city";
    case "stadium_team_rocket_factory":
      return "team_rocket_factory";
    case "stadium_ns_castle":
      return "ns_castle";
    case "stadium_festival_grounds":
      return "festival_grounds";
    case "stadium_neutralization_zone":
      return "neutralization_zone";
    default:
      return null;
  }
}

export function getStadiumKind(state: EngineState): StadiumKind | null {
  if (!state.stadium) return null;
  const def = getDefinition(state, state.stadium.definitionId);
  if (!def) return null;
  const parsed = parseStadiumFullText(def.rules?.join(" ") ?? def.name);
  if (!parsed) return "unknown";
  return toStadiumKind(parsed.kind) ?? "unknown";
}

export function logStadiumOnPlay(state: EngineState, def: CardDefinition): void {
  const parsed = parseStadiumFullText(def.rules?.join(" ") ?? "");
  const kind = parsed ? toStadiumKind(parsed.kind) : null;
  if (kind === "area_zero") {
    logMessage(state, "Area Zero Underdepths: Tera Pokémon may have up to 8 Bench slots (partial support).");
  } else if (kind === "forest_vitality") {
    logMessage(state, "Forest of Vitality: Grass Pokémon may evolve the turn they are played (except first turn).");
  } else if (kind === "gravity_mountain") {
    logMessage(state, "Gravity Mountain: Stage 2 Pokémon in play get -30 HP.");
  } else if (kind === "grand_tree") {
    logMessage(state, "Grand Tree: once per turn, evolve from deck (Stage 1, then optional Stage 2).");
  } else if (kind === "lumiose_city") {
    logMessage(state, "Lumiose City: once per turn search a Basic Pokémon to Bench (ends turn).");
  } else if (kind === "team_rocket_factory") {
    logMessage(state, "Team Rocket's Factory: draw 2 after playing a Team Rocket Supporter.");
  } else if (kind === "ns_castle") {
    logMessage(state, "N's Castle: N's Pokémon have no Retreat Cost.");
  } else if (kind === "festival_grounds") {
    logMessage(
      state,
      "Festival Grounds: Pokémon with Energy attached recover from and can't be affected by Special Conditions.",
    );
    clearAllFestivalGroundsEligibleSpecialConditions(state);
  } else if (kind === "neutralization_zone") {
    logMessage(
      state,
      "Neutralization Zone: non-Rule Box Pokémon are protected from opponent ex/V attack damage.",
    );
  }
}

export function applyRiskyRuinsOnBenchPlay(
  state: EngineState,
  pokemon: CardInstance,
  _playerId: PlayerId,
): void {
  if (getStadiumKind(state) !== "risky_ruins") return;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  if (!isBasicPokemon(def)) return;
  if (def.types?.includes("Darkness")) return;
  pokemon.damageCounters += 20;
  logMessage(
    state,
    `${def.name} took 20 damage from Risky Ruins (2 damage counters).`,
  );
  // Resolve the KO immediately — Risky Ruins can bring a Benched Pokémon to its
  // HP, and without this it would persist on the Bench as a "zombie" (dead but
  // still in play). resolveBenchKnockouts is idempotent (no-op when nothing is
  // KO'd). The execute.ts↔stadiumEffects import cycle is safe here because the
  // binding is only used at call-time, never at module init.
  resolveBenchKnockouts(state);
}

export function shouldBlockBenchEffectDamage(
  state: EngineState,
  target: CardInstance,
  sourcePlayerId: PlayerId,
): boolean {
  if (getStadiumKind(state) !== "battle_cage") return false;
  const owner = getPlayer(state, target.ownerId);
  const onBench =
    target.zone === Zone.Bench || owner.bench.some((b) => b.instanceId === target.instanceId);
  if (!onBench) return false;
  return sourcePlayerId !== target.ownerId;
}

export function areStadiumAbilitiesDisabled(state: EngineState, pokemon: CardInstance): boolean {
  if (getStadiumKind(state) !== "watchtower") return false;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return isColorlessPokemon(def);
}

export function canEvolveSameTurnWithForestVitality(
  state: EngineState,
  pokemon: CardInstance,
): boolean {
  if (getStadiumKind(state) !== "forest_vitality") return false;
  if (state.turnNumber === 1 && state.currentPlayerId === state.firstPlayerId) return false;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return def.types?.includes("Grass") ?? false;
}

export function getMaxBenchSize(state: EngineState, playerId: PlayerId): number {
  if (getStadiumKind(state) !== "area_zero") return 5;
  const player = getPlayer(state, playerId);
  const hasTera = [...(player.active ? [player.active] : []), ...player.bench].some((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    return def.subtypes.includes("Tera");
  });
  return hasTera ? 8 : 5;
}

export function getStadiumHpModifier(state: EngineState, pokemon: CardInstance): number {
  if (getStadiumKind(state) !== "gravity_mountain") return 0;
  const def = getDefinitionSafe(state, pokemon.definitionId);
  return isStage2(def) ? -30 : 0;
}

export function canUseLumioseCity(state: EngineState, playerId: PlayerId): boolean {
  if (getStadiumKind(state) !== "lumiose_city") return false;
  if (state.turnFlags.stadiumOncePerTurnUsed) return false;
  const player = getPlayer(state, playerId);
  if (player.bench.length >= getMaxBenchSize(state, playerId)) return false;
  return player.deck.some((card) => isBasicPokemon(getDefinitionSafe(state, card.definitionId)));
}

export function getLumioseDeckOptions(state: EngineState, playerId: PlayerId): CardInstance[] {
  const player = getPlayer(state, playerId);
  return player.deck.filter((card) => isBasicPokemon(getDefinitionSafe(state, card.definitionId)));
}

export function parseStadiumRules(def: CardDefinition): { kind: StadiumKind } | null {
  if (!isStadium(def)) return null;
  const parsed = parseStadiumFullText(def.rules?.join(" ") ?? "");
  if (!parsed) return null;
  const kind = toStadiumKind(parsed.kind);
  return kind ? { kind } : null;
}

export function hasFestivalGroundsSpecialConditionImmunity(
  state: EngineState,
  pokemon: CardInstance,
): boolean {
  if (getStadiumKind(state) !== "festival_grounds") return false;
  return pokemon.attachedEnergy.length > 0;
}

/** Bubbly Water Energy: the Water Pokémon it is attached to can't be affected
 *  by any Special Conditions. */
export function hasBubblyWaterSpecialConditionImmunity(
  state: EngineState,
  pokemon: CardInstance,
): boolean {
  const def = getDefinitionSafe(state, pokemon.definitionId);
  if (!(def.types?.includes("Water") ?? false)) return false;
  return pokemon.attachedEnergy.some((energy) =>
    isBubblyWaterEnergy(getDefinition(state, energy.definitionId) ?? undefined),
  );
}

export function applySpecialCondition(
  state: EngineState,
  pokemon: CardInstance,
  status: string,
): boolean {
  if (hasFestivalGroundsSpecialConditionImmunity(state, pokemon)) {
    return false;
  }
  if (hasBubblyWaterSpecialConditionImmunity(state, pokemon)) {
    return false;
  }
  if (!pokemon.statusConditions.includes(status)) {
    pokemon.statusConditions.push(status);
  }
  return true;
}

export function clearFestivalGroundsSpecialConditions(state: EngineState, pokemon: CardInstance): void {
  if (!hasFestivalGroundsSpecialConditionImmunity(state, pokemon)) return;
  if (pokemon.statusConditions.length === 0) return;
  pokemon.statusConditions = [];
  const def = getDefinitionSafe(state, pokemon.definitionId);
  logMessage(state, `${def.name} recovered from all Special Conditions (Festival Grounds).`);
}

export function clearAllFestivalGroundsEligibleSpecialConditions(state: EngineState): void {
  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(state, playerId);
    for (const pokemon of allPokemonInPlay(player)) {
      clearFestivalGroundsSpecialConditions(state, pokemon);
    }
  }
}

export function shouldNeutralizationZonePreventDamage(
  state: EngineState,
  defender: CardInstance,
  attacker: CardInstance | null | undefined,
): boolean {
  if (getStadiumKind(state) !== "neutralization_zone") return false;
  if (!attacker) return false;
  const defenderDef = getDefinitionSafe(state, defender.definitionId);
  if (hasRuleBox(defenderDef)) return false;
  const attackerDef = getDefinitionSafe(state, attacker.definitionId);
  return isPokemonExOrV(attackerDef);
}

export function canReturnCardFromDiscardToHandOrDeck(
  state: EngineState,
  card: CardInstance,
): boolean {
  const def = getDefinitionSafe(state, card.definitionId);
  if (!isStadium(def)) return true;
  const parsed = parseStadiumFullText(def.rules?.join(" ") ?? def.name);
  return parsed?.kind !== "stadium_neutralization_zone";
}
