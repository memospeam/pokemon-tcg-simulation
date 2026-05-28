import type { BuiltDeck } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import {
  beginMatchFromBuiltDecks,
  autoSetupEngineState,
  drainAutoPending,
  isPlayStalled,
  pickAutoTrainerAction,
  pickAutoAbilityAction,
  pickAutoPlayBasicAction,
  pickAutoEvolveAction,
  pickBestAttack,
  pickBestEnergyForTarget,
  pickBestEnergyTarget,
  pickRetreatAction,
} from "./utrechtGameRunner";
import { buildStrategyContext, type StrategyContext } from "./deckStrategy";
import { gameReducer, getLegalActions } from "../engine/reducer";
import { getDefinition, getPlayer, type EngineState } from "../engine/types";
import { GamePhase, PlayerId } from "../models/enums";

export type ActionCategory =
  | "start"
  | "trainer"
  | "basic"
  | "evolve"
  | "energy"
  | "ability"
  | "retreat"
  | "attack"
  | "endturn"
  | "resolve";

export interface SimFrame {
  state: EngineState;
  label: string;
  /** Broad category of the action that produced this frame */
  category: ActionCategory;
  /** New log entries added by this action (empty for the first frame) */
  logDelta: string[];
}

function applyAction(
  state: EngineState,
  action: Parameters<typeof gameReducer>[1],
  frames: SimFrame[],
  fallback: string,
  category: ActionCategory,
): EngineState {
  const logBefore = state.log.length;
  const next = gameReducer(state, action);
  const logDelta = next.log.slice(logBefore);
  frames.push({ state: next, label: logDelta.at(-1) ?? fallback, category, logDelta });
  return next;
}

function drainAndCapture(
  state: EngineState,
  frames: SimFrame[],
  ctx?: StrategyContext,
): { state: EngineState; steps: number; stalled: boolean } {
  const logBefore = state.log.length;
  const drained = drainAutoPending(state, 12, ctx);
  if (drained.steps > 0) {
    const logDelta = drained.state.log.slice(logBefore);
    frames.push({ state: drained.state, label: logDelta.at(-1) ?? "Resolve", category: "resolve", logDelta });
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
  frames.push({ state, label: "Game start", category: "start", logDelta: [] });

  // Build strategy contexts once per player from their deck card names
  const strategyContexts: Partial<Record<PlayerId, StrategyContext>> = {};
  function getCtx(playerId: PlayerId): StrategyContext {
    if (!strategyContexts[playerId]) {
      const player = getPlayer(state, playerId);
      const names = [
        ...player.deck,
        ...player.hand,
        ...(player.active ? [player.active] : []),
        ...player.bench,
        ...player.discard,
      ].map((c) => getDefinition(state, c.definitionId)?.name ?? "");
      strategyContexts[playerId] = buildStrategyContext(names);
    }
    return strategyContexts[playerId]!;
  }

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
      const ctx = getCtx(state.pendingAction.playerId);
      const drained = drainAndCapture(state, frames, ctx);
      state = drained.state;
      actionCount += drained.steps;
      if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
      continue;
    }

    const playerId = state.currentPlayerId;
    const player = getPlayer(state, playerId);
    const ctx = getCtx(playerId);
    let attacked = false;

    // 1. Trainers (supporters first, then items) — strategy-aware
    if (!state.turnFlags.attacked && trainersThisTurn < MAX_TRAINERS_PER_TURN) {
      const trainerAction = pickAutoTrainerAction(state, ctx);
      if (trainerAction) {
        state = applyAction(state, trainerAction, frames, "Play trainer", "trainer");
        actionCount += 1;
        trainersThisTurn += 1;
        const drained = drainAndCapture(state, frames, ctx);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
        continue;
      }
    }

    // 2. Bench basics (archetype-aware priority)
    if (!state.turnFlags.attacked) {
      const basicAction = pickAutoPlayBasicAction(state, ctx);
      if (basicAction) {
        state = applyAction(state, basicAction, frames, "Place basic", "basic");
        actionCount += 1;
        continue;
      }
    }

    // 3. Evolve (archetype-aware priority)
    if (!state.turnFlags.attacked) {
      const evolveAction = pickAutoEvolveAction(state, ctx);
      if (evolveAction) {
        state = applyAction(state, evolveAction, frames, "Evolve", "evolve");
        actionCount += 1;
        continue;
      }
    }

    // 4. Attach energy to the best target (not always active)
    if (!state.turnFlags.energyAttached) {
      const energiesInHand = player.hand.filter(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      if (energiesInHand.length > 0) {
        const energyTarget = pickBestEnergyTarget(state, playerId, ctx);
        if (energyTarget) {
          // Find the target instance to inform energy-type selection.
          const targetMon = [...(player.active ? [player.active] : []), ...player.bench]
            .find((p) => p.instanceId === energyTarget);
          const energy = targetMon
            ? (pickBestEnergyForTarget(state, energiesInHand, targetMon) ?? energiesInHand[0]!)
            : energiesInHand[0]!;
          state = applyAction(
            state,
            { type: "ATTACH_ENERGY", playerId, energyId: energy.instanceId, targetId: energyTarget },
            frames,
            "Attach energy",
            "energy",
          );
          actionCount += 1;
        }
      }
    }

    // 4.5 Use activatable abilities (Recon Directive, Adrena-Brain, Trade,
    // Teal Dance, Cursed Blast, etc.). Sits between energy attach and retreat
    // so we draw / search / set up damage BEFORE deciding whether to retreat
    // or attack. Loops back to top so multiple abilities can fire in one turn
    // (e.g. two Drakloak's Recon Directives stacked).
    if (!state.pendingAction && !state.turnFlags.attacked) {
      const abilityAction = pickAutoAbilityAction(state, ctx);
      if (abilityAction) {
        state = applyAction(state, abilityAction, frames, "Use ability", "ability");
        actionCount += 1;
        const drained = drainAndCapture(state, frames, ctx);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
        continue;
      }
    }

    // 5. Retreat to a better attacker (e.g. Lopunny loop)
    if (!state.turnFlags.retreated && !state.turnFlags.attacked) {
      const retreatAction = pickRetreatAction(state, playerId, ctx);
      if (retreatAction) {
        state = applyAction(state, retreatAction, frames, "Retreat", "retreat");
        actionCount += 1;
        continue;
      }
    }

    // 6. Attack — strategy-aware, gated on legality to prevent turn-1 infinite loops
    const canAttackThisTurn =
      player.active &&
      !state.turnFlags.attacked &&
      getLegalActions(state).some((a) => a.type === "ATTACK");
    if (canAttackThisTurn) {
      const bestAttack = pickBestAttack(state, playerId, ctx);
      if (bestAttack) {
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = applyAction(
          state,
          { type: "ATTACK", playerId, attackName: bestAttack },
          frames,
          `Attack: ${bestAttack}`,
          "attack",
        );
        actionCount += 1;
        attacked = true;
        const drained = drainAndCapture(state, frames, ctx);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break outer;
        if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) turnCount += 1;
      }
    }

    if (!attacked) {
      const beforeTurn = state.turnNumber;
      state = applyAction(state, { type: "END_TURN" }, frames, "End turn", "endturn");
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
