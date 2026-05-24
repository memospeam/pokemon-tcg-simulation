import { get, set } from "idb-keyval";
import type { CardDefinition } from "../models/definition";

const CACHE_PREFIX = "pokemon-tcg-card:";
const memoryStore = new Map<string, CardDefinition>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

async function readCache(key: string): Promise<CardDefinition | undefined> {
  if (hasIndexedDb()) {
    return get<CardDefinition>(key);
  }
  return memoryStore.get(key);
}

async function writeCache(key: string, definition: CardDefinition): Promise<void> {
  if (hasIndexedDb()) {
    await set(key, definition);
    return;
  }
  memoryStore.set(key, definition);
}

export async function getCachedDefinition(apiId: string): Promise<CardDefinition | undefined> {
  return readCache(`${CACHE_PREFIX}${apiId}`);
}

export async function cacheDefinition(definition: CardDefinition): Promise<void> {
  await writeCache(`${CACHE_PREFIX}${definition.apiId}`, definition);
}

export async function getCachedByLookupKey(key: string): Promise<CardDefinition | undefined> {
  return readCache(`${CACHE_PREFIX}lookup:${key}`);
}

export async function cacheByLookupKey(key: string, definition: CardDefinition): Promise<void> {
  await writeCache(`${CACHE_PREFIX}lookup:${key}`, definition);
  await cacheDefinition(definition);
}
