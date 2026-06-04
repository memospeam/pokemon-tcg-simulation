import { create } from "zustand";
import type { BuiltDeck } from "@/lib/deck/builder";
import { clearGameState, loadGameState, saveGameState } from "@/lib/deck/storage";
import { beginGame, gameReducer, getLegalActions, startActiveGame, type EngineState, type GameAction } from "@/lib/engine";
import { PlayerId } from "@/lib/models/enums";
import { autoSetupEngineState, drainAutoPending, runAISingleTurn } from "@/lib/deck/metaGameRunner";
import { buildStrategyContext, type StrategyContext } from "@/lib/deck/deckStrategy";
import { getDefinition, getPlayer } from "@/lib/engine";
import { runPolicyTurn } from "@/lib/deck/policyMatch";
import { createBrowserLlmPolicy } from "@/lib/deck/llm/browserPolicy";
import type { TurnPolicy } from "@/lib/deck/policy";

export type AiKind = "heuristic" | "llm";

interface GameStore {
  engineState: EngineState | null;
  legalActions: GameAction[];
  /** When non-null, P2 is AI and this is the human's player ID (always P1 for now). */
  humanPlayerId: PlayerId | null;
  isAIThinking: boolean;
  /** Which opponent the human is facing. */
  aiKind: AiKind;
  startMatch: (input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
    vsAI?: boolean;
    /** "heuristic" (default) or "llm" (in-app LLM opponent). */
    aiKind?: AiKind;
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

// LLM policy instance for the current match (module-level — not serializable,
// so it lives outside the zustand state). Rebuilt per match in startMatch.
let llmPolicy: TurnPolicy | null = null;

export const useGameStore = create<GameStore>((set, get) => {
  /** Is it the AI's move and the engine isn't waiting on the human? */
  function isAiToMove(state: EngineState, humanPlayerId: PlayerId | null): boolean {
    if (!humanPlayerId) return false;
    const aiId = humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
    if (state.winnerId) return false;
    if (state.currentPlayerId !== aiId) return false;
    if (state.pendingAction && state.pendingAction.playerId !== aiId) return false;
    return true;
  }

  /** Heuristic AI: run its turn synchronously (unchanged legacy behaviour). */
  function maybeRunHeuristicAI(state: EngineState, humanPlayerId: PlayerId | null): EngineState {
    if (!isAiToMove(state, humanPlayerId)) return state;
    return runAISingleTurn(state, buildAIContext(state));
  }

  /** LLM AI: run its turn asynchronously, showing the thinking state meanwhile. */
  async function runLlmAiTurn(): Promise<void> {
    const human = get().humanPlayerId;
    const state = get().engineState;
    if (!state || human === null || !llmPolicy) return;
    if (!isAiToMove(state, human)) return;

    set({ isAIThinking: true });
    try {
      const after = await runPolicyTurn(state, llmPolicy, buildAIContext(state));
      after.viewingPlayerId = human;
      saveGameState(after);
      set({ ...withActions(after), humanPlayerId: human, isAIThinking: false });
    } catch {
      // Should not happen — LlmPolicy already falls back internally — but never
      // leave the UI stuck "thinking".
      set({ isAIThinking: false });
    }
  }

  /**
   * Resolve any pending action that belongs to the AI opponent (e.g. the
   * opponent must PROMOTE a new Active after we KO'd theirs). Such a pending
   * can appear DURING the human's turn — getLegalActions would otherwise
   * surface the opponent's bench to the human to choose. The AI must resolve
   * its own pendings via the heuristic drainAutoPending.
   */
  function resolveAiPendings(state: EngineState, humanPlayerId: PlayerId): EngineState {
    const aiId = humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
    let cur = state;
    let guard = 0;
    while (
      guard++ < 20 &&
      cur.pendingAction != null &&
      cur.pendingAction.playerId === aiId &&
      !cur.winnerId
    ) {
      const { state: drained, steps } = drainAutoPending(cur, 12, buildAIContext(cur));
      if (steps === 0) break; // can't resolve → avoid infinite loop
      cur = drained;
    }
    return cur;
  }

  /** Hand control to the opponent after a human action / game start. */
  function advanceAfterHuman(next: EngineState, humanPlayerId: PlayerId | null): void {
    if (humanPlayerId === null) {
      saveGameState(next);
      set({ ...withActions(next), humanPlayerId: null });
      return;
    }
    // Auto-resolve opponent-owned pendings (e.g. their post-KO PROMOTE) so the
    // human is never asked to choose for the opponent.
    next = resolveAiPendings(next, humanPlayerId);
    next.viewingPlayerId = humanPlayerId;

    if (get().aiKind === "llm" && isAiToMove(next, humanPlayerId)) {
      // Show the human's move immediately, then run the LLM turn async.
      saveGameState(next);
      set({ ...withActions(next), humanPlayerId, isAIThinking: true });
      void runLlmAiTurn();
      return;
    }

    // Heuristic (or not the AI's turn): synchronous.
    const afterAI = maybeRunHeuristicAI(next, humanPlayerId);
    afterAI.viewingPlayerId = humanPlayerId;
    saveGameState(afterAI);
    set({ ...withActions(afterAI), humanPlayerId, isAIThinking: false });
  }

  return {
    engineState: null,
    legalActions: [],
    humanPlayerId: null,
    isAIThinking: false,
    aiKind: "heuristic",

    startMatch: ({ player1Name, player2Name, player1Deck, player2Deck, seed, vsAI, aiKind }) => {
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
      const kind: AiKind = aiKind ?? "heuristic";
      llmPolicy = vsAI && kind === "llm" ? createBrowserLlmPolicy() : null;
      set({ aiKind: kind });

      if (vsAI) {
        state = autoSetupEngineState(state, { placeBenchBasics: true });
        state.viewingPlayerId = PlayerId.P1;
        saveGameState(state);
        set({ ...withActions(state), humanPlayerId, isAIThinking: false });
        // If the AI goes first, run its opening turn (async for LLM).
        if (isAiToMove(state, humanPlayerId)) {
          if (kind === "llm") {
            void runLlmAiTurn();
          } else {
            const afterAI = maybeRunHeuristicAI(state, humanPlayerId);
            afterAI.viewingPlayerId = PlayerId.P1;
            saveGameState(afterAI);
            set({ ...withActions(afterAI), humanPlayerId, isAIThinking: false });
          }
        }
      } else {
        state.viewingPlayerId = state.currentPlayerId;
        saveGameState(state);
        set({ ...withActions(state), humanPlayerId, isAIThinking: false });
      }
    },

    dispatch: (action) => {
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current) return;
      const next = gameReducer(current, action);
      advanceAfterHuman(next, humanPlayerId);
    },

    startGame: () => {
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current) return;
      const next = startActiveGame(current);
      advanceAfterHuman(next, humanPlayerId);
    },

    loadSaved: () => {
      const saved = loadGameState<EngineState & { humanPlayerId?: PlayerId | null }>();
      if (!saved) return false;
      // A reloaded LLM match can't restore the policy instance; fall back to
      // heuristic so the game remains playable.
      llmPolicy = null;
      set({ ...withActions(saved), humanPlayerId: saved.humanPlayerId ?? null, aiKind: "heuristic" });
      return true;
    },

    clearSaved: () => {
      clearGameState();
      llmPolicy = null;
      set({ engineState: null, legalActions: [], humanPlayerId: null, aiKind: "heuristic" });
    },
  };
});
