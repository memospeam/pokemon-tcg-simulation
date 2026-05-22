import type { CardDefinition } from "../models/definition";
import type { PokemonTcgApiResponse } from "./types";
import { mapApiCard } from "./mapApiCard";

const API_BASE = "https://api.pokemontcg.io/v2";

function escapeQueryValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export { mapApiCard } from "./mapApiCard";

export class PokemonTcgClient {
  constructor(private readonly apiKey?: string) {}

  async searchCards(query: string): Promise<CardDefinition[]> {
    const params = new URLSearchParams({
      q: query,
      pageSize: "10",
      orderBy: "-set.releaseDate",
    });

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) {
      headers["X-Api-Key"] = this.apiKey;
    }

    const response = await fetch(`${API_BASE}/cards?${params.toString()}`, { headers });
    if (!response.ok) {
      throw new Error(`Pokemon TCG API error: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as PokemonTcgApiResponse;
    return payload.data.map(mapApiCard);
  }

  buildExactQuery(name: string, setCode?: string, number?: string): string {
    const parts = [`name:${escapeQueryValue(name)}`];
    if (setCode) {
      parts.push(`set.ptcgoCode:${setCode}`);
    }
    if (number) {
      parts.push(`number:${number}`);
    }
    return parts.join(" ");
  }
}

export function getApiKey(): string | undefined {
  return import.meta.env.VITE_POKEMONTCG_API_KEY as string | undefined;
}

export function createDefaultClient(): PokemonTcgClient {
  return new PokemonTcgClient(getApiKey());
}
