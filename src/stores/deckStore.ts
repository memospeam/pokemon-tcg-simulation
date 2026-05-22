import { create } from "zustand";
import type { BuiltDeck } from "@/lib/deck/builder";
import { deleteSavedDeck, loadSavedDecks, renameSavedDeck, saveDeckToLibrary, type SavedDeck } from "@/lib/deck/storage";

interface DeckStore {
  savedDecks: SavedDeck[];
  player1Deck: BuiltDeck | null;
  player2Deck: BuiltDeck | null;
  refreshSavedDecks: () => void;
  setPlayer1Deck: (deck: BuiltDeck | null) => void;
  setPlayer2Deck: (deck: BuiltDeck | null) => void;
  saveDeck: (deck: BuiltDeck) => void;
  removeDeck: (id: string) => void;
  renameDeck: (id: string, name: string) => void;
}

export const useDeckStore = create<DeckStore>((set) => ({
  savedDecks: loadSavedDecks(),
  player1Deck: null,
  player2Deck: null,
  refreshSavedDecks: () => set({ savedDecks: loadSavedDecks() }),
  setPlayer1Deck: (deck) => set({ player1Deck: deck }),
  setPlayer2Deck: (deck) => set({ player2Deck: deck }),
  saveDeck: (deck) => set({ savedDecks: saveDeckToLibrary(deck) }),
  removeDeck: (id) => set({ savedDecks: deleteSavedDeck(id) }),
  renameDeck: (id, name) => set({ savedDecks: renameSavedDeck(id, name) }),
}));
