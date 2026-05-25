import type { BuiltDeck } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import {
  beginMatchFromBuiltDecks,
  autoSetupEngineState,
  drainAutoPending,
  isPlayStalled,
  pickAutoTrainerAction,
  pickAutoPlayBasicAction,
  pickAutoEvolveAction,
} from "./utrechtGameRunner";
import { gameReducer } from "../engine/reducer";
import { canAffordAttack } from "../engine/energy";
import { getDefinition, getPlayer, type EngineState } from "../engine/types";
import { GamePhase } from "../models/enums";

export interface SimFrame {
  state: EngineState;
  label: string;
}

function applyAction(
  state: EngineState,
  action: Parameters<typeof gameReducer>[1],
  frames: SimFrame[],
  fallback: string,
): EngineState {
  const logBefore = state.log.length;
  const next = gameReducer(state, action);
  const newEntries = next.log.slice(logBefore);
  frames.push({ state: next, label: newEntries.at(-1) ?? fallback });
  return next;
}

function drainAndCapture(
  state: EngineState,
  frames: SimFrame[],
): { state: EngineState; steps: number; stalled: boolean } {
  const logBefore = state.log.length;
  const drained = drainAutoPending(state);
  if (drained.steps > 0) {
    const newEntries = drained.state.log.slice(logBefore);
    frames.push({ state: drained.state, label: newEntries.at(-1) ?? "Resolve" });
  }
  return { ...drained, stalled: isPlayStalled(drained.state) };
}

export function captureSimulationFrames(
  input: {
    p1Name: string;
    p2Name: string;
    p1Deck: BuiltDeck;
    p2Deck: BuiltDeck;
    seed?: number;
  },
  options: { maxTurns?: number; maxActions?: number } = {},
): SimFrame[] {
  const frames: SimFrame[] = [];
  const maxTurns = options.maxTurns ?? 30;
  const maxActions = options.maxActions ?? 240;

  let state = beginMatchFromBuiltDecks({
    player1Name: input.p1Name,
    player2Name: input.p2Name,
    player1Deck: input.p1Deck,
    player2Deck: input.p2Deck,
    seed: input.seed,
  });
  state = autoSetupEngineState(state, { placeBenchBasics: true, maxMulligans: 40 });
  frames.push({ state, label: "Game start" });

  let turnCount = 0;
  let actionCount = 0;
  let prevTurnNumber = state.turnNumber;
  let trainersThisTurn = 0;
  const MAX_TRAINERS_PER_TURN = 40;

  outer: while (
    actionCount < maxActions &&
    turnCount < maxTurns &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  ) {
    if (state.turnNumber !== prevTurnNumber) {
      prevTurnNumber = state.turnNumber;
      trainersThisTurn = 0;
    }

    if (state.pendingAction) {
      const drained = drainAndCapture(state, frames);
      state = drained.state;
      actionCount += drained.steps;
      if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
      continue;
    }

    const playerId = state.currentPlayerId;
    const player = getPlayer(state, playerId);
    let attacked = false;

    if (!state.turnFlags.attacked && trainersThisTurn < MAX_TRAINERS_PER_TURN) {
      const trainerAction = pickAutoTrainerAction(state);
      if (trainerAction) {
        state = applyAction(state, trainerAction, frames, "Play trainer");
        actionCount += 1;
        trainersThisTurn += 1;
        const drained = drainAndCapture(state, frames);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
        continue;
      }
    }

    if (!state.turnFlags.attacked) {
      const basicAction = pickAutoPlayBasicAction(state);
      if (basicAction) {
        state = applyAction(state, basicAction, frames, "Place basic");
        actionCount += 1;
        continue;
      }
    }

    if (!state.turnFlags.attacked) {
      const evolveAction = pickAutoEvolveAction(state);
      if (evolveAction) {
        state = applyAction(state, evolveAction, frames, "Evolve");
        actionCount += 1;
        continue;
      }
    }

    if (!state.turnFlags.energyAttached && player.active) {
      const energy = player.hand.find(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      if (energy) {
        state = applyAction(
          state,
          { type: "ATTACH_ENERGY", playerId, energyId: energy.instanceId, targetId: player.active.instanceId },
          frames,
          "Attach energy",
        );
        actionCount += 1;
      }
    }

    if (player.active && !state.turnFlags.attacked) {
      const def = getDefinition(state, player.active.definitionId);
      for (const attack of def?.attacks ?? []) {
        if (!canAffordAttack(state, player.active, attack)) continue;
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = applyAction(
          state,
          { type: "ATTACK", playerId, attackName: attack.name },
          frames,
          `Attack: ${attack.name}`,
        );
        actionCount += 1;
        attacked = true;
        const drained = drainAndCapture(state, frames);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break outer;
        if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) turnCount += 1;
        break;
      }
    }

    if (!attacked) {
      const beforeTurn = state.turnNumber;
      state = applyAction(state, { type: "END_TURN" }, frames, "End turn");
      actionCount += 1;
      if (state.turnNumber > beforeTurn) turnCount += 1;
    }
  }

  return frames;
}

export function capturePresetSimulation(
  p1Preset: TournamentDeckPreset,
  p2Preset: TournamentDeckPreset,
  options: { seed?: number; maxTurns?: number; maxActions?: number } = {},
): SimFrame[] {
  const p1Deck = buildPlaytestDeckFromCorpusText(p1Preset.label, p1Preset.text);
  const p2Deck = buildPlaytestDeckFromCorpusText(p2Preset.label, p2Preset.text);
  return captureSimulationFrames(
    { p1Name: p1Preset.player, p2Name: p2Preset.player, p1Deck, p2Deck, seed: options.seed },
    options,
  );
}
