import { create } from "zustand";
import type { BuiltDeck } from "@/lib/deck/builder";
import { clearGameState, loadGameState, saveGameState } from "@/lib/deck/storage";
import { beginGame, gameReducer, getLegalActions, startActiveGame, type EngineState, type GameAction } from "@/lib/engine";
import { PlayerId } from "@/lib/models/enums";
import { autoSetupEngineState, runAISingleTurn } from "@/lib/deck/utrechtGameRunner";
import { buildStrategyContext, type StrategyContext } from "@/lib/deck/deckStrategy";
import { getDefinition, getPlayer } from "@/lib/engine";

interface GameStore {
  engineState: EngineState | null;
  legalActions: GameAction[];
  /** When non-null, P2 is AI and this is the human's player ID (always P1 for now). */
  humanPlayerId: PlayerId | null;
  isAIThinking: boolean;
  startMatch: (input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
    vsAI?: boolean;
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

/** Build a StrategyContext for the AI (P2) from the current engine state. */
function buildAIContext(state: EngineState): StrategyContext {
  const aiId = PlayerId.P2;
  const player = getPlayer(state, aiId);
  const allCards = [
    ...player.deck,
    ...player.hand,
    ...(player.active ? [player.active] : []),
    ...player.bench,
    ...player.discard,
  ];
  const names = allCards.map((c) => getDefinition(state, c.definitionId)?.name ?? "");
  return buildStrategyContext(names);
}

export const useGameStore = create<GameStore>((set, get) => {
  /** After any state update, run the AI turn if it's the AI's move. */
  function maybeRunAI(state: EngineState, humanPlayerId: PlayerId | null): EngineState {
    if (!humanPlayerId) return state; // Human vs Human — no AI
    const aiId = humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;

    // Check if it's the AI's turn and there's no pending action that needs human input
    if (state.winnerId) return state;
    if (state.currentPlayerId !== aiId) return state;
    if (state.pendingAction && state.pendingAction.playerId !== aiId) return state;

    const ctx = buildAIContext(state);
    return runAISingleTurn(state, ctx);
  }

  return {
    engineState: null,
    legalActions: [],
    humanPlayerId: null,
    isAIThinking: false,

    startMatch: ({ player1Name, player2Name, player1Deck, player2Deck, seed, vsAI }) => {
      const extraDefinitions = [
        ...player1Deck.definitions.values(),
        ...player2Deck.definitions.values(),
      ];
      let state = beginGame({
        player1Name,
        player2Name,
        player1Cards: player1Deck.cards,
        player2Cards: player2Deck.cards,
        extraDefinitions,
        seed,
      });

      const humanPlayerId = vsAI ? PlayerId.P1 : null;

      if (vsAI) {
        // Auto-setup: both players place their active + bench automatically, then start Active phase.
        // Human sees their opening hand already placed.
        state = autoSetupEngineState(state, { placeBenchBasics: true });
        state.viewingPlayerId = PlayerId.P1;

        // If AI goes first, run AI's first turn immediately
        state = maybeRunAI(state, humanPlayerId);
      } else {
        state.viewingPlayerId = state.currentPlayerId;
      }

      saveGameState(state);
      set({ ...withActions(state), humanPlayerId, isAIThinking: false });
    },

    dispatch: (action) => {
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current) return;

      let next = gameReducer(current, action);

      if (humanPlayerId !== null) {
        // Keep viewingPlayerId fixed on the human player
        next.viewingPlayerId = humanPlayerId;

        // Run AI turn synchronously after human action
        const afterAI = maybeRunAI(next, humanPlayerId);
        afterAI.viewingPlayerId = humanPlayerId;
        saveGameState(afterAI);
        set({ ...withActions(afterAI), humanPlayerId, isAIThinking: false });
      } else {
        saveGameState(next);
        set({ ...withActions(next), humanPlayerId: null });
      }
    },

    startGame: () => {
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current) return;

      let next = startActiveGame(current);

      if (humanPlayerId !== null) {
        next.viewingPlayerId = humanPlayerId;
        next = maybeRunAI(next, humanPlayerId);
        next.viewingPlayerId = humanPlayerId;
      }

      saveGameState(next);
      set({ ...withActions(next), humanPlayerId });
    },

    loadSaved: () => {
      const saved = loadGameState<EngineState & { humanPlayerId?: PlayerId | null }>();
      if (!saved) return false;
      set({ ...withActions(saved), humanPlayerId: saved.humanPlayerId ?? null });
      return true;
    },

    clearSaved: () => {
      clearGameState();
      set({ engineState: null, legalActions: [], humanPlayerId: null });
    },
  };
});
