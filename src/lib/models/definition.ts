import type { Supertype } from "./enums";

export interface CardAttack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

export interface CardAbility {
  name: string;
  text: string;
  type: string;
}

export interface CardImages {
  small: string;
  large: string;
}

export interface CardSetInfo {
  id: string;
  name: string;
  ptcgoCode?: string;
}

export interface CardDefinition {
  apiId: string;
  name: string;
  supertype: Supertype;
  subtypes: string[];
  hp?: string;
  types?: string[];
  attacks?: CardAttack[];
  abilities?: CardAbility[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  rules?: string[];
  regulationMark?: string;
  set: CardSetInfo;
  number: string;
  images: CardImages;
  evolvesFrom?: string;
}

export function isBasicPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.subtypes.includes("Basic");
}

export function isStage1(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.subtypes.includes("Stage 1");
}

export function isStage2(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.subtypes.includes("Stage 2");
}

export function isEvolutionPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && (isStage1(def) || isStage2(def));
}

export function isEnergyCard(def: CardDefinition): boolean {
  return def.supertype === "Energy";
}

export function isSupporter(def: CardDefinition): boolean {
  return def.supertype === "Trainer" && def.subtypes.includes("Supporter");
}

export function isStadium(def: CardDefinition): boolean {
  return def.supertype === "Trainer" && def.subtypes.includes("Stadium");
}

export function isItemTrainer(def: CardDefinition): boolean {
  return def.supertype === "Trainer" && def.subtypes.includes("Item");
}

export function isTool(def: CardDefinition): boolean {
  // The Pokémon TCG API labels tools "Pokémon Tool"; some sources shorten it to
  // "Tool". Accept both so Tools are never mistaken for Items.
  return (
    def.supertype === "Trainer" &&
    def.subtypes.some((s) => s === "Tool" || s === "Pokémon Tool")
  );
}

export function isTeamRocketPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.name.toLowerCase().includes("team rocket's");
}

export function isCynthiasPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.name.toLowerCase().startsWith("cynthia's ");
}

export function isLilliesPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.name.toLowerCase().startsWith("lillie's ");
}

export function isNsPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && /^n's /i.test(def.name);
}

export function isPokemonEx(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && (hasRuleBox(def) || def.subtypes.includes("ex"));
}

export function isPokemonExOrV(def: CardDefinition): boolean {
  if (def.supertype !== "Pokémon") return false;
  const exOrVSubtypes = ["ex", "EX", "V", "VMAX", "VSTAR", "V-UNION"];
  if (def.subtypes.some((subtype) => exOrVSubtypes.includes(subtype))) return true;
  if (/\sex$/i.test(def.name.trim())) return true;
  return false;
}

export function isTeamRocketSupporter(def: CardDefinition): boolean {
  return isSupporter(def) && def.name.toLowerCase().includes("team rocket");
}

export function isProtonSupporter(def: CardDefinition): boolean {
  return isSupporter(def) && def.name === "Team Rocket's Proton";
}

export function isCarmineCard(def: CardDefinition): boolean {
  return isSupporter(def) && def.name === "Carmine";
}

export function isMegaEvolutionEx(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.subtypes.includes("MEGA") && def.subtypes.includes("ex");
}

export function isTeraPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && def.subtypes.includes("Tera");
}

export function isColorlessPokemon(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && (def.types?.includes("Colorless") ?? false);
}

export function isBasicEnergy(def: CardDefinition): boolean {
  return def.supertype === "Energy" && def.subtypes.includes("Basic");
}

// CRI (Chaos Rising) Special Energy — recognized by name, like the other
// special energies in engine/effects/specialEnergyEffects.ts. These live here
// (a leaf module) because stadiumEffects/abilityHooks also need them and
// importing specialEnergyEffects from there would create an import cycle.
export function isBubblyWaterEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("bubbly water energy") ?? false;
}

export function isMagneticMetalEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("magnetic metal energy") ?? false;
}

export function isNitroFireEnergy(def: CardDefinition | undefined): boolean {
  return def?.name.toLowerCase().includes("nitro fire energy") ?? false;
}

export function isAceSpec(def: CardDefinition): boolean {
  return def.subtypes.includes("ACE SPEC");
}

export function isRadiant(def: CardDefinition): boolean {
  return def.subtypes.includes("Radiant");
}

export function hasRuleBox(def: CardDefinition): boolean {
  if (def.supertype !== "Pokémon") return false;
  const ruleBoxSubtypes = ["ex", "EX", "V", "VMAX", "VSTAR", "V-UNION", "GX"];
  if (def.subtypes.some((subtype) => ruleBoxSubtypes.includes(subtype))) return true;
  if (isRadiant(def) || isAceSpec(def)) return true;
  if (def.rules?.some((rule) => /rule box|pokémon ex rule|pokémon v rule/i.test(rule))) return true;
  if (/\sex$/i.test(def.name.trim())) return true;
  return false;
}

export function isPokemonWithoutRuleBox(def: CardDefinition): boolean {
  return def.supertype === "Pokémon" && !hasRuleBox(def);
}

export function getHp(def: CardDefinition): number {
  return parseInt(def.hp ?? "0", 10) || 0;
}

export function deckCopyKey(def: CardDefinition): string {
  if (isBasicEnergy(def)) {
    return `energy:${def.name}`;
  }
  return `card:${def.name}`;
}
