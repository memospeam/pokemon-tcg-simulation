import type { BuiltDeck } from "./builder";

const STORAGE_KEY = "pokemon-tcg-my-decks";

export interface SavedDeck {
  id: string;
  name: string;
  text: string;
  savedAt: string;
}

export function loadSavedDecks(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedDeck[];
  } catch {
    return [];
  }
}

export function saveDeckToLibrary(deck: BuiltDeck): SavedDeck[] {
  const existing = loadSavedDecks().filter((entry) => entry.name !== deck.name);
  const saved: SavedDeck = {
    id: deck.id,
    name: deck.name,
    text: deck.text,
    savedAt: new Date().toISOString(),
  };
  const next = [saved, ...existing];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteSavedDeck(id: string): SavedDeck[] {
  const next = loadSavedDecks().filter((entry) => entry.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function renameSavedDeck(id: string, name: string): SavedDeck[] {
  const next = loadSavedDecks().map((entry) =>
    entry.id === id ? { ...entry, name, savedAt: new Date().toISOString() } : entry,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

const GAME_SAVE_KEY = "pokemon-tcg-saved-game";

export function saveGameState(state: unknown): void {
  localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(state));
}

export function loadGameState<T>(): T | null {
  try {
    const raw = localStorage.getItem(GAME_SAVE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearGameState(): void {
  localStorage.removeItem(GAME_SAVE_KEY);
}
