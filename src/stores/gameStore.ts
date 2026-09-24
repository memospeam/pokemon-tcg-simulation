import { create } from "zustand";
import type { BuiltDeck } from "@/lib/deck/builder";
import { clearGameState, loadGameState, saveGameState } from "@/lib/deck/storage";
import { beginGame, gameReducer, getLegalActions, startActiveGame, type EngineState, type GameAction } from "@/lib/engine";
import { GamePhase, PlayerId } from "@/lib/models/enums";
import { runAIOneStep, setupAiBoard, mulliganAi } from "@/lib/deck/metaGameRunner";
import { flipCoin, logMessage } from "@/lib/engine/helpers";
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
  /** "call" = heads/tails, "choose" = winner picks who goes first. */
  openingCoin: "call" | "choose" | null;
  callOpeningCoin: (calledHeads: boolean) => void;
  chooseOpeningSeat: (goFirst: boolean) => void;
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
let aiStepTimer: ReturnType<typeof setTimeout> | null = null;
const AI_STEP_MS = 800;

function cancelAiSteps(): void {
  if (aiStepTimer != null) {
    clearTimeout(aiStepTimer);
    aiStepTimer = null;
  }
}

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

  function persist(state: EngineState): void {
    saveGameState({ ...state, humanPlayerId: get().humanPlayerId });
  }

  /** Heuristic AI plays one action, then waits so the board can show it. */
  function queueAiSteps(humanPlayerId: PlayerId): void {
    cancelAiSteps();
    const state = get().engineState;
    if (!state || !aiShouldStep(state, humanPlayerId)) return;
    const tick = () => {
      const state = get().engineState;
      if (!state || get().humanPlayerId !== humanPlayerId || get().aiKind !== "heuristic") return;
      const aiId = humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
      const aiPending = state.pendingAction?.playerId === aiId;
      const aiTurn = !state.pendingAction && state.currentPlayerId === aiId;
      if (state.winnerId || (!aiPending && !aiTurn)) {
        set({ isAIThinking: false });
        return;
      }
      const { state: next, done } = runAIOneStep(state, buildAIContext(state), aiId);
      next.viewingPlayerId = humanPlayerId;
      persist(next);
      set({ ...withActions(next), humanPlayerId, isAIThinking: !done });
      if (!done && !next.winnerId) aiStepTimer = setTimeout(tick, AI_STEP_MS);
    };
    set({ isAIThinking: true });
    aiStepTimer = setTimeout(tick, AI_STEP_MS);
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
      persist(after);
      set({ ...withActions(after), humanPlayerId: human, isAIThinking: false });
    } catch {
      // Should not happen — LlmPolicy already falls back internally — but never
      // leave the UI stuck "thinking".
      set({ isAIThinking: false });
    }
  }

  function aiShouldStep(state: EngineState, humanPlayerId: PlayerId): boolean {
    if (state.winnerId || state.phase !== "active") return false;
    const aiId = humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
    if (state.pendingAction) return state.pendingAction.playerId === aiId;
    return state.currentPlayerId === aiId;
  }

  /** Hand control to the opponent after a human action / game start. */
  function advanceAfterHuman(next: EngineState, humanPlayerId: PlayerId | null): void {
    if (humanPlayerId === null) {
      persist(next);
      set({ ...withActions(next), humanPlayerId: null });
      return;
    }
    next.viewingPlayerId = humanPlayerId;
    if (next.phase === GamePhase.Mulligan) {
      next = mulliganAi(next, humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1);
    }
    persist(next);
    set({ ...withActions(next), humanPlayerId, isAIThinking: false });

    if (get().aiKind === "llm" && isAiToMove(next, humanPlayerId)) {
      set({ isAIThinking: true });
      void runLlmAiTurn();
      return;
    }

    queueAiSteps(humanPlayerId);
  }

  return {
    engineState: null,
    legalActions: [],
    humanPlayerId: null,
    isAIThinking: false,
    aiKind: "heuristic",
    openingCoin: null,

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
      cancelAiSteps();
      clearGameState();
      state.viewingPlayerId = PlayerId.P1;
      set({
        ...withActions(state),
        humanPlayerId,
        isAIThinking: false,
        aiKind: kind,
        openingCoin: "call",
      });
    },

    callOpeningCoin: (calledHeads) => {
      const current = get().engineState;
      const human = get().humanPlayerId;
      if (!current || get().openingCoin !== "call") return;
      const next = structuredClone(current);
      const heads = flipCoin(next);
      const caller = human ?? PlayerId.P1;
      const other = caller === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
      const callerWins = heads === calledHeads;
      const call = calledHeads ? "heads" : "tails";
      const callerName = getPlayer(next, caller).name;
      const otherName = getPlayer(next, other).name;
      if (callerWins) {
        logMessage(next, `${callerName} called ${call} and wins the flip.`);
        next.viewingPlayerId = caller;
        set({ ...withActions(next), openingCoin: "choose", isAIThinking: false });
        return;
      }
      if (human) {
        next.firstPlayerId = caller;
        next.currentPlayerId = caller;
        logMessage(next, `${callerName} called ${call}. ${otherName} wins the flip and chooses to go second.`);
      } else {
        logMessage(next, `${callerName} called ${call}. ${otherName} wins the flip.`);
        next.viewingPlayerId = other;
        set({ ...withActions(next), openingCoin: "choose", isAIThinking: false });
        return;
      }
      const prepared = mulliganAi(next, other);
      prepared.viewingPlayerId = caller;
      persist(prepared);
      set({ ...withActions(prepared), openingCoin: null, isAIThinking: false });
    },

    chooseOpeningSeat: (goFirst) => {
      const current = get().engineState;
      const human = get().humanPlayerId;
      if (!current || get().openingCoin !== "choose") return;
      const next = structuredClone(current);
      const caller = human ?? next.viewingPlayerId ?? PlayerId.P1;
      const other = caller === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1;
      const first = goFirst ? caller : other;
      next.firstPlayerId = first;
      next.currentPlayerId = first;
      logMessage(next, `${getPlayer(next, caller).name} chooses to go ${goFirst ? "first" : "second"}.`);
      const prepared = human ? mulliganAi(next, other) : next;
      prepared.viewingPlayerId = caller;
      persist(prepared);
      set({ ...withActions(prepared), openingCoin: null, isAIThinking: false });
    },

    dispatch: (action) => {
      if (get().isAIThinking) return;
      if (get().openingCoin && action.type !== "MULLIGAN") return;
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current) return;
      const next = gameReducer(current, action);
      advanceAfterHuman(next, humanPlayerId);
    },

    startGame: () => {
      const current = get().engineState;
      const { humanPlayerId } = get();
      if (!current || get().openingCoin) return;
      let next = current;
      if (humanPlayerId) {
        next = setupAiBoard(next, humanPlayerId === PlayerId.P1 ? PlayerId.P2 : PlayerId.P1);
      }
      next = startActiveGame(next);
      advanceAfterHuman(next, humanPlayerId);
    },

    loadSaved: () => {
      const saved = loadGameState<EngineState & { humanPlayerId?: PlayerId | null }>();
      if (!saved) return false;
      // A reloaded LLM match can't restore the policy instance; fall back to
      // heuristic so the game remains playable.
      llmPolicy = null;
      set({ ...withActions(saved), humanPlayerId: saved.humanPlayerId ?? null, aiKind: "heuristic", openingCoin: null });
      return true;
    },

    clearSaved: () => {
      cancelAiSteps();
      clearGameState();
      llmPolicy = null;
      set({ engineState: null, legalActions: [], humanPlayerId: null, aiKind: "heuristic", openingCoin: null });
    },
  };
});
