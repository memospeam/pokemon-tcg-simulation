import { get, set } from "idb-keyval";
import type { CardDefinition } from "../models/definition";

const CACHE_PREFIX = "pokemon-tcg-card:";

export async function getCachedDefinition(apiId: string): Promise<CardDefinition | undefined> {
  return get<CardDefinition>(`${CACHE_PREFIX}${apiId}`);
}

export async function cacheDefinition(definition: CardDefinition): Promise<void> {
  await set(`${CACHE_PREFIX}${definition.apiId}`, definition);
}

export async function getCachedByLookupKey(key: string): Promise<CardDefinition | undefined> {
  return get<CardDefinition>(`${CACHE_PREFIX}lookup:${key}`);
}

export async function cacheByLookupKey(key: string, definition: CardDefinition): Promise<void> {
  await set(`${CACHE_PREFIX}lookup:${key}`, definition);
  await cacheDefinition(definition);
}
