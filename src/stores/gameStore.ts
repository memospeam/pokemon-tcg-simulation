import { create } from "zustand";
import type { BuiltDeck } from "@/lib/deck/builder";
import { clearGameState, loadGameState, saveGameState } from "@/lib/deck/storage";
import { beginGame, gameReducer, getLegalActions, startActiveGame, type EngineState, type GameAction } from "@/lib/engine";

interface GameStore {
  engineState: EngineState | null;
  legalActions: GameAction[];
  startMatch: (input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
  }) => void;
  dispatch: (action: GameAction) => void;
  startGame: () => void;
  loadSaved: () => boolean;
  clearSaved: () => void;
}

function withActions(state: EngineState | null): Pick<GameStore, "engineState" | "legalActions"> {
  if (!state) return { engineState: null, legalActions: [] };
  return { engineState: state, legalActions: getLegalActions(state) };
}

export const useGameStore = create<GameStore>((set, get) => ({
  engineState: null,
  legalActions: [],
  startMatch: ({ player1Name, player2Name, player1Deck, player2Deck, seed }) => {
    const extraDefinitions = [
      ...player1Deck.definitions.values(),
      ...player2Deck.definitions.values(),
    ];
    const state = beginGame({
      player1Name,
      player2Name,
      player1Cards: player1Deck.cards,
      player2Cards: player2Deck.cards,
      extraDefinitions,
      seed,
    });
    state.viewingPlayerId = state.currentPlayerId;
    saveGameState(state);
    set(withActions(state));
  },
  dispatch: (action) => {
    const current = get().engineState;
    if (!current) return;
    const next = gameReducer(current, action);
    saveGameState(next);
    set(withActions(next));
  },
  startGame: () => {
    const current = get().engineState;
    if (!current) return;
    const next = startActiveGame(current);
    saveGameState(next);
    set(withActions(next));
  },
  loadSaved: () => {
    const saved = loadGameState<EngineState>();
    if (!saved) return false;
    set(withActions(saved));
    return true;
  },
  clearSaved: () => {
    clearGameState();
    set({ engineState: null, legalActions: [] });
  },
}));
