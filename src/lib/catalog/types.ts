import type { CardDefinition } from "../models/definition";

export interface PokemonTcgApiCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  attacks?: {
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }[];
  abilities?: { name: string; text: string; type: string }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  rules?: string[];
  regulationMark?: string;
  evolvesFrom?: string;
  set: { id: string; name: string; ptcgoCode?: string };
  number: string;
  images: { small: string; large: string };
}

export interface PokemonTcgApiResponse {
  data: PokemonTcgApiCard[];
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
}

export interface ResolveLineInput {
  count: number;
  name: string;
  setCode?: string;
  number?: string;
}

export interface ResolveLineResult {
  input: ResolveLineInput;
  definition?: CardDefinition;
  error?: string;
}

export interface ResolvedDeck {
  name: string;
  definitions: CardDefinition[];
  instances: { definitionId: string; count: number }[];
  errors: ResolveLineResult[];
  warnings: string[];
}
