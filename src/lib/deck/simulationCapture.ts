import type { BuiltDeck } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import {
  beginMatchFromBuiltDecks,
  autoSetupEngineState,
  drainAutoPending,
  isPlayStalled,
  pickAutoTrainerAction,
  pickAutoToolAction,
  pickAutoAbilityAction,
  pickAutoPlayBasicAction,
  pickAutoEvolveAction,
  pickBestAttack,
  pickBestEnergyForTarget,
  pickBestEnergyTarget,
  pickRetreatAction,
  type DecisionCandidate,
} from "./metaGameRunner";
import { buildStrategyContext, type StrategyContext } from "./deckStrategy";
import { gameReducer, getLegalActions } from "../engine/reducer";
import { getDefinition, getPlayer, type EngineState, type GameAction } from "../engine/types";
import { GamePhase, PlayerId } from "../models/enums";
import type { TurnPolicy } from "./policy";

/** Per-frame callback used for live streaming of a policy-driven match. */
export type OnFrame = (frame: SimFrame, all: SimFrame[]) => void;

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
  /** Heuristic candidates weighed for this decision, best-first (when traced). */
  decision?: DecisionCandidate[];
}

function applyAction(
  state: EngineState,
  action: Parameters<typeof gameReducer>[1],
  frames: SimFrame[],
  fallback: string,
  category: ActionCategory,
  onFrame?: OnFrame,
  decision?: DecisionCandidate[],
): EngineState {
  const logBefore = state.log.length;
  const next = gameReducer(state, action);
  const logDelta = next.log.slice(logBefore);
  const frame: SimFrame = {
    state: next,
    label: logDelta.at(-1) ?? fallback,
    category,
    logDelta,
    ...(decision && decision.length > 0 ? { decision } : {}),
  };
  frames.push(frame);
  onFrame?.(frame, frames);
  return next;
}

function drainAndCapture(
  state: EngineState,
  frames: SimFrame[],
  ctx?: StrategyContext,
  onFrame?: OnFrame,
): { state: EngineState; steps: number; stalled: boolean } {
  const logBefore = state.log.length;
  const drained = drainAutoPending(state, 12, ctx);
  if (drained.steps > 0) {
    const logDelta = drained.state.log.slice(logBefore);
    const frame: SimFrame = { state: drained.state, label: logDelta.at(-1) ?? "Resolve", category: "resolve", logDelta };
    frames.push(frame);
    onFrame?.(frame, frames);
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
      const trainerTrace: DecisionCandidate[] = [];
      const trainerAction = pickAutoTrainerAction(state, ctx, trainerTrace);
      if (trainerAction) {
        state = applyAction(state, trainerAction, frames, "Play trainer", "trainer", undefined, trainerTrace);
        actionCount += 1;
        trainersThisTurn += 1;
        const drained = drainAndCapture(state, frames, ctx);
        state = drained.state;
        actionCount += drained.steps;
        if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
        continue;
      }
    }

    // 1b. Attach a Pokémon Tool (e.g. Air Balloon → Mega Lopunny ex)
    if (!state.turnFlags.attacked) {
      const toolAction = pickAutoToolAction(state, ctx);
      if (toolAction) {
        state = applyAction(state, toolAction, frames, "Attach tool", "trainer");
        actionCount += 1;
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
      const abilityTrace: DecisionCandidate[] = [];
      const abilityAction = pickAutoAbilityAction(state, ctx, abilityTrace);
      if (abilityAction) {
        state = applyAction(state, abilityAction, frames, "Use ability", "ability", undefined, abilityTrace);
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
      const attackTrace: DecisionCandidate[] = [];
      const bestAttack = pickBestAttack(state, playerId, ctx, attackTrace);
      if (bestAttack) {
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = applyAction(
          state,
          { type: "ATTACK", playerId, attackName: bestAttack },
          frames,
          `Attack: ${bestAttack}`,
          "attack",
          undefined,
          attackTrace,
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

// ─── Policy-driven (async) capture — supports LLM agents ────────────────────

/** Map a chosen action to the broad category used for frame styling. */
function categoryOf(action: GameAction): ActionCategory {
  switch (action.type) {
    case "ATTACK": return "attack";
    case "ATTACH_ENERGY": return "energy";
    case "PLAY_TRAINER": return "trainer";
    case "EVOLVE": return "evolve";
    case "PLAY_BASIC_TO_BENCH": return "basic";
    case "USE_ABILITY": return "ability";
    case "RETREAT": return "retreat";
    case "END_TURN": return "endturn";
    default: return "resolve";
  }
}

function labelOf(action: GameAction): string {
  switch (action.type) {
    case "ATTACK": return `Attack: ${action.attackName}`;
    case "ATTACH_ENERGY": return "Attach energy";
    case "PLAY_TRAINER": return "Play trainer";
    case "EVOLVE": return "Evolve";
    case "PLAY_BASIC_TO_BENCH": return "Place basic";
    case "USE_ABILITY": return "Use ability";
    case "RETREAT": return "Retreat";
    case "END_TURN": return "End turn";
    default: return action.type;
  }
}

/** Yield to the event loop so the UI can paint each streamed frame. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Async AI-vs-AI capture where each player's main-phase decisions come from a
 * TurnPolicy (heuristic OR LLM agent). Mirrors runPolicyMatch's loop but emits
 * a SimFrame after every applied action (via `onFrame`) so the UI can play the
 * match back in real time as the agents think. Pending sub-choices resolve via
 * the heuristic drainAutoPending, exactly like the synchronous capture.
 */
export async function capturePolicyFrames(
  initialState: EngineState,
  p1Policy: TurnPolicy,
  p2Policy: TurnPolicy,
  options: {
    maxTurns?: number;
    maxActions?: number;
    maxDecisions?: number;
    onFrame?: OnFrame;
    /** Return true to abort the in-flight capture (e.g. user re-ran). */
    cancel?: () => boolean;
  } = {},
): Promise<SimFrame[]> {
  const frames: SimFrame[] = [];
  const maxTurns = options.maxTurns ?? 30;
  const maxActions = options.maxActions ?? 240;
  const maxDecisions = options.maxDecisions ?? Number.POSITIVE_INFINITY;
  const onFrame = options.onFrame;

  let state = initialState;
  const startFrame: SimFrame = { state, label: "Game start", category: "start", logDelta: [] };
  frames.push(startFrame);
  onFrame?.(startFrame, frames);

  const ctxCache: Partial<Record<PlayerId, StrategyContext>> = {};
  function ctxFor(playerId: PlayerId): StrategyContext {
    if (!ctxCache[playerId]) {
      const p = getPlayer(state, playerId);
      const names = [...p.deck, ...p.hand, ...(p.active ? [p.active] : []), ...p.bench, ...p.discard]
        .map((c) => getDefinition(state, c.definitionId)?.name ?? "");
      ctxCache[playerId] = buildStrategyContext(names);
    }
    return ctxCache[playerId]!;
  }
  const policyFor = (playerId: PlayerId): TurnPolicy =>
    playerId === PlayerId.P1 ? p1Policy : p2Policy;

  let turnCount = 0;
  let actionCount = 0;
  let decisions = 0;

  while (
    actionCount < maxActions &&
    turnCount < maxTurns &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  ) {
    if (options.cancel?.()) break;

    if (state.pendingAction) {
      const ctx = ctxFor(state.pendingAction.playerId);
      const drained = drainAndCapture(state, frames, ctx, onFrame);
      state = drained.state;
      actionCount += drained.steps;
      if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
      continue;
    }

    const playerId = state.currentPlayerId;
    const ctx = ctxFor(playerId);

    let action: GameAction | null = null;
    if (decisions < maxDecisions) {
      action = await policyFor(playerId).decide(state, playerId, ctx);
      decisions += 1;
    }

    if (!action) {
      const beforeTurn = state.turnNumber;
      state = applyAction(state, { type: "END_TURN" }, frames, "End turn", "endturn", onFrame);
      actionCount += 1;
      if (state.turnNumber > beforeTurn) turnCount += 1;
      await yieldToUi();
      continue;
    }

    const beforeTurn = state.turnNumber;
    const beforePlayer = state.currentPlayerId;
    const beforeRetreated = state.turnFlags.retreated;

    state = applyAction(state, action, frames, labelOf(action), categoryOf(action), onFrame);
    actionCount += 1;
    await yieldToUi();

    // No-op retreat guard (mirrors runPolicyMatch).
    if (action.type === "RETREAT" && state.turnFlags.retreated === beforeRetreated) {
      const beforeT = state.turnNumber;
      state = applyAction(state, { type: "END_TURN" }, frames, "End turn", "endturn", onFrame);
      actionCount += 1;
      if (state.turnNumber > beforeT) turnCount += 1;
      continue;
    }

    if (state.pendingAction) {
      const drained = drainAndCapture(state, frames, ctxFor(state.pendingAction.playerId), onFrame);
      state = drained.state;
      actionCount += drained.steps;
      if (drained.stalled || state.phase !== GamePhase.Active || state.winnerId) break;
    }
    if (state.phase !== GamePhase.Active || state.winnerId) break;
    if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) turnCount += 1;
  }

  return frames;
}

/**
 * Build decks from two presets, set up the game, then run an async policy-driven
 * match (used by the Simulate tab's "LLM agent" mode). The caller supplies the
 * two policies (e.g. browser LLM policies).
 */
export async function capturePresetPolicySimulation(
  p1Preset: TournamentDeckPreset,
  p2Preset: TournamentDeckPreset,
  p1Policy: TurnPolicy,
  p2Policy: TurnPolicy,
  options: {
    seed?: number;
    maxTurns?: number;
    maxActions?: number;
    onFrame?: OnFrame;
    cancel?: () => boolean;
  } = {},
): Promise<SimFrame[]> {
  const p1Deck = buildPlaytestDeckFromCorpusText(p1Preset.label, p1Preset.text);
  const p2Deck = buildPlaytestDeckFromCorpusText(p2Preset.label, p2Preset.text);
  let state = beginMatchFromBuiltDecks({
    player1Name: p1Preset.player,
    player2Name: p2Preset.player,
    player1Deck: p1Deck,
    player2Deck: p2Deck,
    seed: options.seed,
  });
  state = autoSetupEngineState(state, { placeBenchBasics: true, maxMulligans: 40 });
  return capturePolicyFrames(state, p1Policy, p2Policy, options);
}
