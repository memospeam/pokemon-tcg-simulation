import type { BuiltDeck } from "./builder";
import { buildDeckFromText } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import {
  applyDeckOutAbilityPenalty,
  applyDeckOutTrainerPenalty,
  isDeckDrainingTrainerName,
} from "./deckOutAwareness";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { canAffordAttack, canAffordRetreat } from "../engine/energy";
import { applyWeaknessAndResistance, canRareCandyEvolveInto, checkMulliganNeeded, parseDamage } from "../engine/rules";
import { beginGame, gameReducer, getLegalActions, startActiveGame } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { getStadiumKind } from "../engine/effects/stadiumEffects";
import { isBasicEnergy, isBasicPokemon, isStage2, isSupporter } from "../models/definition";
import type { CardInstance } from "../models/instance";
import { GamePhase, PlayerId } from "../models/enums";
import { getDefinition, getOpponentId, getPlayer, remainingHp, type EngineState, type GameAction } from "../engine/types";
import {
  buildStrategyContext,
  getArchetypeBossPriority,
  getArchetypeEnergyPriority,
  getArchetypeSearchPriority,
  getArchetypeTrainerBonus,
  type StrategyContext,
} from "./deckStrategy";
import { getComboLines } from "./comboLines";

export interface GameRunResult {
  state: EngineState;
  turnCount: number;
  actionCount: number;
  stalled: boolean;
  winnerId: PlayerId | null;
}

export interface GameRunOptions {
  maxTurns?: number;
  maxActions?: number;
}

export interface MatchSetupOptions {
  seed?: number;
  maxMulligans?: number;
  placeBenchBasics?: boolean;
}

export interface TournamentMatchResult extends GameRunResult {
  setupComplete: boolean;
  resolveErrors: string[];
}

function findBasicInHand(state: EngineState, playerId: PlayerId) {
  return getPlayer(state, playerId).hand.find((card) => {
    const def = getDefinition(state, card.definitionId);
    return def && isBasicPokemon(def);
  });
}

export function beginMatchFromBuiltDecks(input: {
  player1Name: string;
  player2Name: string;
  player1Deck: BuiltDeck;
  player2Deck: BuiltDeck;
  seed?: number;
}): EngineState {
  const extraDefinitions = [
    ...input.player1Deck.definitions.values(),
    ...input.player2Deck.definitions.values(),
  ];
  return beginGame({
    player1Name: input.player1Name,
    player2Name: input.player2Name,
    player1Cards: input.player1Deck.cards,
    player2Cards: input.player2Deck.cards,
    extraDefinitions,
    seed: input.seed,
  });
}

export function autoSetupEngineState(
  state: EngineState,
  options: MatchSetupOptions = {},
): EngineState {
  const maxMulligans = options.maxMulligans ?? 30;
  let next = state;
  let mulligans = 0;

  while (next.phase === GamePhase.Mulligan && next.pendingMulliganPlayerId && mulligans < maxMulligans) {
    next = gameReducer(next, { type: "MULLIGAN", playerId: next.pendingMulliganPlayerId });
    mulligans += 1;
  }

  for (const playerId of [PlayerId.P1, PlayerId.P2]) {
    const player = getPlayer(next, playerId);
    if (player.active) continue;
    const basic = findBasicInHand(next, playerId);
    if (!basic) continue;
    next = gameReducer(next, {
      type: "PLACE_ACTIVE",
      playerId,
      instanceId: basic.instanceId,
    });
  }

  if (options.placeBenchBasics) {
    for (const playerId of [PlayerId.P1, PlayerId.P2]) {
      let safety = 0;
      while (next.phase === GamePhase.PlaceBench && safety < 10) {
        const player = getPlayer(next, playerId);
        if (player.bench.length >= 5) break;
        const basic = findBasicInHand(next, playerId);
        if (!basic) break;
        next = gameReducer(next, {
          type: "PLACE_BENCH",
          playerId,
          instanceId: basic.instanceId,
        });
        safety += 1;
      }
    }
  }

  return startActiveGame(next);
}

export function runMatchFromBuiltDecks(
  input: {
    player1Name: string;
    player2Name: string;
    player1Deck: BuiltDeck;
    player2Deck: BuiltDeck;
    seed?: number;
  },
  setupOptions: MatchSetupOptions = {},
  runOptions: GameRunOptions = {},
): TournamentMatchResult {
  const resolveErrors = [...input.player1Deck.resolveErrors, ...input.player2Deck.resolveErrors];
  let state = beginMatchFromBuiltDecks(input);
  state = autoSetupEngineState(state, setupOptions);
  const setupComplete =
    state.phase === GamePhase.Active &&
    !!getPlayer(state, PlayerId.P1).active &&
    !!getPlayer(state, PlayerId.P2).active;

  const run = runEngineAutoPlay(state, runOptions);
  return {
    ...run,
    setupComplete,
    resolveErrors,
  };
}

export function runTournamentPresetMatch(
  player1Preset: TournamentDeckPreset,
  player2Preset: TournamentDeckPreset,
  options: {
    seed?: number;
    setup?: MatchSetupOptions;
    run?: GameRunOptions;
    useApiResolver?: boolean;
  } = {},
): Promise<TournamentMatchResult> {
  const buildDeck = (label: string, text: string) =>
    options.useApiResolver
      ? buildDeckFromText(label, text)
      : Promise.resolve(buildPlaytestDeckFromCorpusText(label, text));

  return Promise.all([
    buildDeck(player1Preset.label, player1Preset.text),
    buildDeck(player2Preset.label, player2Preset.text),
  ]).then(([player1Deck, player2Deck]) =>
    runMatchFromBuiltDecks(
      {
        player1Name: player1Preset.player,
        player2Name: player2Preset.player,
        player1Deck,
        player2Deck,
        seed: options.seed,
      },
      options.setup,
      options.run,
    ),
  );
}

/**
 * Apply an action in the auto-play loop, drain any resulting pending, and
 * report the loop-control signal. Extracts the apply→drain→stall/winner→turn
 * bookkeeping that the combo / trainer / ability / attack steps all share.
 */
function applyAndDrain(
  state: EngineState,
  action: GameAction,
  ctx: StrategyContext | undefined,
): { state: EngineState; steps: number; terminal: "stall" | "end" | null; turnAdvanced: boolean } {
  const beforeTurn = state.turnNumber;
  const beforePlayer = state.currentPlayerId;
  const drained = drainAutoPending(gameReducer(state, action), 12, ctx);
  const next = drained.state;
  const terminal: "stall" | "end" | null = isPlayStalled(next)
    ? "stall"
    : next.phase !== GamePhase.Active || next.winnerId
      ? "end"
      : null;
  return {
    state: next,
    steps: 1 + drained.steps,
    terminal,
    turnAdvanced: next.currentPlayerId !== beforePlayer || next.turnNumber > beforeTurn,
  };
}

/**
 * Minimal auto-play loop: use the first affordable attack each turn, otherwise END_TURN.
 * Stops when the game finishes, hits limits, or needs player input (pendingAction).
 */
export function runEngineAutoPlay(
  initialState: EngineState,
  options: GameRunOptions = {},
): GameRunResult {
  const maxTurns = options.maxTurns ?? 40;
  const maxActions = options.maxActions ?? 400;
  let state = initialState;
  let turnCount = 0;
  let actionCount = 0;

  // Build strategy contexts once — identify each player's deck archetype from names in play.
  const strategyContexts: Partial<Record<PlayerId, StrategyContext>> = {};

  function getStrategyCtx(playerId: PlayerId): StrategyContext {
    if (!strategyContexts[playerId]) {
      const player = getPlayer(state, playerId);
      const allCards = [...player.deck, ...player.hand, ...(player.active ? [player.active] : []), ...player.bench, ...player.discard];
      const names = allCards.map((c) => getDefinition(state, c.definitionId)?.name ?? "");
      strategyContexts[playerId] = buildStrategyContext(names);
    }
    return strategyContexts[playerId]!;
  }

  while (
    actionCount < maxActions &&
    turnCount < maxTurns &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  ) {
    if (state.pendingAction) {
      const drained = drainAutoPending(state, 12, getStrategyCtx(state.pendingAction.playerId));
      state = drained.state;
      actionCount += drained.steps;
      if (isPlayStalled(state)) {
        return {
          state,
          turnCount,
          actionCount,
          stalled: true,
          winnerId: state.winnerId,
        };
      }
      if (state.phase !== GamePhase.Active || state.winnerId) {
        break;
      }
      continue;
    }

    const playerId = state.currentPlayerId;
    const player = getPlayer(state, playerId);
    const ctx = getStrategyCtx(playerId);
    let attacked = false;

    // 0. Deck-expert combo lines (may return an ATTACK → track turn transition).
    {
      const comboAction = pickComboAction(state, playerId, ctx);
      if (comboAction) {
        const r = applyAndDrain(state, comboAction, ctx);
        state = r.state;
        actionCount += r.steps;
        if (r.terminal === "stall") return { state, turnCount, actionCount, stalled: true, winnerId: state.winnerId };
        if (r.terminal === "end") break;
        if (r.turnAdvanced) turnCount += 1;
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const trainerAction = pickAutoTrainerAction(state, ctx);
      if (trainerAction) {
        const r = applyAndDrain(state, trainerAction, ctx);
        state = r.state;
        actionCount += r.steps;
        if (r.terminal === "stall") return { state, turnCount, actionCount, stalled: true, winnerId: state.winnerId };
        if (r.terminal === "end") break;
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const toolAction = pickAutoToolAction(state, ctx);
      if (toolAction) {
        state = gameReducer(state, toolAction);
        actionCount += 1;
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const basicAction = pickAutoPlayBasicAction(state, ctx);
      if (basicAction) {
        state = gameReducer(state, basicAction);
        actionCount += 1;
        continue;
      }
    }

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const evolveAction = pickAutoEvolveAction(state, ctx);
      if (evolveAction) {
        state = gameReducer(state, evolveAction);
        actionCount += 1;
        continue;
      }
    }

    if (
      !state.turnFlags.energyAttached &&
      player.hand.some((card) => getDefinition(state, card.definitionId)?.supertype === "Energy")
    ) {
      // Smart energy selection: use pickBestEnergyTarget for WHERE to attach,
      // then pick the BEST energy from hand for that target (prefer type-matching energy).
      // Avoids attaching Psychic energy to a Water-type Pokémon, etc.
      const primaryTarget = pickBestEnergyTarget(state, playerId, ctx);
      if (primaryTarget) {
        const targetMon = [...(player.active ? [player.active] : []), ...player.bench]
          .find((p) => p.instanceId === primaryTarget);
        const energiesInHand = player.hand.filter(
          (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
        );
        // Pick the energy that best fills this target's outstanding attack
        // cost (looks at what its attacks actually NEED, not just the
        // Pokémon's own type — see pickBestEnergyForTarget for why).
        const bestEnergyForTarget = targetMon
          ? pickBestEnergyForTarget(state, energiesInHand, targetMon)
          : energiesInHand[0];

        if (bestEnergyForTarget) {
          state = gameReducer(state, {
            type: "ATTACH_ENERGY",
            playerId,
            energyId: bestEnergyForTarget.instanceId,
            targetId: primaryTarget,
          });
          actionCount += 1;
        }
      }
    }

    // Use activatable abilities: Cursed Blast, Flip the Script, Adrena-Brain, Trade, Teal Dance, etc.
    if (!state.pendingAction) {
      const abilityAction = pickAutoAbilityAction(state, ctx);
      if (abilityAction) {
        const r = applyAndDrain(state, abilityAction, ctx);
        state = r.state;
        actionCount += r.steps;
        if (r.terminal === "stall") return { state, turnCount, actionCount, stalled: true, winnerId: state.winnerId };
        if (r.terminal === "end") break;
        continue;
      }
    }

    // Retreat to a better attacker (e.g. Lopunny loop) before attacking
    if (!state.pendingAction && !state.turnFlags.retreated && !state.turnFlags.attacked) {
      const retreatAction = pickRetreatAction(state, playerId, ctx);
      if (retreatAction) {
        state = gameReducer(state, retreatAction);
        actionCount += 1;
        // Robustness: if the retreat did NOT actually take (e.g. an
        // affordability/payment mismatch leaves turnFlags.retreated false),
        // do NOT `continue` — retrying the identical retreat would loop until
        // maxActions and draw the game. Fall through to attack / END_TURN.
        if (state.turnFlags.retreated) {
          continue;
        }
      }
    }

    // Only attack if ATTACK is actually a legal action — prevents infinite loops when
    // the engine blocks attacking (e.g. the first player's turn 1, or post-pendingAction states).
    const canAttackThisTurn =
      player.active &&
      !state.turnFlags.attacked &&
      getLegalActions(state).some((a) => a.type === "ATTACK");
    if (canAttackThisTurn) {
      const bestAttack = pickBestAttack(state, playerId, ctx);
      if (bestAttack) {
        const r = applyAndDrain(state, { type: "ATTACK", playerId, attackName: bestAttack }, ctx);
        state = r.state;
        actionCount += r.steps;
        attacked = true;
        if (r.terminal === "stall") return { state, turnCount, actionCount, stalled: true, winnerId: state.winnerId };
        if (r.terminal === "end") break;
        if (r.turnAdvanced) turnCount += 1;
      }
    }

    if (!attacked) {
      const beforeTurn = state.turnNumber;
      state = gameReducer(state, { type: "END_TURN" });
      actionCount += 1;
      if (state.turnNumber > beforeTurn) {
        turnCount += 1;
      }
    }
  }

  return {
    state,
    turnCount,
    actionCount,
    stalled: isPlayStalled(state),
    winnerId: state.winnerId,
  };
}

export { checkMulliganNeeded };

/**
 * Run exactly ONE AI player's turn (all actions until the turn ends or game is over).
 * Returns the new game state after the AI has finished its turn.
 *
 * Stops early if:
 * - A pending action requires the HUMAN player to resolve (e.g., PROMOTE after KO)
 * - The game ends (winner found)
 * - The turn number advances (turn ended via attack or END_TURN)
 */
export function runAISingleTurn(
  state: EngineState,
  ctx: StrategyContext,
): EngineState {
  const aiPlayerId = state.currentPlayerId;
  const startTurn = state.turnNumber;
  let current = state;
  let steps = 0;
  const maxSteps = 150;

  while (steps < maxSteps && current.phase === GamePhase.Active && !current.winnerId) {
    steps++;

    // Turn changed — AI is done (attacked, or END_TURN fired)
    if (current.turnNumber > startTurn) break;

    // Pending action: only auto-resolve if it's for the AI player.
    // If it's for the human (e.g., PROMOTE after KO), stop and let the UI handle it.
    if (current.pendingAction) {
      if (current.pendingAction.playerId !== aiPlayerId) break;
      const { state: drained, steps: n } = drainAutoPending(current, 12, ctx);
      if (n === 0) break; // Couldn't resolve — stop to avoid infinite loop
      current = drained;
      continue;
    }

    // Switched to opponent without a pending — shouldn't happen normally but guard
    if (current.currentPlayerId !== aiPlayerId) break;

    const player = getPlayer(current, aiPlayerId);

    // 1. Play trainers (highest priority)
    if (!current.turnFlags.attacked) {
      const trainerAction = pickAutoTrainerAction(current, ctx);
      if (trainerAction) {
        current = gameReducer(current, trainerAction);
        const { state: drained } = drainAutoPending(current, 12, ctx);
        current = drained;
        continue;
      }
    }

    // 1b. Attach a Pokémon Tool (e.g. Air Balloon → Mega Lopunny ex)
    if (!current.turnFlags.attacked) {
      const toolAction = pickAutoToolAction(current, ctx);
      if (toolAction) { current = gameReducer(current, toolAction); continue; }
    }

    // 2. Bench Basic Pokémon
    if (!current.turnFlags.attacked) {
      const basicAction = pickAutoPlayBasicAction(current, ctx);
      if (basicAction) { current = gameReducer(current, basicAction); continue; }
    }

    // 3. Evolve Pokémon
    if (!current.turnFlags.attacked) {
      const evolveAction = pickAutoEvolveAction(current, ctx);
      if (evolveAction) { current = gameReducer(current, evolveAction); continue; }
    }

    // 4. Attach energy (with type-matching)
    if (
      !current.turnFlags.energyAttached &&
      player.hand.some((card) => getDefinition(current, card.definitionId)?.supertype === "Energy")
    ) {
      const primaryTarget = pickBestEnergyTarget(current, aiPlayerId, ctx);
      if (primaryTarget) {
        const targetMon = [...(player.active ? [player.active] : []), ...player.bench]
          .find((p) => p.instanceId === primaryTarget);
        const energiesInHand = player.hand.filter(
          (card) => getDefinition(current, card.definitionId)?.supertype === "Energy",
        );
        // Pick the energy that fills the target's actual attack shortfall.
        const bestEnergy = targetMon
          ? pickBestEnergyForTarget(current, energiesInHand, targetMon)
          : energiesInHand[0];
        if (bestEnergy) {
          current = gameReducer(current, {
            type: "ATTACH_ENERGY",
            playerId: aiPlayerId,
            energyId: bestEnergy.instanceId,
            targetId: primaryTarget,
          });
          continue;
        }
      }
    }

    // 5. Use abilities
    if (!current.pendingAction) {
      const abilityAction = pickAutoAbilityAction(current, ctx);
      if (abilityAction) {
        current = gameReducer(current, abilityAction);
        const { state: drained } = drainAutoPending(current, 12, ctx);
        current = drained;
        continue;
      }
    }

    // 6. Retreat to better attacker
    if (!current.turnFlags.retreated && !current.turnFlags.attacked) {
      const retreatAction = pickRetreatAction(current, aiPlayerId, ctx);
      if (retreatAction) {
        current = gameReducer(current, retreatAction);
        // Only loop back if the retreat actually took; otherwise fall through
        // to avoid an infinite no-op retreat loop (see main loop comment).
        if (current.turnFlags.retreated) continue;
      }
    }

    // 7. Attack
    const canAttack =
      player.active &&
      !current.turnFlags.attacked &&
      getLegalActions(current).some((a) => a.type === "ATTACK");
    if (canAttack) {
      const bestAttack = pickBestAttack(current, aiPlayerId, ctx);
      if (bestAttack) {
        current = gameReducer(current, { type: "ATTACK", playerId: aiPlayerId, attackName: bestAttack });
        const { state: drained } = drainAutoPending(current, 12, ctx);
        current = drained;
        break; // Turn ends after attack
      }
    }

    // 8. End turn (no profitable actions left)
    current = gameReducer(current, { type: "END_TURN" });
    break;
  }

  return current;
}

/** Last-resort pending resolver when typed handlers return null. */
function emergencyResolvePending(state: EngineState): EngineState | null {
  const pending = state.pendingAction;
  if (!pending) return null;
  const playerId = pending.playerId;
  const legal = getLegalActions(state).filter(
    (action) => "playerId" in action && action.playerId === playerId,
  );
  const skip = legal.find((action) => action.type === "SKIP_OPTIONAL");
  if (skip) return gameReducer(state, skip);
  for (const action of legal) {
    const next = gameReducer(state, action);
    if (next === state) continue;
    if (!next.pendingAction || next.pendingAction.type !== pending.type) return next;
  }
  return null;
}

/** Resolve simple optional/target pending actions so corpus playtests can finish. */
export function drainAutoPending(state: EngineState, maxSteps = 24, ctx?: StrategyContext): { state: EngineState; steps: number } {
  let next = state;
  let steps = 0;
  while (
    steps < maxSteps &&
    next.pendingAction &&
    next.phase === GamePhase.Active &&
    !next.winnerId
  ) {
    const resolved = tryResolveAutoPending(next, ctx) ?? emergencyResolvePending(next);
    if (!resolved) break;
    next = resolved;
    steps += 1;
  }
  return { state: next, steps };
}

export function isPlayStalled(state: EngineState): boolean {
  return (
    state.pendingAction !== null &&
    state.phase === GamePhase.Active &&
    !state.winnerId
  );
}

export function pickAutoPlayBasicAction(
  state: EngineState,
  ctx?: StrategyContext,
): Extract<GameAction, { type: "PLAY_BASIC_TO_BENCH" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  if (player.bench.length >= 5) return null;

  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "PLAY_BASIC_TO_BENCH" }> =>
      action.type === "PLAY_BASIC_TO_BENCH",
  );
  if (legal.length === 0) return null;

  const scored = legal.map((action) => {
    const card = player.hand.find((c) => c.instanceId === action.instanceId);
    if (!card) return { action, score: 0 };
    const def = getDefinition(state, card.definitionId);
    if (!def) return { action, score: 0 };
    const name = def.name.toLowerCase();

    // Base: prefer Pokémon that have a higher evolution in hand/deck
    let score = 10;
    const allCards = [...player.deck, ...player.hand];
    const hasEvolution = allCards.some((c) => {
      const d = getDefinition(state, c.definitionId);
      return d?.evolvesFrom?.toLowerCase() === name;
    });
    if (hasEvolution) score += 20;

    // Archetype-aware bench priority
    if (ctx) {
      const archPriority = getArchetypeEnergyPriority(ctx.archetype, name);
      score += archPriority / 5;
      const benchPrio = ctx.profile.benchPriority.findIndex((s) => name.includes(s.toLowerCase()));
      if (benchPrio !== -1) score += (ctx.profile.benchPriority.length - benchPrio) * 5;
      // Zoroark: N's Zekrom MUST be on bench — Night Joker copies Rampaging Thunder (250 damage)
      if (ctx.archetype === "zoroark" && name.includes("n's zekrom")) score += 40;
      // Honchkrow: TR Murkrow and TR Porygon fill bench for Ariana draw (+2 per TR bench)
      if (ctx.archetype === "honchkrow" && name.includes("team rocket's murkrow")) score += 20;
      if (ctx.archetype === "honchkrow" && name.includes("team rocket's porygon")) score += 15;
      // Alakazam: Abra is the evolution seed — always bench it (evolves to Kadabra → Alakazam)
      if (ctx.archetype === "alakazam" && name.includes("abra")) score += 25;
    }

    // Risky Ruins penalty: when opponent has Risky Ruins in play, benching non-Darkness Pokémon
    // immediately deals 20 damage to it. This can be lethal for low-HP basics (Dreepy=70 HP).
    // Reduce eagerness to bench non-Darkness Pokémon; still do it if evolution is critical.
    if (getStadiumKind(state) === "risky_ruins") {
      const pokemonTypes = def.types ?? ["Colorless"];
      if (!pokemonTypes.includes("Darkness")) {
        score -= 20; // Take damage immediately — only bench if highly beneficial (score still positive)
      }
    }

    return { action, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.action ?? null;
}

export function pickAutoEvolveAction(state: EngineState, ctx?: StrategyContext): Extract<GameAction, { type: "EVOLVE" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "EVOLVE" }> => action.type === "EVOLVE",
  );
  if (legal.length === 0) return null;

  const scored = legal.map((action) => {
    const card = player.hand.find((entry) => entry.instanceId === action.evolutionId);
    const def = card ? getDefinition(state, card.definitionId) : undefined;
    if (!def) return { action, score: 0 };
    const name = def.name.toLowerCase();
    const stage = isStage2(def) ? 20 : 10;
    const isActive = player.active?.instanceId === action.targetId;
    let score = stage + (isActive ? 1 : 0);

    if (ctx) {
      // Dragapult: massively prefer evolving to Dragapult ex (Stage 2 via Rare Candy)
      if (ctx.archetype === "dragapult" && name.includes("dragapult ex")) score += 50;
      // Dragapult: keep 1+ Drakloak on bench for Recon Directive draw — but still evolve Dreepy → Drakloak
      if (ctx.archetype === "dragapult" && name.includes("drakloak")) score += 10;
      // Dragapult-Dusknoir: Dragapult ex is the primary attacker and must be set up first.
      // Dusknoir is secondary (1 copy only) — build it AFTER Dragapult ex is attacking.
      if (ctx.archetype === "dragapult-dusknoir" && name.includes("dragapult ex")) score += 50;
      if (ctx.archetype === "dragapult-dusknoir" && name.includes("drakloak")) score += 12;
      if (ctx.archetype === "dragapult-dusknoir" && name.includes("dusknoir")) score += 22; // lowered from 45
      if (ctx.archetype === "dragapult-dusknoir" && name.includes("dusclops")) score += 10; // lowered from 25
      // Lopunny: prioritize Mega Lopunny ex evolution
      if ((ctx.archetype === "lopunny") && name.includes("mega lopunny ex")) score += 50;
      // Lopunny: Dudunsparce must stay on bench — it uses Run Away Draw from bench position.
      // The engine does NOT create PROMOTE pending when the ACTIVE Pokémon voluntarily shuffles
      // back to deck (Run Away Draw from active spot). This would leave P1 with no active Pokémon
      // and no PROMOTE pending — a broken game state that results in a draw.
      // Fix: strongly prefer evolving bench Dunsparce → Dudunsparce over active Dunsparce.
      if (ctx.archetype === "lopunny" && name.includes("dudunsparce") && isActive) score -= 500;
      // Honchkrow: prioritize evolving Murkrow → Honchkrow to start attacking
      if (ctx.archetype === "honchkrow" && name.includes("honchkrow")) score += 40;
      // Ogerpon: keep Teal Mask in play for energy acceleration
      if (ctx.archetype === "ogerpon-box" && name.includes("teal mask")) score += 20;
      // Greninja: Froakie → Frogadier → Greninja ex is the primary attack chain; Dusknoir secondary;
      // Snorunt → Froslass → Mega Froslass ex is the burst finisher chain; Glalie is a tech attacker.
      if (ctx.archetype === "greninja" && name.includes("greninja ex")) score += 50;
      if (ctx.archetype === "greninja" && name.includes("frogadier")) score += 25;
      if (ctx.archetype === "greninja" && name.includes("dusknoir")) score += 40;
      if (ctx.archetype === "greninja" && name.includes("dusclops")) score += 20;
      if (ctx.archetype === "greninja" && name.includes("mega froslass ex")) score += 35;
      if (ctx.archetype === "greninja" && name.includes("froslass")) score += 18;
      if (ctx.archetype === "greninja" && name.includes("glalie")) score += 12;
      // Hydrapple: evolve Meganium ASAP (Wild Growth energy doubling); Hydrapple ex is primary attacker
      if (ctx.archetype === "hydrapple" && name.includes("hydrapple ex")) score += 50;
      if (ctx.archetype === "hydrapple" && name.includes("dipplin")) score += 25;
      if (ctx.archetype === "hydrapple" && name.includes("meganium")) score += 45;
      if (ctx.archetype === "hydrapple" && name.includes("bayleef")) score += 20;
      // Garchomp: Roserade supporter-lock is nearly as important as Garchomp ex attacking
      if (ctx.archetype === "garchomp" && name.includes("garchomp ex")) score += 50;
      if (ctx.archetype === "garchomp" && name.includes("gabite")) score += 30;
      if (ctx.archetype === "garchomp" && name.includes("roserade")) score += 35;
      if (ctx.archetype === "garchomp" && name.includes("roselia")) score += 15;
      // Alakazam: Alakazam is the primary attacker (Powerful Hand 20×hand); Kadabra is staging step.
      // NOTE: Do NOT evolve Abra→Kadabra when Abra is active — the engine may not create PROMOTE
      // when the active is evolved (same risk as Dudunsparce active evolve in Lopunny).
      // Instead, strongly prefer evolving BENCH Abra → Kadabra → Alakazam.
      if (ctx.archetype === "alakazam" && name.includes("alakazam")) score += 50;
      if (ctx.archetype === "alakazam" && name.includes("kadabra")) {
        if (isActive) score += 5; // Kadabra on active is acceptable staging
        else score += 25;         // Bench Kadabra — evolve to have attacker ready
      }
      // Archetype search priority bonus
      score += getArchetypeSearchPriority(ctx.archetype, name) / 5;
    }

    return { action, score };
  }).sort((a, b) => b.score - a.score);

  // Skip evolve if best candidate has a strongly negative score (e.g. Lopunny blocking
  // Dudunsparce-on-active evolution to prevent the Run Away Draw active-shuffle engine bug).
  if ((scored[0]?.score ?? 0) < 0) return null;

  return scored[0]?.action ?? null;
}

/**
 * One scored option the heuristic weighed for a decision. Exposed (via an
 * optional `trace` out-param on the rich pickers) so playback can show the
 * real numbers behind a move — "picked X (72) over Y (48)" — without changing
 * any decision logic.
 */
export interface DecisionCandidate {
  label: string;
  score: number;
}

function recordTrace(
  trace: DecisionCandidate[] | undefined,
  entries: DecisionCandidate[],
): void {
  if (!trace) return;
  for (const e of entries.filter((x) => x.score > 0).slice(0, 4)) trace.push(e);
}

/** Whether the Pokémon holds a Binding Mochi (+40 while Poisoned). */
function holdsBindingMochi(state: EngineState, mon: CardInstance): boolean {
  return (mon.attachedTools ?? []).some((tool) =>
    getDefinition(state, tool.definitionId)?.name?.toLowerCase().includes("binding mochi"),
  );
}

/**
 * How disruptive it is to discard a specific attached Energy from an opponent's
 * Pokémon (Crushing Hammer). Higher = hurts more. The dominant term is
 * "load-bearing": if the Pokémon is at or below its cheapest attack cost,
 * removing one Energy denies the attack outright.
 */
function crushingHammerTargetScore(
  state: EngineState,
  oppActiveId: string | undefined,
  mon: CardInstance,
  energy: CardInstance,
): number {
  const energyDef = getDefinition(state, energy.definitionId);
  const monDef = getDefinition(state, mon.definitionId);
  let score = 10;
  // Special Energy is harder to replace and often provides 2+ units / effects.
  if (energyDef && !isBasicEnergy(energyDef)) score += 25;
  // The active attacker threatens next turn — denying it matters most.
  if (mon.instanceId === oppActiveId) score += 22;
  const costs = (monDef?.attacks ?? [])
    .map((a) => a.convertedEnergyCost ?? a.cost?.length ?? 99)
    .filter((c) => c < 99);
  const minCost = costs.length ? Math.min(...costs) : 99;
  const count = mon.attachedEnergy.length;
  if (minCost < 99) {
    if (count <= minCost) score += 45;          // can't attack at all after this
    else if (count === minCost + 1) score += 18; // knocks the bigger attack offline
  }
  if ((monDef?.subtypes ?? []).includes("ex")) score += 8; // bias toward real threats
  return score;
}

/** The highest-impact Crushing Hammer target on the opponent's board, or null
 *  when the opponent has no attached Energy. */
function bestCrushingHammerTarget(
  state: EngineState,
  playerId: PlayerId,
): { pokemonId: string; energyId: string; score: number } | null {
  const opponent = getPlayer(state, getOpponentId(playerId));
  const oppActiveId = opponent.active?.instanceId;
  let best: { pokemonId: string; energyId: string; score: number } | null = null;
  for (const mon of [...(opponent.active ? [opponent.active] : []), ...opponent.bench]) {
    for (const energy of mon.attachedEnergy) {
      const s = crushingHammerTargetScore(state, oppActiveId, mon, energy);
      if (!best || s > best.score) {
        best = { pokemonId: mon.instanceId, energyId: energy.instanceId, score: s };
      }
    }
  }
  return best;
}

/**
 * Decide which Pokémon Tool to attach this turn (the ATTACH_TOOL action).
 *
 * Pokémon Tools are played via ATTACH_TOOL (tool + target), NOT PLAY_TRAINER,
 * so they need their own picker. The headline case is Air Balloon on Mega
 * Lopunny ex: it grants free retreat, powering the Gale Thrust bench↔active
 * loop (retreat Lopunny → pivot through Dudunsparce's Run Away Draw / Abra's
 * Teleporter → bring Lopunny back to Active for the +170 moved-from-bench bonus).
 */
export function pickAutoToolAction(
  state: EngineState,
  ctx?: StrategyContext,
): Extract<GameAction, { type: "ATTACH_TOOL" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const actions = getLegalActions(state).filter(
    (a): a is Extract<GameAction, { type: "ATTACH_TOOL" }> => a.type === "ATTACH_TOOL",
  );
  if (actions.length === 0) return null;

  const inPlay = [...(player.active ? [player.active] : []), ...player.bench];

  const scored = actions
    .map((action) => {
      const toolCard = player.hand.find((c) => c.instanceId === action.toolId);
      const toolName = toolCard
        ? getDefinition(state, toolCard.definitionId)?.name?.toLowerCase() ?? ""
        : "";
      const target = inPlay.find((p) => p.instanceId === action.targetId);
      const targetName = target
        ? getDefinition(state, target.definitionId)?.name?.toLowerCase() ?? ""
        : "";
      const isActive = player.active?.instanceId === action.targetId;
      const isLopunny = targetName.includes("mega lopunny ex");
      let score = 10;

      if (toolName.includes("air balloon")) {
        // Free retreat — best on Mega Lopunny ex to power the Gale Thrust loop;
        // prefer the ACTIVE Lopunny (it needs to retreat this/next turn).
        if (isLopunny) score = isActive ? 95 : 90;
        else if (isActive) score = 32;
        else score = 12;
      } else if (toolName.includes("rescue board")) {
        // −1 retreat: also helps the Lopunny loop / the active attacker.
        score = isLopunny ? 60 : isActive ? 26 : 10;
      } else if (toolName.includes("binding mochi")) {
        // +40 only while the holder is Poisoned. In the Zoroark deck the
        // holder poisons ITSELF by pivoting in via Pecharunt ex's Subjugating
        // Chains, so the prime target is a BENCHED N's Zoroark ex (the future
        // pivot target) — Night Joker 250 becomes 290 after the pivot.
        const poisoned = target?.statusConditions.includes("Poisoned") ?? false;
        if (ctx?.archetype === "zoroark" && targetName.includes("n's zoroark ex")) {
          score = isActive ? 60 : 93;
        } else if (poisoned) {
          score = 80;
        } else {
          score = 8;
        }
      } else {
        // Generic damage/HP tools (Defiance Band, Bravery Charm, Maximum Belt,
        // Hero's Cape, …) — put them on the current attacker.
        score = isActive ? 28 : 12;
      }
      return { action, score };
    })
    .sort((a, b) => b.score - a.score);

  if ((scored[0]?.score ?? 0) <= 0) return null;
  return scored[0]!.action;
}

/**
 * Decide whether to retreat and which bench Pokémon to promote.
 *
 * Key use-cases:
 *  • Lopunny loop — bench Mega Lopunny ex must become the active for Gale Thrust
 *    to receive the movedFromBench +170 bonus.
 *  • Survival retreats — when the active is critically low HP and a healthy
 *    attacker with energy sits on the bench.
 */
export function pickRetreatAction(
  state: EngineState,
  playerId: PlayerId,
  ctx?: StrategyContext,
): Extract<GameAction, { type: "RETREAT" }> | null {
  if (state.turnFlags.retreated) return null;  // Already retreated this turn
  if (state.turnFlags.attacked) return null;   // Too late to retreat after attacking
  const player = getPlayer(state, playerId);
  if (!player.active || player.bench.length === 0) return null;
  if (!canAffordRetreat(state, player.active)) return null;

  const activeDef = getDefinition(state, player.active.definitionId);
  const activeName = activeDef?.name?.toLowerCase() ?? "";
  const activeHp = remainingHp(state, player.active);
  const activeMaxHp = parseInt(activeDef?.hp ?? "100", 10) || 100;

  // Estimate if opponent can KO our active next turn
  const opponent = getPlayer(state, getOpponentId(playerId));
  const opponentActiveDef = opponent.active ? getDefinition(state, opponent.active.definitionId) : undefined;
  const opponentMaxDamage = (opponentActiveDef?.attacks ?? []).reduce((best, atk) => {
    const d = parseInt(atk.damage, 10) || 0;
    // Rough estimate for variable attacks: add extra for "+" attacks
    const estimate = atk.damage.includes("+") ? d + 60 : d;
    return Math.max(best, estimate);
  }, 0);
  const opponentCanKO = opponentMaxDamage > 0 && opponentMaxDamage >= activeHp;

  const candidates = player.bench
    .map((bench) => {
      const benchDef = getDefinition(state, bench.definitionId);
      const benchName = benchDef?.name?.toLowerCase() ?? "";
      let score = 0;

      // ── Lopunny: always want a bench Mega Lopunny ex active for Gale Thrust movedFromBench bonus ──
      // This covers both cases:
      //   (a) active is NOT Lopunny → bring Lopunny active
      //   (b) active IS Lopunny + bench also has Lopunny → rotate to fresh one (loop)
      if (benchName.includes("mega lopunny ex")) {
        if (!activeName.includes("mega lopunny ex")) {
          // Active is something else — Lopunny on bench is the main attacker
          score = bench.attachedEnergy.length > 0 ? 200 : 50;
        } else {
          // Active is also Lopunny. Rotate if bench Lopunny has energy (Gale Thrust loop)
          // Retreating sets movedFromBenchToActiveIds → enables +170 bonus each turn
          if (bench.attachedEnergy.length > 0) score = 150;
        }
      }

      // ── Threat-based survival: retreat before opponent can KO us ──
      // Saves the active Pokémon from being KO'd if a healthy bench attacker is ready
      if (opponentCanKO) {
        const benchHp = remainingHp(state, bench);
        const hasAttacks = (benchDef?.attacks?.length ?? 0) > 0;
        const hasEnergy = bench.attachedEnergy.length > 0;
        // Only retreat if the bench Pokémon is healthier and can attack
        if (benchHp > activeHp && hasAttacks && hasEnergy) {
          score = Math.max(score, 120); // High priority: save the active Pokémon!
        }
      }

      // ── Survival: active is critically low HP (< 25%), bench has healthy attacker ──
      if (activeHp < activeMaxHp * 0.25) {
        const benchHp = remainingHp(state, bench);
        if (benchHp > 100 && bench.attachedEnergy.length > 0 && (benchDef?.attacks?.length ?? 0) > 0) {
          score = Math.max(score, 80);
        }
      }

      // ── Archetype: promote a ready high-priority attacker ──
      const archPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, benchName) : 0;
      if (score === 0 && archPrio > 70 && bench.attachedEnergy.length > 0) {
        score = 40; // Promote a high-priority attacker that is ready
      }

      return { bench, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;
  return {
    type: "RETREAT",
    playerId,
    benchInstanceId: candidates[0]!.bench.instanceId,
  };
}

/**
 * Estimate the effective damage of a variable-damage attack given the current game state.
 * Handles "60×" (multiply) and "60+" (plus-bonus) formats.
 */
function estimateAttackDamage(
  state: EngineState,
  playerId: PlayerId,
  attackName: string,
  rawDamage: string,
): number {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  const base = parseInt(rawDamage, 10) || 0;
  const lower = attackName.toLowerCase();

  // "Rocket Feathers" — 60 × TR Supporters discarded from hand (ONLY for Rocket Feathers)
  if (lower.includes("rocket feathers")) {
    const trSupporterCount = player.hand.filter((card) => {
      const def = getDefinition(state, card.definitionId);
      return def && isSupporter(def) && def.name.toLowerCase().includes("team rocket's");
    }).length;
    return (base || 60) * trSupporterCount;
  }

  // "Resentful Refrain" (Mega Froslass ex) — 50 × opponent's hand size
  if (lower.includes("resentful refrain")) {
    return 50 * opponent.hand.length;
  }

  // "Damage Beat" (Glalie) — 20 × damage counters on opponent's active
  if (lower.includes("damage beat")) {
    return 20 * (opponent.active?.damageCounters ?? 0);
  }

  // "Mirage Barrage" (Greninja ex) — 120 damage to 2 of opponent's Pokémon (costs 2 energy)
  // Only worth using if Greninja ex has enough energy to spend; otherwise Shinobi Blade (170) is better.
  if (lower.includes("mirage barrage")) {
    const energyOnActive = player.active?.attachedEnergy.length ?? 0;
    if (energyOnActive >= 3) return 240; // 120×2 targets — double value vs Shinobi Blade (170)
    return 0; // Discards 2 energies with only 1 attached → not worth it (can't re-attack next turn)
  }

  // Other "×" attacks (R Command) — base × relevant count
  if (rawDamage.includes("×")) {
    // R Command (TR Porygon2): 20 × TR Supporters in discard
    if (lower.includes("r command")) {
      const trDiscardCount = player.discard.filter((card) => {
        const def = getDefinition(state, card.definitionId);
        return def && isSupporter(def) && def.name.toLowerCase().includes("team rocket's");
      }).length;
      return (base || 20) * trDiscardCount;
    }
    // Generic ×: fallback to 0 (unknown scaling)
    return 0;
  }

  // "Gale Thrust" — 60 + 170 bonus if Lopunny moved from bench this turn
  if (lower.includes("gale thrust") || (rawDamage.includes("+") && lower.includes("thrust"))) {
    const movedIds = state.turnFlags.movedFromBenchToActiveIds ?? [];
    const lopunnyMoved = player.active && movedIds.includes(player.active.instanceId);
    return base + (lopunnyMoved ? 170 : 0);
  }

  // "Night Joker" — copies the best attack from a benched N's Pokémon.
  // Estimate each possible copy's effective damage, accounting for:
  //   • Rampaging Thunder (250) debuff: "can't attack next turn" — penalise unless KO
  //   • Back Draft (30×): scales with energy in opponent discard
  //   • Powerful Rage (20×): scales with damage counters on N's Zoroark ex (the active attacker)
  //   • Triple Smash (120×): 3-coin flip → ~1.5 expected heads on average
  if (lower.includes("night joker")) {
    const opponentHpNJ = opponent.active ? remainingHp(state, opponent.active) : 9999;
    let bestScore = 0;
    for (const bench of player.bench) {
      const def = getDefinition(state, bench.definitionId);
      if (!def?.name?.toLowerCase().startsWith("n's")) continue;
      for (const atk of (def.attacks ?? [])) {
        const raw = parseInt(atk.damage, 10) || 0;
        const atkLower = atk.name.toLowerCase();
        let est = raw;
        if (atkLower.includes("rampaging thunder")) {
          // 250 damage but Zoroark can't attack the following turn.
          // Only full value if this KOs; otherwise apply a heavy multiplier penalty.
          est = raw >= opponentHpNJ ? raw : Math.round(raw * 0.55);
        } else if (atkLower.includes("back draft")) {
          const energyInOppDiscard = opponent.discard.filter(
            (c) => getDefinition(state, c.definitionId)?.supertype === "Energy",
          ).length;
          est = (raw || 30) * Math.max(1, energyInOppDiscard);
        } else if (atkLower.includes("powerful rage")) {
          // "this Pokémon" when copied via Night Joker = N's Zoroark ex (the active attacker)
          est = (raw || 20) * (player.active?.damageCounters ?? 0);
        } else if (atkLower.includes("triple smash")) {
          est = Math.round((raw || 120) * 1.5); // ~1.5 expected heads from 3 coins
        }
        if (est > bestScore) bestScore = est;
      }
    }
    return bestScore;
  }

  // "Powerful Hand" (Alakazam) — 2 damage counters per card in hand = 20 damage per card
  if (lower.includes("powerful hand")) {
    return player.hand.length * 20;
  }

  // Generic "X+" → assume full bonus is achievable (conservative estimate)
  if (rawDamage.includes("+") && base > 0) return base + 60;

  return base;
}

/**
 * Returns true if the archetype should skip attacking this turn to keep loading
 * resources (e.g. Honchkrow loading TR Supporters before firing Rocket Feathers).
 */
function shouldSkipAttack(state: EngineState, playerId: PlayerId, ctx: StrategyContext | undefined): boolean {
  if (!ctx) return false;
  const player = getPlayer(state, playerId);

  // Honchkrow: only attack with Rocket Feathers when enough TR Supporters are in hand
  if (ctx.archetype === "honchkrow") {
    const def = player.active ? getDefinitionSafe(state, player.active.definitionId) : null;
    const hasRocketFeathers = (def?.attacks ?? []).some(
      (a) => a.name.toLowerCase().includes("rocket feathers"),
    );
    if (hasRocketFeathers) {
      const trCount = player.hand.filter((card) => {
        const d = getDefinition(state, card.definitionId);
        return d && isSupporter(d) && d.name.toLowerCase().includes("team rocket's");
      }).length;
      const opponentActive = getPlayer(state, getOpponentId(playerId)).active;
      const opponentHp = opponentActive ? remainingHp(state, opponentActive) : 9999;
      const expectedDamage = trCount * 60;
      // Honchkrow is a one-shot KO deck — Rocket Feathers should fire ONLY when
      // it KOs the opponent's Active (each swing discards the loaded TR
      // Supporters, so a non-lethal attack throws the hand away for nothing).
      // Otherwise keep loading Supporters. A deck-out / very-late-game valve
      // prevents stalling into a draw.
      const canKO = expectedDamage >= opponentHp;
      // Never pass up a KO that costs nothing: another affordable attack
      // (e.g. Hammer In 100 into a 60-HP Duskull) that already KOs keeps the
      // loaded hand intact. Self-play showed Honchkrow ending turns into free
      // KOs while "loading" — 0% winrate, 5/6 stall draws.
      const freeKO =
        !!opponentActive &&
        getLegalActions(state).some((action) => {
          if (action.type !== "ATTACK") return false;
          const atk = (def?.attacks ?? []).find((entry) => entry.name === action.attackName);
          if (!atk || atk.name.toLowerCase().includes("rocket feathers")) return false;
          const oppDef = getDefinitionSafe(state, opponentActive.definitionId);
          return (
            applyWeaknessAndResistance(parseDamage(atk.damage), def?.types, oppDef) >= opponentHp
          );
        });
      const desperate = player.deck.length <= 6 || state.turnNumber >= 12;
      if (!canKO && !freeKO && !desperate) return true; // not lethal yet → keep loading hand
    }
  }

  // Lopunny: Gale Thrust only does +170 bonus when moved from bench.
  // Do NOT skip all attacks — use Spiky Hopper (160) when Lopunny is already active.
  // Attack selection is handled by pickBestAttack (Gale Thrust preferred when moved, else Spiky Hopper).

  return false;
}

/**
 * Pick the best activatable ability to use this turn.
 * Covers: Cursed Blast (Dusknoir), Flip the Script (Fezandipiti ex),
 * Adrena-Brain (Munkidori), Mortal Shuriken (Mega Greninja ex),
 * Trade (N's Zoroark ex), Teal Dance (Ogerpon ex), Fan Call (Fan Rotom),
 * Ripening Charge (Hydrapple ex), R Command (TR Porygon2).
 */
export function pickAutoAbilityAction(
  state: EngineState,
  ctx?: StrategyContext,
  trace?: DecisionCandidate[],
): Extract<GameAction, { type: "USE_ABILITY" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));

  const abilityActions = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "USE_ABILITY" }> => action.type === "USE_ABILITY",
  );
  if (abilityActions.length === 0) return null;

  const allOwn = [...(player.active ? [player.active] : []), ...player.bench];
  const allOpponent = [...(opponent.active ? [opponent.active] : []), ...opponent.bench];

  const scored = abilityActions.map((action) => {
    const pokemon = allOwn.find((p) => p.instanceId === action.pokemonId);
    const abilityLower = action.abilityName.toLowerCase();
    let score = 0;

    // === DRAW / SEARCH ABILITIES (almost always beneficial) ===

    if (abilityLower.includes("flip the script")) {
      // Draw 3 cards when your Pokémon was KO'd last turn (condition enforced by engine)
      score = 88;
    } else if (abilityLower.includes("fan call")) {
      // T1 search: find up to 3 Colorless Pokémon ≤100 HP from deck to hand
      score = player.bench.length < 3 ? 82 : 35;
    } else if (abilityLower.includes("teal dance")) {
      // Attach Basic Grass from hand to any Grass Pokémon + draw 1 card (engine: needs Grass in hand)
      score = 72;
    } else if (abilityLower.includes("ripening charge")) {
      // Attach Basic Grass from hand + heal 30 damage (engine: needs Grass in hand)
      const hasDamaged = allOwn.some((p) => p.damageCounters > 0);
      score = hasDamaged ? 72 : 60; // Extra value if healing is relevant
    } else if (abilityLower.includes("trade")) {
      // Discard 1 card from hand, draw 2 — net +1 card
      // Great when hand is large (more dead cards to discard); skip if hand is nearly empty
      if (player.hand.length >= 5) score = 70;       // Many cards → likely dead draws to discard
      else if (player.hand.length >= 3) score = 55;  // Moderate hand → probably still worth it
      else if (player.hand.length === 2) score = 30; // Risky: discarding one of only two cards
      // else score = 0: hand ≤ 1 — can't afford to discard
      // Zoroark: Trade is the primary draw/cycle engine — use it more
      // aggressively to find N's Zorua, N's Zekrom, and key trainers. BUT
      // drawing 2 every turn can deck us out (Zoroark games go long against
      // trade-heavy decks), so once the deck thins, only Trade when the hand is
      // genuinely short on cards — don't burn the deck for value.
      if (ctx?.archetype === "zoroark") {
        if (player.deck.length <= 14 && player.hand.length >= 4) {
          score = 0; // conserve the deck — hand is fine
        } else if (player.hand.length >= 2) {
          score = Math.max(score + 10, 45);
        }
      }
    }

    // === DAMAGE ABILITIES (value scales with KO potential) ===

    else if (abilityLower.includes("cursed blast")) {
      // Cursed Blast places damage counters on 1 opponent Pokémon, then KOs the
      // user ITSELF — so the opponent takes a prize. It is only worth firing
      // when it KOs an opponent Pokémon in return (taking a prize back); never
      // sacrifice it for chip damage. The counter count differs by Pokémon:
      //   Dusknoir = 13 counters (130 dmg),  Dusclops = 5 counters (50 dmg).
      const selfName = pokemon
        ? getDefinitionSafe(state, pokemon.definitionId).name.toLowerCase()
        : "";
      const blastDamage = selfName.includes("dusknoir") ? 130 : 50;

      // Which opponent Pokémon does the blast outright KO right now (active or
      // bench), using the damage already on them?
      const koTargets = allOpponent.filter((p) => remainingHp(state, p) <= blastDamage);
      const kosAnEx = koTargets.some((p) =>
        /\bex\b/.test(getDefinitionSafe(state, p.definitionId).name.toLowerCase()),
      );

      const selfHp = pokemon ? remainingHp(state, pokemon) : 9999;
      const selfDying = selfHp <= 70; // ≥80 damage taken — likely KO'd next turn anyway

      // PHANTOM DIVE COMBO: if Dragapult ex is Active and will attack this turn,
      // its Phantom Dive spreads 6 counters (60) onto a Benched Pokémon AFTER
      // this ability resolves (abilities fire before the attack). So Cursed
      // Blast can target a BENCH Pokémon that the COMBINED (blast + 60) finishes
      // — this is the whole point of the small Dusclops (50): 50 + 60 = 110.
      const canPhantomDiveThisTurn =
        !state.turnFlags.attacked &&
        getLegalActions(state).some(
          (a) => a.type === "ATTACK" && a.attackName?.toLowerCase().includes("phantom dive"),
        );
      const comboKoBench = canPhantomDiveThisTurn
        ? opponent.bench.filter((p) => remainingHp(state, p) <= blastDamage + 60)
        : [];
      const comboKosEx = comboKoBench.some((p) =>
        /\bex\b/.test(getDefinitionSafe(state, p.definitionId).name.toLowerCase()),
      );

      if (koTargets.length > 0) {
        // Direct KO — take a prize back for the self-KO. Prefer trading into a
        // 2-prize ex; even a single-prize KO is a fair trade.
        score = kosAnEx ? 95 : 80;
      } else if (comboKoBench.length > 0) {
        // Bench finisher: blast softens it now, Phantom Dive's spread KOs it
        // this same turn. Strongly prefer removing a 2-prize bench ex.
        score = comboKosEx ? 88 : 68;
      } else if (selfDying) {
        // It will be KO'd next turn regardless — only spend it if the counters
        // SET UP a KO that next turn's Phantom Dive can finish.
        const setsUpBenchKO = opponent.bench.some(
          (p) => remainingHp(state, p) <= blastDamage + 60,
        );
        score = setsUpBenchKO ? 60 : 0;
      }
      // else: healthy Dusknoir/Dusclops with no KO available → hold (score 0).
      // Don't give the opponent a free prize for chip damage.

    } else if (abilityLower.includes("mortal shuriken")) {
      // Discard Basic Water Energy, place 6 damage counters on any opponent Pokémon
      const canKOTarget = allOpponent.some((p) => remainingHp(state, p) <= 60);
      score = canKOTarget ? 90 : 50; // High if KO, medium for spread

    } else if (abilityLower.includes("adrena-brain")) {
      // Munkidori: move up to 3 damage counters from ONE opp Pokémon to ANOTHER opp Pokémon.
      // Use any time the opponent has at least one damaged Pokémon AND another Pokémon to
      // move counters to — there's almost always value in piling damage toward a KO.
      const opponentDamagedList = allOpponent.filter((p) => p.damageCounters >= 1);
      const canConsolidateKO = allOpponent.some((p) => {
        const hp = remainingHp(state, p);
        return hp <= 30 && opponentDamagedList.some((src) => src.instanceId !== p.instanceId);
      });
      const hasSpreadDamage = opponentDamagedList.length >= 2; // two damaged → consolidate
      const hasAnyDamage = opponentDamagedList.length >= 1 && allOpponent.length >= 2;
      if (canConsolidateKO) score = 88;       // Move ≥30 damage onto a near-dead Pokémon
      else if (hasSpreadDamage) score = 60;   // Redistribute for future KO
      else if (hasAnyDamage) score = 35;      // Any damage worth shifting toward the target
      // else score = 0 — opponent has zero damage; nothing to redistribute

    } else if (abilityLower.includes("run errand")) {
      // Mega Kangaskhan ex: active-only, draw 2 cards. It shuffles NOTHING back,
      // so firing it every turn mills the deck — generic-AI Crustle/Lillie's
      // self-decked-out around turn 27 with prizes still up. Draw only when the
      // hand is genuinely low, and stand down hard as the deck thins.
      const hand = player.hand.length;
      if (hand >= 7) score = 12;        // hand already full — drawing just mills
      else if (hand >= 5) score = 45;
      else score = 88;                  // genuinely need cards
      if (player.deck.length <= 12 && hand >= 4) score = Math.min(score, 8);

    } else if (abilityLower.includes("subjugating chains")) {
      // Pecharunt ex: swap a Benched Darkness Pokémon (NOT another Pecharunt ex)
      // with the Active; the new Active is Poisoned.
      //
      // Mirror the engine's filter exactly: only Darkness-typed bench Pokémon,
      // and Pecharunt ex itself is excluded (the card text says "except any
      // Pecharunt ex"). If no eligible target exists, the ability would just
      // burn the once-per-turn use, so we score it 0.
      const eligibleBenchDark = player.bench.filter((b) => {
        const bDef = getDefinition(state, b.definitionId);
        const bName = bDef?.name?.toLowerCase() ?? "";
        const isDark = (bDef?.types ?? []).includes("Darkness");
        const isPecharunt = bName.includes("pecharunt ex");
        const hasAttacks = (bDef?.attacks?.length ?? 0) > 0;
        return isDark && !isPecharunt && hasAttacks;
      });

      if (eligibleBenchDark.length > 0) {
        // The swap is only valuable when the bench candidate is a STRICTLY
        // BETTER attacker than what's already in the Active spot. The active
        // gets Poisoned on swap, so we don't want to throw away our primary
        // for an opportunistic move.
        const activeDef = player.active ? getDefinition(state, player.active.definitionId) : null;
        const activeName = activeDef?.name?.toLowerCase() ?? "";
        const activeArchPrio = ctx
          ? getArchetypeEnergyPriority(ctx.archetype, activeName)
          : 0;
        const bestBenchPrio = ctx
          ? Math.max(
              ...eligibleBenchDark.map((b) => {
                const bDef = getDefinition(state, b.definitionId);
                const bName = bDef?.name?.toLowerCase() ?? "";
                return getArchetypeEnergyPriority(ctx.archetype, bName);
              }),
            )
          : 0;
        const benchBetter = bestBenchPrio > activeArchPrio;

        const activeHp = player.active ? remainingHp(state, player.active) : 0;
        const activeMaxHp = parseInt(activeDef?.hp ?? "0", 10) || 100;
        const activeDying = activeMaxHp > 0 && activeHp / activeMaxHp < 0.4;
        // Active is the primary attacker (archPrio ≥ 85) and not dying:
        //   keep it there; swapping in is net-negative.
        // Active dying + bench strictly better: rescue.
        // Active not dying but bench strictly better: opportunistic upgrade.
        if (activeArchPrio >= 85 && !activeDying) score = 0;
        else if (activeDying && benchBetter) score = 75;
        else if (benchBetter) score = 45;
        // else score stays 0 — no point swapping to a worse attacker.

        // ── Zoroark loop ──
        // After Night Joker copies N's Zekrom's Rampaging Thunder (250), the
        // active Zoroark ex is locked out of attacking next turn. If it can't
        // attack this turn but a FRESH Benched N's Zoroark ex (with Energy) can,
        // pivot to it via Subjugating Chains so we keep swinging 250 every turn.
        // (Same archetype priority, so the generic "strictly better" rule above
        // never triggers this — it must be handled explicitly.)
        if (ctx?.archetype === "zoroark" && activeName.includes("n's zoroark ex")) {
          const activeCanAttack = getLegalActions(state).some((a) => a.type === "ATTACK");
          const freshBenchZoroark = eligibleBenchDark.some((b) => {
            const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
            return bName.includes("n's zoroark ex") && b.attachedEnergy.length > 0;
          });
          if (!activeCanAttack && freshBenchZoroark) score = Math.max(score, 85);

          // ── Mochi-pivot ──
          // Pivoting in a Benched N's Zoroark ex that HOLDS Binding Mochi
          // poisons it, switching on the +40 (Night Joker 250 → 290; +40 more
          // from Black Belt's Training vs an ex → 330). Worth the self-poison
          // exactly when those bonuses flip a KO the current active can't make.
          if (opponent.active) {
            const oppHp = remainingHp(state, opponent.active);
            const oppIsEx = (
              getDefinition(state, opponent.active.definitionId)?.subtypes ?? []
            ).includes("ex");
            // Best raw Night Joker template damage (unpenalised — we are
            // checking reach-with-bonuses, not expected value).
            const njRaw = player.bench.reduce((best, b) => {
              const bDef = getDefinition(state, b.definitionId);
              if (!bDef?.name?.toLowerCase().startsWith("n's")) return best;
              const raw = Math.max(0, ...(bDef.attacks ?? []).map((a) => parseInt(a.damage, 10) || 0));
              return Math.max(best, raw);
            }, 0);
            const blackBeltReady =
              oppIsEx &&
              !state.turnFlags.supporterPlayed &&
              player.hand.some((c) =>
                getDefinition(state, c.definitionId)?.name?.toLowerCase().includes("black belt's training"),
              );
            const bonus = 40 + (blackBeltReady ? 40 : 0);
            const mochiPivotReady = eligibleBenchDark.some((b) => {
              const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
              return (
                bName.includes("n's zoroark ex") &&
                b.attachedEnergy.length > 0 &&
                holdsBindingMochi(state, b)
              );
            });
            const activeAlreadyBoosted =
              !!player.active &&
              holdsBindingMochi(state, player.active) &&
              player.active.statusConditions.includes("Poisoned");
            if (
              mochiPivotReady &&
              !activeAlreadyBoosted &&
              njRaw > 0 &&
              njRaw < oppHp &&
              njRaw + bonus >= oppHp
            ) {
              score = Math.max(score, 90);
            }
          }
        }
      }

    } else if (abilityLower.includes("r command")) {
      // Deal 20 damage × TR Supporters in own discard pile
      const trDiscardCount = player.discard.filter((card) => {
        const d = getDefinition(state, card.definitionId);
        return d && isSupporter(d) && d.name.toLowerCase().includes("team rocket's");
      }).length;
      const damage = trDiscardCount * 20;
      const opponentHp = opponent.active ? remainingHp(state, opponent.active) : 9999;
      score = damage >= opponentHp ? 92 : damage >= 60 ? 60 : damage > 0 ? 40 : 0;

    } else if (abilityLower.includes("recon directive")) {
      // Drakloak's Recon Directive: peek top 2, draw 1, bottom-deck the other.
      // Free card-quality engine — should fire EVERY turn it's available.
      // Top tier setup ability (above most damage abilities).
      score = player.deck.length >= 2 ? 92 : 0;

    } else if (abilityLower.includes("run away draw")) {
      // Draw 3 cards, then shuffle this Pokémon (Dudunsparce) back into the deck.
      // CRITICAL SAFETY RULES:
      // 1. Never fire from the ACTIVE spot: the engine does NOT create PROMOTE pending
      //    when the active Pokémon voluntarily shuffles back (engine bug). This leaves P1
      //    with active=null and no PROMOTE, causing a broken draw-game state.
      // 2. Never fire with empty bench: PROMOTE would fire immediately, and with no bench
      //    Pokémon, P1 loses the game immediately.
      const pokemon = allOwn.find((p) => p.instanceId === action.pokemonId);
      const isActivePosition = player.active?.instanceId === pokemon?.instanceId;
      const hasBench = player.bench.length > 0;
      if (isActivePosition) {
        score = 0; // CRITICAL: engine bug — PROMOTE not created if active shuffles itself
      } else if (!hasBench) {
        score = 0; // CRITICAL: empty bench → game-ending PROMOTE → never trigger
      } else if (player.hand.length <= 2) {
        score = 82; // Empty-ish hand — urgent refuel
      } else if (player.hand.length <= 4) {
        score = 65; // Low hand — worth refuelling
      } else {
        score = 40; // Decent hand but still net positive
      }
      // Alakazam hoards its hand for Powerful Hand (20 × cards in hand) —
      // once the hand already KOs the opponent's Active, further drawing only
      // burns the deck (self-play: 5 of Alakazam's 6 losses were deck-outs).
      if (ctx?.archetype === "alakazam" && score > 0 && opponent.active) {
        const handLethal = player.hand.length * 20 >= remainingHp(state, opponent.active);
        if (handLethal && player.hand.length >= 7) score = 0;
        else if (player.deck.length <= 18 && player.hand.length >= 7) score = Math.min(score, 15);
      }

    } else if (abilityLower.includes("psychic draw")) {
      // Kadabra: draw when evolved (passive — engine auto-triggers, no AI decision needed).
      // But if it shows up as an activatable ability, draw now (always beneficial).
      score = 60;

    } else if (abilityLower.includes("teleporter")) {
      // Abra Teleporter: shuffle Abra (Active) + attached cards into deck, then PROMOTE fires.
      // Guards: bench must be non-empty (or PROMOTE has nothing to promote → game loss),
      // and a better attacker (Kadabra or Alakazam) should be on the bench to make the switch
      // worthwhile.
      const hasBench = player.bench.length > 0;
      const hasBetterAttacker = player.bench.some((b) => {
        const bDef = getDefinition(state, b.definitionId);
        const bName = bDef?.name?.toLowerCase() ?? "";
        return bName.includes("kadabra") || bName.includes("alakazam");
      });
      if (!hasBench || !hasBetterAttacker) {
        score = 0; // No bench or no attacker to promote — never shuffle
      } else {
        score = 65; // Upgrade the Active spot from Abra to a real attacker
      }

    }
    // Unknown ability → skip (do not trigger abilities with unhandled pending states)

    // Deck-out awareness — see deckOutAwareness.ts.
    score = applyDeckOutAbilityPenalty(score, abilityLower, player.deck.length);

    return { action, score };
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  recordTrace(trace, scored.map((s) => ({ label: s.action.abilityName, score: s.score })));

  return scored[0]?.action ?? null;
}

/**
 * Pick the best attack for the active Pokémon.
 * - Prefers attacks that KO the opponent
 * - Estimates variable damage (60×, 60+) from game context
 * - Gates strategy-specific attacks (Rocket Feathers, Gale Thrust) on preconditions
 * - Boosts the archetype's signature attack
 */
export function pickBestAttack(
  state: EngineState,
  playerId: PlayerId,
  ctx?: StrategyContext,
  trace?: DecisionCandidate[],
): string | null {
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  if (!player.active) return null;

  // Strategy gate: skip attacking if the deck needs to load resources first
  if (shouldSkipAttack(state, playerId, ctx)) return null;

  const def = getDefinitionSafe(state, player.active.definitionId);
  const affordableAttacks = (def.attacks ?? []).filter(
    (attack) => canAffordAttack(state, player.active!, attack),
  );
  if (affordableAttacks.length === 0) return null;

  const opponentHp = opponent.active ? remainingHp(state, opponent.active) : 9999;
  const signatureAttack = ctx?.profile.signatureAttack?.toLowerCase();

  const scored = affordableAttacks.map((attack) => {
    let dmg = estimateAttackDamage(state, playerId, attack.name, attack.damage);
    // Fallback: some attacks have damage:""  but list a number in the text
    // e.g. "This attack does 120 damage to 2 of your opponent's Pokémon."
    if (dmg === 0 && attack.text) {
      const textMatch = attack.text.match(/\b(\d{2,3})\s*damage\b/i);
      if (textMatch) dmg = parseInt(textMatch[1]!, 10);
    }

    // Setup attacks: 0-damage attacks with search/bench effects that move the game forward.
    // The AI normally skips 0-damage attacks, but these are valuable for setup turns.
    if (dmg === 0 && attack.text && ctx) {
      const atkLower = attack.name.toLowerCase();
      // Frogadier "Summoning Jutsu" — search up to 3 Pokémon from deck to hand.
      // Essential for finding Greninja ex + Dusknoir + Mega Froslass ex in one attack.
      if (ctx.archetype === "greninja" && atkLower.includes("summoning jutsu")) {
        const allInPlay = [...(player.active ? [player.active] : []), ...player.bench];
        const inPlayNames = allInPlay.map((p) => getDefinition(state, p.definitionId)?.name?.toLowerCase() ?? "");
        const keyPokemon = ["greninja ex", "dusknoir", "mega froslass ex"];
        const missingKeys = keyPokemon.filter((k) =>
          !inPlayNames.some((n) => n.includes(k)) &&
          !player.hand.some((c) => (getDefinition(state, c.definitionId)?.name?.toLowerCase() ?? "").includes(k)),
        );
        if (missingKeys.length > 0) dmg = 40 + missingKeys.length * 15; // Setup value scales with missing pieces
      }
      // Froakie "Flock" — search up to 2 Froakies from deck to bench.
      // Useful T1–T2 when bench needs more Froakies for evolution chain.
      if (ctx.archetype === "greninja" && atkLower.includes("flock")) {
        const froakiesOnBench = player.bench.filter((p) =>
          (getDefinition(state, p.definitionId)?.name?.toLowerCase() ?? "").includes("froakie"),
        ).length;
        const froakiesNeeded = Math.max(0, 2 - froakiesOnBench);
        if (froakiesNeeded > 0 && player.bench.length < 4) dmg = 25 + froakiesNeeded * 10;
      }
    }

    const isKo = dmg >= opponentHp && dmg > 0;
    const isSignature = signatureAttack && attack.name.toLowerCase().includes(signatureAttack);

    // Lopunny special case: Gale Thrust is the signature BUT only gives +170 bonus when Lopunny
    // moved from bench this turn. Without the bonus, Spiky Hopper (160) is the better attack.
    // Only apply the signature bonus when Gale Thrust actually has the movement bonus active.
    let signatureBonus = 0;
    if (isSignature) {
      if (ctx?.archetype === "lopunny" && attack.name.toLowerCase().includes("gale thrust")) {
        const movedIds = state.turnFlags.movedFromBenchToActiveIds ?? [];
        const lopunnyMoved = player.active && movedIds.includes(player.active.instanceId);
        signatureBonus = lopunnyMoved ? 500 : 0; // Only prefer Gale Thrust when it has the +170 bonus
      } else {
        signatureBonus = 500; // All other signature attacks get the standard bonus
      }
    }

    let score = isKo ? 10000 + dmg : dmg;
    score += signatureBonus;

    return { name: attack.name, score };
  }).sort((a, b) => b.score - a.score);

  recordTrace(trace, scored.map((s) => ({ label: s.name, score: s.score })));

  // Only attack if expected damage > 0 (don't waste Rocket Feathers with empty hand)
  if ((scored[0]?.score ?? 0) <= 0) return null;

  return scored[0]?.name ?? null;
}

/**
 * Pick the best Pokémon to attach energy to:
 * 1. Active, if it could attack with this energy (one energy away from cost)
 * 2. Bench Pokémon with the most energy already toward attack cost
 * 3. Active as fallback
 */
/**
 * Pick which energy card from hand to attach to a given target Pokémon.
 *
 * Old logic only looked at the Pokémon's type. That breaks for multi-type
 * attacks like Dragapult ex's Phantom Dive (Fire + Psychic) — the AI would
 * keep attaching Psychic (matches Dragapult's type) and never grab a Fire,
 * so Phantom Dive could never come online.
 *
 * New logic ranks candidate energies by how well they cover the Pokémon's
 * BIGGEST UNFULFILLED ATTACK COST. Concretely, for each energy in hand we
 * simulate "what if I attached this?" and count how many attack costs are
 * now closer to being paid. Colorless energy gets a small bonus because it
 * fits anywhere. Types the attack DOESN'T need are penalised.
 *
 * Returns the chosen energy CardInstance, or `null` if there are no
 * energies in the player's hand.
 */
export function pickBestEnergyForTarget(
  state: EngineState,
  energiesInHand: CardInstance[],
  target: CardInstance,
): CardInstance | null {
  if (energiesInHand.length === 0) return null;
  if (energiesInHand.length === 1) return energiesInHand[0]!;

  const def = getDefinitionSafe(state, target.definitionId);
  const attacks = def.attacks ?? [];

  // Count what types of energy the target needs ACROSS ALL its attacks,
  // weighted by attack cost (bigger attacks matter more). Subtract what's
  // already attached so we focus on the GAP.
  const need: Record<string, number> = {};
  const have: Record<string, number> = {};

  for (const eng of target.attachedEnergy) {
    const ed = getDefinitionSafe(state, eng.definitionId);
    const t = ed.types?.[0] ?? "Colorless";
    have[t] = (have[t] ?? 0) + 1;
  }

  // Look at each attack and tally outstanding non-Colorless requirements.
  // Colorless slots can be filled by anything, so we tally them last.
  let totalColorlessNeed = 0;
  let totalCostInProgress = 0;
  for (const attack of attacks) {
    const cost = attack.cost ?? [];
    if (cost.length === 0) continue;
    totalCostInProgress = Math.max(totalCostInProgress, cost.length);
    const remaining: Record<string, number> = { ...have };
    let colorlessSlots = 0;
    for (const c of cost) {
      if (c === "Colorless") {
        colorlessSlots += 1;
      } else if ((remaining[c] ?? 0) > 0) {
        remaining[c]! -= 1;
      } else {
        // This typed cost is still unmet — add to need.
        need[c] = (need[c] ?? 0) + 1;
      }
    }
    // Colorless slots can be filled by leftover energy of any type. Add to
    // the colorless tally only after accounting for what we already have.
    const leftover = Object.values(remaining).reduce((a, b) => a + b, 0);
    totalColorlessNeed += Math.max(0, colorlessSlots - leftover);
  }

  // Score each candidate energy by how much "need" it covers.
  const scored = energiesInHand.map((energy) => {
    const ed = getDefinitionSafe(state, energy.definitionId);
    const types = ed.types ?? ["Colorless"];
    let score = 0;
    for (const t of types) {
      if (t === "Colorless") {
        // Colorless covers any Colorless slot.
        if (totalColorlessNeed > 0) score += 30;
        else score += 5; // mild fallback bonus
      } else if ((need[t] ?? 0) > 0) {
        // High value — fills a specific typed gap in an attack cost.
        score += 100 + (need[t]! * 20);
      } else {
        // Energy type the attack doesn't actually need. Still useful as a
        // Colorless filler, but much less so than the right type.
        if (totalColorlessNeed > 0) score += 15;
        else score -= 5; // genuinely wrong type
      }
    }
    return { energy, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]!.energy;
}

/**
 * Decide the next MAIN-PHASE action for the active player using the heuristic
 * decision chain, or `null` to signal "end turn".
 *
 * This is the loop body of runAutoMatch, extracted so it can be shared by the
 * policy seam (HeuristicPolicy) and used as the fallback when an LLM policy
 * can't produce a legal action. It chooses ONLY the top-level action; the
 * caller is responsible for applying it (gameReducer) and resolving any
 * resulting pendingAction via drainAutoPending.
 *
 * Order mirrors runAutoMatch exactly: trainer → basic → evolve → energy →
 * ability → retreat → attack. Returns null when nothing is worth doing.
 */
/** Consult the archetype's combo lines; return the first action one forces, or null. */
export function pickComboAction(
  state: EngineState,
  playerId: PlayerId,
  ctx: StrategyContext | undefined,
): GameAction | null {
  if (!ctx || state.turnFlags.attacked || state.pendingAction) return null;
  const legal = getLegalActions(state);
  for (const line of getComboLines(ctx.archetype)) {
    const action = line.nextStep({ state, playerId, legal });
    if (action) return action;
  }
  return null;
}

export function pickHeuristicMainAction(
  state: EngineState,
  playerId: PlayerId,
  ctx?: StrategyContext,
): GameAction | null {
  const player = getPlayer(state, playerId);
  if (state.pendingAction) return null; // caller drains pending separately

  // 0. Deck-expert combo lines — force the deck's signature next step before
  //    the generic scoring chain.
  const comboAction = pickComboAction(state, playerId, ctx);
  if (comboAction) return comboAction;

  // 1-3. Trainer / tool / basic / evolve (only before attacking)
  if (!state.turnFlags.attacked) {
    const trainerAction = pickAutoTrainerAction(state, ctx);
    if (trainerAction) return trainerAction;
    const toolAction = pickAutoToolAction(state, ctx);
    if (toolAction) return toolAction;
    const basicAction = pickAutoPlayBasicAction(state, ctx);
    if (basicAction) return basicAction;
    const evolveAction = pickAutoEvolveAction(state, ctx);
    if (evolveAction) return evolveAction;
  }

  // 4. Attach energy (once per turn) to the best target with the best-fit energy.
  if (
    !state.turnFlags.energyAttached &&
    player.hand.some((card) => getDefinition(state, card.definitionId)?.supertype === "Energy")
  ) {
    const primaryTarget = pickBestEnergyTarget(state, playerId, ctx);
    if (primaryTarget) {
      const targetMon = [...(player.active ? [player.active] : []), ...player.bench]
        .find((p) => p.instanceId === primaryTarget);
      const energiesInHand = player.hand.filter(
        (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
      );
      const bestEnergyForTarget = targetMon
        ? pickBestEnergyForTarget(state, energiesInHand, targetMon)
        : energiesInHand[0];
      if (bestEnergyForTarget) {
        return {
          type: "ATTACH_ENERGY",
          playerId,
          energyId: bestEnergyForTarget.instanceId,
          targetId: primaryTarget,
        };
      }
    }
  }

  // 5. Activatable abilities.
  const abilityAction = pickAutoAbilityAction(state, ctx);
  if (abilityAction) return abilityAction;

  // 6. Retreat to a better attacker.
  if (!state.turnFlags.retreated && !state.turnFlags.attacked) {
    const retreatAction = pickRetreatAction(state, playerId, ctx);
    if (retreatAction) return retreatAction;
  }

  // 7. Attack (only if ATTACK is actually legal).
  const canAttackThisTurn =
    !!player.active &&
    !state.turnFlags.attacked &&
    getLegalActions(state).some((a) => a.type === "ATTACK");
  if (canAttackThisTurn) {
    const bestAttack = pickBestAttack(state, playerId, ctx);
    if (bestAttack) return { type: "ATTACK", playerId, attackName: bestAttack };
  }

  return null; // end turn
}

export function pickBestEnergyTarget(state: EngineState, playerId: PlayerId, ctx?: StrategyContext): string | null {
  const player = getPlayer(state, playerId);
  const allPokemon = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  if (allPokemon.length === 0) return null;

  // What energy types do we have in hand? Used to penalise targets we cannot fuel.
  const energyTypesInHand = new Set<string>();
  let haveColorlessEnergy = false;
  for (const card of player.hand) {
    const def = getDefinitionSafe(state, card.definitionId);
    if (def.supertype !== "Energy") continue;
    const types = def.types ?? ["Colorless"];
    for (const t of types) {
      energyTypesInHand.add(t);
      if (t === "Colorless") haveColorlessEnergy = true;
    }
  }

  // Is the active Pokémon close to dying? If so, the bench backup is the better
  // home for fresh energy — the current attacker will be KO'd before another swing.
  const activeMon = player.active;
  let activeIsDying = false;
  if (activeMon) {
    const activeDef = getDefinitionSafe(state, activeMon.definitionId);
    const maxHp = parseInt(activeDef.hp ?? "0", 10) || 0;
    if (maxHp > 0) {
      const hpRatio = remainingHp(state, activeMon) / maxHp;
      activeIsDying = hpRatio < 0.4 && player.bench.length > 0;
    }
  }

  const scored = allPokemon.map((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    const nameLower = def.name.toLowerCase();
    const energyCount = pokemon.attachedEnergy.length;
    const isActive = player.active?.instanceId === pokemon.instanceId;
    const attacks = def.attacks ?? [];
    const hasAttacks = attacks.length > 0;

    // Hard filter: a Pokémon that literally has no attacks (Snorunt, Dunsparce,
    // pure-ability Pokémon, etc.) can never use energy. Eliminate them outright.
    if (!hasAttacks) {
      return { id: pokemon.instanceId, score: -1000 };
    }

    // Distance metrics — distinguish "can use any attack" vs "ready for the big one".
    // Most attackers have a cheap setup attack AND a strong finisher; once the cheap
    // attack is affordable the Pokémon isn't "done" yet — we still want to load up
    // for the big attack.
    // Does any attack scale its damage with energy ATTACHED TO THIS Pokémon?
    // (e.g. "does 30 more damage for each Energy attached to this Pokémon").
    // Such an attacker is never "done" — more energy = more damage — so it is
    // never treated as fully loaded and is exempt from the over-attach cap.
    const scalesWithOwnEnergy = attacks.some((atk) =>
      /for each .*energy attached to this/i.test(atk.text ?? ""),
    );

    const costs = attacks.map((atk) => atk.convertedEnergyCost ?? atk.cost?.length ?? 1);
    const cheapestCost = Math.min(...costs);
    const mostExpensiveCost = Math.max(...costs);
    const energiesNeededForCheapest = Math.max(0, cheapestCost - energyCount);
    const energiesNeededForMax = Math.max(0, mostExpensiveCost - energyCount);
    // "Can use the biggest attack" — but a scaling attacker keeps wanting more.
    const fullyLoaded = energiesNeededForMax === 0 && !scalesWithOwnEnergy;

    // Base score — bringing a NEW attacker online is the highest-leverage attach.
    let score: number;
    if (fullyLoaded) {
      score = -80; // truly done — pointless to keep attaching
    } else if (energiesNeededForCheapest === 1) {
      score = 70; // ONE-AWAY from being able to attack at all
    } else if (energiesNeededForCheapest === 2) {
      score = 35; // TWO-AWAY: meaningful progress
    } else if (energiesNeededForCheapest === 0) {
      // Can attack now but still building toward the bigger attack — neutral start.
      score = 25;
    } else {
      score = 10 + energyCount * 4; // building up — modest preference for partials
    }

    // Active gets a flat boost — it's the one swinging now.
    if (isActive) score += 20;

    // Active is about to be KO'd → that energy is wasted; redirect to bench.
    if (isActive && activeIsDying) score -= 50;
    if (!isActive && activeIsDying) score += 18;

    // Type matching: penalise targets we cannot fuel from our current hand.
    // Colorless-type Pokémon accept any energy → no penalty.
    const pokemonTypes = def.types ?? ["Colorless"];
    const targetIsColorless = pokemonTypes.includes("Colorless");
    if (!targetIsColorless && energyTypesInHand.size > 0) {
      const typeMatches =
        haveColorlessEnergy || pokemonTypes.some((t) => energyTypesInHand.has(t));
      if (!typeMatches) score -= 30;
    }

    // Archetype-aware: boost Pokémon the strategy wants energised.
    if (ctx) {
      const archPriority = getArchetypeEnergyPriority(ctx.archetype, nameLower);
      score += archPriority;

      // PRIMARY ATTACKER PROTECTION (archPriority >= 85):
      // The deck's main attacker must always be able to use its attacks.
      // Give a strong baseline bonus until it's fully loaded for its biggest
      // attack — beats one-away setup Pokémon even when the primary is on
      // the bench. Active primaries get an extra layer so we don't whiff a
      // turn loading the bench while the active sits one short.
      if (archPriority >= 85 && !fullyLoaded) {
        score += 60;
        if (isActive) score += 25;             // active primary: load NOW
        if (energiesNeededForMax === 1) score += 35; // primary one-away from finisher
      }

      // ─ Per-archetype hard exclusions (true no-energy Pokémon) ─
      // Pokémon that have NO meaningful energy attack: ability-only, item-lockers,
      // or evolution-bait. Use very strong (-200) penalties.
      if (nameLower.includes("dusknoir") || nameLower.includes("munkidori") || nameLower.includes("dusclops")) score -= 200;
      if (ctx.archetype === "dragapult" && nameLower.includes("budew")) score -= 200;
      if (ctx.archetype === "greninja" && nameLower.includes("budew")) score -= 200;
      if (ctx.archetype === "garchomp" && (nameLower.includes("roserade") || nameLower.includes("roselia"))) score -= 200;
      if (ctx.archetype === "hydrapple" && nameLower.includes("meganium")) score -= 200;
      // Zoroark deck only ships Darkness Energy, but N's Zekrom (Fire+L+L+C)
      // and N's Darmanitan (Fire-based) need types we don't have. Pecharunt ex
      // does share Darkness but starves Zoroark ex of energy. User-requested:
      // focus 100% on N's Zoroark ex.
      if (ctx.archetype === "zoroark" && (
        nameLower.includes("n's zekrom") ||
        nameLower.includes("n's darmanitan") ||
        nameLower.includes("n's darumaka")
      )) score -= 200;
      if (ctx.archetype === "zoroark" && nameLower.includes("pecharunt ex")) score -= 150;

      // ─ Soft avoidance: weaker than primaries but can still take energy if nothing else ─
      // Original values from before the rework — gentle penalties that don't completely
      // shut out the Pokémon. archPriority already keeps primaries in the lead.
      if (ctx.archetype === "zoroark" && nameLower.includes("zorua")) score -= 80;
      if (ctx.archetype === "hydrapple" && nameLower.includes("bayleef")) score -= 30;
      if (ctx.archetype === "greninja" && (nameLower.includes("froakie") || nameLower.includes("snorunt") || nameLower.includes("latias ex"))) score -= 60;
      if (ctx.archetype === "alakazam" && (nameLower.includes("abra") || nameLower.includes("dunsparce") || nameLower.includes("dudunsparce"))) score -= 80;

      // ─ Per-archetype small boosts (situational attackers / setup) ─
      if (ctx.archetype === "ogerpon-box" && nameLower.includes("teal mask ogerpon")) score += 20;
      if (ctx.archetype === "greninja" && nameLower.includes("frogadier")) score += 10;
      if (ctx.archetype === "greninja" && nameLower.includes("mega froslass ex")) score += 15;
      if (ctx.archetype === "alakazam" && nameLower.includes("kadabra")) score += 10;

      // Lopunny: load BENCH Mega Lopunny so it's ready when it retreats into Active.
      // Unless the current Active just came from the bench this turn (its energy is fresh).
      if (ctx.archetype === "lopunny" && nameLower.includes("mega lopunny ex") && !isActive) {
        const movedIds = state.turnFlags.movedFromBenchToActiveIds ?? [];
        const activeJustMoved = player.active && movedIds.includes(player.active.instanceId);
        if (!activeJustMoved) score += 25;
      }
    }

    // DON'T OVER-ATTACH: a Pokémon that can already use its biggest attack
    // gains nothing from another energy. Cap it below the skip threshold so the
    // attachment is redirected to a backup attacker — or held in hand when
    // there's no better home — instead of being wasted on (and tied up by) an
    // already-maxed attacker. (Scaling attackers are never `fullyLoaded`.)
    if (fullyLoaded) {
      score = Math.min(score, -90);
    }

    return { id: pokemon.instanceId, score };
  }).sort((a, b) => b.score - a.score);

  // Skip when every option is a deeply-negative target: true no-energy Pokémon
  // (Dusknoir / Munkidori, scored ≤ -200) OR an already-fully-loaded board where
  // attaching more would be wasted (capped at -90). Mildly-negative scores still
  // attach — a sub-optimal energy beats wasting the turn's only attachment.
  const best = scored[0];
  if (!best || best.score < -80) return null;
  return best.id;
}

export function pickAutoTrainerAction(state: EngineState, ctx?: StrategyContext, trace?: DecisionCandidate[]): Extract<GameAction, { type: "PLAY_TRAINER" }> | null {
  const playerId = state.currentPlayerId;
  const player = getPlayer(state, playerId);
  const opponent = getPlayer(state, getOpponentId(playerId));
  const legal = getLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: "PLAY_TRAINER" }> => action.type === "PLAY_TRAINER",
  );
  if (legal.length === 0) return null;

  const handSize = player.hand.length;
  const hasSupporterInLegal = legal.some((action) => {
    const card = player.hand.find((entry) => entry.instanceId === action.instanceId);
    const def = card ? getDefinition(state, card.definitionId) : undefined;
    return def && isSupporter(def);
  });


  const scored = legal
    .map((action) => {
      const card = player.hand.find((entry) => entry.instanceId === action.instanceId);
      const def = card ? getDefinition(state, card.definitionId) : undefined;
      if (!def) return { action, score: -1 };
      const name = def.name.toLowerCase();
      const supporter = isSupporter(def);

      // Never play a second Supporter (engine already blocks, but skip scoring)
      if (supporter && state.turnFlags.supporterPlayed) return { action, score: -1 };

      let score = 0;

      // === SUPPORTERS ===
      if (name.includes("lillie's determination") || name.includes("lillie")) {
        score = handSize >= 4 ? 95 : 50;
      } else if (name.includes("iono") && opponent.prizes.length <= 3) {
        score = 90;
      } else if (name.includes("iono")) {
        score = handSize <= 3 ? 75 : 55;
      } else if (name.includes("professor's research") || name.includes("professor sada") || name.includes("professor turo")) {
        score = handSize >= 3 ? 88 : 45;
      } else if (name.includes("hilda")) {
        score = 85;
      } else if (name.includes("dawn")) {
        // Dawn: attach 2 Basic Psychic Energy from deck to a Psychic Pokémon.
        // Critical for Alakazam — energy acceleration to power Powerful Hand attacker.
        const allInPlay = [...(player.active ? [player.active] : []), ...player.bench];
        const psychicNeedsEnergy = allInPlay.some((p) => {
          const pDef = getDefinition(state, p.definitionId);
          return pDef?.types?.includes("Psychic") && p.attachedEnergy.length <= 1;
        });
        const hasPsychicEnergyInDeck = player.deck.some((c) => {
          const d = getDefinition(state, c.definitionId);
          return d?.supertype === "Energy" && (d?.types?.includes("Psychic") || d?.name?.toLowerCase().includes("psychic"));
        });
        if (psychicNeedsEnergy && hasPsychicEnergyInDeck) score = 78;
        else if (hasPsychicEnergyInDeck) score = 50;
        else score = 12;
      } else if (name.includes("judge")) {
        score = opponent.hand.length >= 5 ? 80 : 65;
      } else if (name.includes("wally's compassion")) {
        // Wally's Compassion: heal ALL damage from Mega Evolution Pokémon ex; energy returns to hand.
        // Pokémon stays in play — safe to play any time a Mega Lopunny ex (or other Mega ex) has damage.
        const damagedMega = [...player.bench, ...(player.active ? [player.active] : [])].find(
          (mon) => {
            const d = getDefinition(state, mon.definitionId);
            return d?.name?.toLowerCase().includes("mega") && d?.name?.toLowerCase().includes("ex") && mon.damageCounters > 0;
          },
        );
        // Use -1000 so even the archetype bonus (+25) cannot bring the score above 0 when no target
        score = damagedMega ? 105 : -1000;
      } else if (name.includes("colress's tenacity") || name.includes("colress")) {
        // Colress's Tenacity: search deck for 1 Stadium + 1 Energy (both to hand), then shuffle.
        // Essential for Greninja: finds Grand Tree + Water Energy.
        score = 55;
      } else if (name.includes("surfer")) {
        // Surfer: switch YOUR Active with a Bench Pokémon, then draw until you have 5 cards.
        // Only play when bench has a higher-priority attacker than current active.
        if (player.bench.length === 0) {
          score = -1;
        } else {
          const activeArchPrio = ctx && player.active
            ? getArchetypeEnergyPriority(ctx.archetype, (getDefinition(state, player.active.definitionId)?.name ?? "").toLowerCase())
            : 0;
          const bestBenchArchPrio = player.bench.reduce((best, b) => {
            const bName = (getDefinition(state, b.definitionId)?.name ?? "").toLowerCase();
            const prio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
            return Math.max(best, prio);
          }, 0);
          // Play Surfer when bench has a better attacker (by ≥25 priority gap) OR hand is small
          const worthSwitching = bestBenchArchPrio > activeArchPrio + 25;
          score = worthSwitching ? 50 : (handSize <= 3 ? 30 : 10);
        }
      } else if (name.includes("arven")) {
        score = 72;
      } else if (name.includes("cyrano")) {
        score = 70;
      } else if (name.includes("boss's orders") || name.includes("boss")) {
        if (opponent.bench.length === 0) {
          score = -1;
        } else {
          // Use estimated attack damage (includes variable-damage attacks like Night Joker)
          const activeDef = player.active ? getDefinition(state, player.active.definitionId) : undefined;
          const maxAtkDmg = (activeDef?.attacks ?? []).reduce((best, atk) => {
            const est = estimateAttackDamage(state, playerId, atk.name, atk.damage);
            return Math.max(best, est);
          }, 0);
          const hasKOTarget = maxAtkDmg > 0 && opponent.bench.some((b) => remainingHp(state, b) <= maxAtkDmg);
          // Prize rush: in late game, always Boss to pull the easiest target
          const prizeRush = opponent.prizes.length <= 2;
          score = hasKOTarget ? 72 : prizeRush ? 60 : (opponent.prizes.length <= 3 ? 48 : 35);
        }
      } else if (name.includes("crispin") && (player.bench.length > 0 || player.active)) {
        // Crispin: attach 2 Basic Energy from discard to any Basic Pokémon (or evolve into one).
        // Urgently prioritize when primary attacker is in play with 0-1 energy (needs acceleration).
        const allInPlay = [...(player.active ? [player.active] : []), ...player.bench];
        const primaryNeedsEnergy = allInPlay.some((p) => {
          const pName = (getDefinition(state, p.definitionId)?.name ?? "").toLowerCase();
          const archPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, pName) : 0;
          return archPrio >= 80 && p.attachedEnergy.length <= 1; // Primary attacker with ≤1 energy
        });
        const hasTwoEnergyInDiscard = player.discard.filter(
          (c) => getDefinition(state, c.definitionId)?.supertype === "Energy",
        ).length >= 2;
        if (primaryNeedsEnergy && hasTwoEnergyInDiscard) {
          score = 78; // Urgent energy acceleration — prioritise over draw supporters
        } else if (primaryNeedsEnergy) {
          score = 55; // Attacker needs energy but fewer than 2 in discard
        } else {
          score = 32;
        }
      } else if (name.includes("rosa")) {
        score = 28;
      } else if (name.includes("black belt's training")) {
        // +40 this turn vs the opponent's Active ex. A generic-supporter score
        // would burn it as filler — hold it for the turn it FLIPS a KO
        // (Night Joker 250 + Binding Mochi 40 + this 40 = 330, exactly a
        // Mega/Tera ex). The ability step runs the Mochi pivot before this is
        // re-scored, so a poisoned Mochi holder in the Active is visible here.
        const oppActive = opponent.active;
        const oppIsEx = oppActive
          ? (getDefinition(state, oppActive.definitionId)?.subtypes ?? []).includes("ex")
          : false;
        if (!oppActive || !oppIsEx) {
          score = -1;
        } else {
          const oppHp = remainingHp(state, oppActive);
          const activeDef = player.active ? getDefinition(state, player.active.definitionId) : undefined;
          const mochiBonus =
            player.active &&
            player.active.statusConditions.includes("Poisoned") &&
            holdsBindingMochi(state, player.active)
              ? 40
              : 0;
          const est = (activeDef?.attacks ?? []).reduce(
            (best, atk) => Math.max(best, estimateAttackDamage(state, playerId, atk.name, atk.damage)),
            0,
          );
          // Unpenalised Night Joker template reach (the estimate discounts
          // Rampaging Thunder when it does not KO — but with the +40s it may).
          const njRaw = (activeDef?.name ?? "").toLowerCase().includes("n's zoroark ex")
            ? player.bench.reduce((best, b) => {
                const bDef = getDefinition(state, b.definitionId);
                if (!bDef?.name?.toLowerCase().startsWith("n's")) return best;
                return Math.max(best, ...(bDef.attacks ?? []).map((a) => parseInt(a.damage, 10) || 0));
              }, 0)
            : 0;
          const potential = Math.max(est, njRaw) + mochiBonus;
          score = potential < oppHp && potential + 40 >= oppHp ? 96 : 6;
        }
      // === TEAM ROCKET SUPPORTERS (specific scoring for Honchkrow archetype) ===
      } else if (name.includes("team rocket's transceiver")) {
        // Grab a TR Supporter from deck — critical for Rocket Feathers setup
        score = 70;
      } else if (name.includes("team rocket's ariana")) {
        // Draws to 8 if all Pokémon in play are TR — enormous hand refresh
        score = 65;
      } else if (name.includes("team rocket's proton")) {
        // Proton is the ONE Supporter playable on the FIRST turn going first
        // (engine exempts it via isProtonSupporter). It searches 3 Basic TR
        // Pokémon to fill the bench — the highest-priority turn-1 play, so it
        // must beat every item (Transceiver/Poffin ~70). Always play it first.
        if (state.turnNumber === 1) score = 100;
        else score = player.bench.length < 2 ? 68 : 22;
      } else if (name.includes("team rocket's giovanni")) {
        // Boss pull: opponent's best bench Pokémon goes active
        score = opponent.bench.length > 0 ? 58 : 20;
      } else if (name.includes("team rocket's archer")) {
        // Both players shuffle hands; you draw 5, opponent draws 3 — great reload
        score = 75;
      } else if (name.includes("team rocket's")) {
        // Generic TR Supporter (Petrel, etc.) — better than generic fallback
        score = 30;
      } else if (supporter && !state.turnFlags.supporterPlayed) {
        score = 12; // generic Supporter fallback

      // === ITEMS ===
      } else if (name.includes("poké pad") || name.includes("poke pad")) {
        score = player.bench.length < 3 && player.deck.length > 0 ? 75 : 50;
      } else if (name.includes("buddy-buddy poffin") || name.includes("poffin")) {
        score = player.bench.length < 3 ? 70 : 20;
      } else if (name.includes("ultra ball")) {
        // Ultra Ball: best when we have cards to discard (costs 2) and something to search for
        const hasMissingKeyPokemon = ctx ? ctx.profile.ultraBallKeep.some((key) => {
          const keyLower = key.toLowerCase();
          const inPlay = [...(player.active ? [player.active] : []), ...player.bench];
          return !inPlay.some((p) => (getDefinition(state, p.definitionId)?.name?.toLowerCase() ?? "").includes(keyLower));
        }) : false;
        score = handSize >= 4 && hasMissingKeyPokemon ? 72 : handSize >= 4 ? 55 : 30;
      } else if (name.includes("pokégear") || name.includes("pokegear")) {
        score = !state.turnFlags.supporterPlayed && !hasSupporterInLegal ? 60 : 25;
      } else if (name.includes("night stretcher")) {
        const hasPokemonInDiscard = player.discard.some(
          (entry) => getDefinition(state, entry.definitionId)?.supertype === "Pokémon",
        );
        score = hasPokemonInDiscard ? 58 : -1;
      } else if (name.includes("rare candy")) {
        // Rare Candy is only valuable when we have a Stage 2 in hand AND a valid Basic on bench
        const allInPlay = [...(player.active ? [player.active] : []), ...player.bench];
        const hasRareCandyTarget = allInPlay.some((mon) => {
          const monDef = getDefinitionSafe(state, mon.definitionId);
          if (!isBasicPokemon(monDef) || mon.enteredPlayTurn === state.turnNumber) return false;
          return player.hand.some((hCard) => {
            const hDef = getDefinitionSafe(state, hCard.definitionId);
            return isStage2(hDef) && canRareCandyEvolveInto(state, monDef, hDef);
          });
        });
        score = hasRareCandyTarget ? 95 : 8; // Must beat Iono (90) so we evolve before shuffling Rare Candy away
      } else if (name.includes("grand tree")) {
        // Grand Tree: stadium that lets you evolve a full chain from deck (Basic → Stage 1 → Stage 2).
        // Critically valuable for Stage 2 decks (Greninja, Dragapult, etc.) — prioritise playing it early.
        // Check if we have a Basic in play that could be evolved. Score lower so other trainers aren't crowded out.
        const allInPlay2 = [...(player.active ? [player.active] : []), ...player.bench];
        const hasEvolutionTarget = allInPlay2.some((mon) => {
          const monDef = getDefinitionSafe(state, mon.definitionId);
          if (!isBasicPokemon(monDef)) return false;
          return true;
        });
        score = hasEvolutionTarget ? 68 : 35;
      } else if (name.includes("crushing hammer")) {
        // Energy denial is Dragapult's real-world tempo engine, not filler.
        // Score by the best available target: deny an attack / strip Special
        // Energy → high; just chip the active → medium; nothing worth hitting
        // (only spare bench basics) → skip and keep the card for a live target.
        const best = bestCrushingHammerTarget(state, playerId);
        if (!best) score = -1;
        else if (best.score >= 65) score = 60;   // load-bearing AND active/special
        else if (best.score >= 45) score = 50;   // load-bearing, or active special
        else if (best.score >= 30) score = 40;   // hits the active attacker
        else score = -1;                          // only spare bench energy → hold
      } else if (name.includes("unfair stamp")) {
        score = opponent.prizes.length <= 3 ? 45 : 10;
      } else if (name.includes("air balloon")) {
        // Lopunny: Air Balloon on Lopunny enables Gale Thrust retreat cycle
        const lopunnyNeedsBalloon = (player.active && !player.active.attachedTools.length &&
          getDefinition(state, player.active.definitionId)?.name?.toLowerCase().includes("lopunny")) ||
          player.bench.some((p) => !p.attachedTools.length && getDefinition(state, p.definitionId)?.name?.toLowerCase().includes("lopunny"));
        score = lopunnyNeedsBalloon ? 65 : (player.active && !player.active.attachedTools.length ? 22 : -1);
      } else if (name.includes("energy switch")) {
        score = player.bench.length > 0 ? 28 : -1;
      } else if (name.includes("battle cage")) {
        score = 35;
      } else if (name.includes("team rocket's factory")) {
        // Honchkrow: TR Factory is critical — play ASAP before drawing
        score = !state.stadium ? 80 : 25; // Very high if no stadium in play
      } else if (name.includes("mist energy")) {
        // Mist Energy: blocks Bench attack effects — best on Lopunny bench (prevents Phantom Dive counters)
        const hasBenchNeedsMist = player.bench.some((p) => !p.attachedTools.length &&
          (getDefinition(state, p.definitionId)?.name?.toLowerCase().includes("lopunny") ?? false));
        score = hasBenchNeedsMist ? 50 : 20;
      } else if (name.includes("enriching energy") || name.includes("ignition energy")) {
        // Special energies: treat as items to attach later
        score = 15;
      } else if (name.includes("roto-stick")) {
        // Honchkrow: dig for more TR Supporters in top 4 cards
        score = 55;
      } else if (name.includes("risky ruins") || name.includes("area zero") || name.includes("watchtower") || name.includes("team rocket's watchtower")) {
        // Watchtower: if opponent has Risky Ruins (damages our non-Darkness bench Pokémon),
        // play Watchtower immediately to replace it — this is the primary counter-play.
        const opponentHasRiskyRuins = getStadiumKind(state) === "risky_ruins";
        const isWatchtower = name.includes("watchtower") || name.includes("team rocket's watchtower");
        if (isWatchtower && opponentHasRiskyRuins) {
          score = 95; // Urgently replace Risky Ruins — it's destroying our bench Pokémon
        } else if (isWatchtower) {
          // Watchtower disables non-Rule Box Colorless abilities (Dudunsparce Run Away Draw, etc.)
          // Score high if opponent has Dudunsparce or similar Colorless ability Pokémon on bench.
          const opponentHasDudunsparce = opponent.bench.some((p) => {
            const pName = (getDefinition(state, p.definitionId)?.name ?? "").toLowerCase();
            return pName.includes("dudunsparce") || pName.includes("fan rotom") || pName.includes("manaphy");
          });
          score = opponentHasDudunsparce ? 75 : 30;
        } else {
          score = 30;
        }
      } else if (!supporter) {
        score = 14;
      }

      // Apply archetype-specific bonus from strategy knowledge
      if (ctx) {
        score += getArchetypeTrainerBonus(ctx.archetype, name);
      }

      // Deck-out awareness — see deckOutAwareness.ts.
      score = applyDeckOutTrainerPenalty(score, name, player.deck.length);

      // Alakazam: once the hand is Powerful-Hand-lethal (20 × cards in hand ≥
      // opponent Active HP), deck-draining trainers add nothing — conserve the
      // deck instead (deck-out was Alakazam's #1 self-play loss cause).
      if (
        ctx?.archetype === "alakazam" &&
        opponent.active &&
        player.hand.length >= 7 &&
        player.hand.length * 20 >= remainingHp(state, opponent.active) &&
        isDeckDrainingTrainerName(name)
      ) {
        score = Math.min(score, 5);
      }

      return { action, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  recordTrace(
    trace,
    scored.map((s) => ({
      label: getDefinition(state, player.hand.find((c) => c.instanceId === s.action.instanceId)?.definitionId ?? "")?.name ?? "?",
      score: s.score,
    })),
  );

  return scored[0]?.action ?? null;
}

/**
 * Pick the best card from deck search options.
 * Priority: Stage 2 attacker > Stage 1 evolution > Basic ex/V > draw supporter > item > basic energy
 */
function pickBestSearchDeckCard(
  state: EngineState,
  playerId: PlayerId,
  options: string[],
  ctx?: StrategyContext,
): string {
  const player = getPlayer(state, playerId);
  const inPlayDefNames = [
    ...(player.active ? [getDefinition(state, player.active.definitionId)?.name?.toLowerCase() ?? ""] : []),
    ...player.bench.map((p) => getDefinition(state, p.definitionId)?.name?.toLowerCase() ?? ""),
  ];
  const inPlayNames = new Set(inPlayDefNames);
  // How many copies of each Pokémon (by name) are already in play, and which
  // pre-evolutions we hold in hand — used for diminishing-returns and
  // evolution-readiness scoring below.
  const inPlayCounts = new Map<string, number>();
  for (const n of inPlayDefNames) inPlayCounts.set(n, (inPlayCounts.get(n) ?? 0) + 1);
  const handNames = new Set(
    player.hand.map((c) => getDefinition(state, c.definitionId)?.name?.toLowerCase() ?? ""),
  );

  const scored = options.map((instanceId) => {
    const card = player.deck.find((c) => c.instanceId === instanceId);
    if (!card) return { instanceId, score: 0 };
    const def = getDefinition(state, card.definitionId);
    if (!def) return { instanceId, score: 0 };
    const name = def.name.toLowerCase();

    let score = 10;
    if (def.supertype === "Pokémon") {
      if (isStage2(def)) score = 90;
      else if (def.subtypes.includes("Stage 1")) score = 80;
      else if (name.includes(" ex") || def.subtypes.includes("ex")) score = 75;
      else if (isBasicPokemon(def)) score = 60;

      // Evolution readiness: an Evolution Pokémon is only useful if we can
      // actually put it into play. Strongly prefer one whose pre-evolution is
      // already in play (e.g. Dudunsparce when Dunsparce is benched); penalise
      // one we can't deploy (e.g. searching a 3rd Mega Lopunny ex with no
      // Buneary in play or hand).
      if (def.evolvesFrom) {
        const pre = def.evolvesFrom.toLowerCase();
        if (inPlayNames.has(pre)) score += 30;
        else if (handNames.has(pre)) score += 8;
        else score -= 25;
      }

      // Diminishing returns: a 2nd copy of an attacker is fine, but don't keep
      // grabbing copies of something we already have multiples of in play
      // (e.g. a 3rd Mega Lopunny ex when 2 are already down).
      const copies = inPlayCounts.get(name) ?? 0;
      score -= 20 * Math.max(0, copies - 1);
      // Archetype-aware: boost key attacker lines
      if (ctx) {
        score += getArchetypeSearchPriority(ctx.archetype, name);
        // Additional deck-specific search bonuses:
        // Dragapult-Dusknoir: Dusknoir chain is critical for secondary win condition
        if (ctx.archetype === "dragapult-dusknoir" && (name.includes("dusknoir") || name.includes("dusclops") || name.includes("duskull"))) score += 20;
        // Greninja: Dusknoir chain gives precision damage placement
        if (ctx.archetype === "greninja" && (name.includes("dusknoir") || name.includes("dusclops") || name.includes("duskull"))) score += 20;
        // Hydrapple: Meganium is the engine — highest priority to find
        if (ctx.archetype === "hydrapple" && (name.includes("meganium") || name.includes("bayleef") || name.includes("chikorita"))) score += 25;
        // Garchomp: Roserade supporter-lock is game-deciding
        if (ctx.archetype === "garchomp" && (name.includes("roserade") || name.includes("roselia"))) score += 20;
        // Zoroark: Always want N's Zekrom (Rampaging Thunder 250) on bench for Night Joker
        if (ctx.archetype === "zoroark" && name.includes("n's zekrom")) score += 30;
        // Honchkrow: TR Murkrow and TR Porygon fill bench for Ariana draw engine
        if (ctx.archetype === "honchkrow" && (name.includes("team rocket's murkrow") || name.includes("team rocket's porygon"))) score += 15;
        // Alakazam: evolution line is the win condition — Alakazam >> Kadabra >> Abra >> Dudunsparce
        if (ctx.archetype === "alakazam" && name.includes("alakazam")) score += 40;
        if (ctx.archetype === "alakazam" && name.includes("kadabra")) score += 25;
        if (ctx.archetype === "alakazam" && name.includes("abra")) score += 10;
        if (ctx.archetype === "alakazam" && (name.includes("dudunsparce") || name.includes("dunsparce"))) score += 15;
      }
    } else if (def.supertype === "Trainer") {
      if (isSupporter(def)) {
        if (name.includes("iono") || name.includes("professor") || name.includes("lillie") || name.includes("hilda") || name.includes("wally")) score = 50;
        else score = 40;
      } else {
        score = 30;
      }
    } else if (def.supertype === "Energy") {
      score = 15;
    }
    return { instanceId, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.instanceId ?? options[0]!;
}

function tryResolveAutoPending(state: EngineState, ctx?: StrategyContext): EngineState | null {
  const pending = state.pendingAction;
  if (!pending) return null;
  const playerId = pending.playerId;

  switch (pending.type) {
    case "DISCARD_BASIC_ENERGY_FOR_DAMAGE":
      // SKIP_OPTIONAL correctly routes through finishDiscardEnergyForAttack
      // which handles removal of attached energies for attacks like Mirage Barrage.
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "DISCARD_NAMED_SUPPORTERS_FOR_DAMAGE": {
      // Rocket Feathers: discard ALL TR Supporters from hand for 60 damage each.
      const player = getPlayer(state, playerId);
      const discardable = player.hand.find((card) => {
        const def = getDefinition(state, card.definitionId);
        return def && isSupporter(def) && def.name.toLowerCase().includes(pending.nameFilter.toLowerCase());
      });
      if (discardable) {
        return gameReducer(state, {
          type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK",
          playerId,
          instanceId: discardable.instanceId,
        });
      }
      // No more matching Supporters — finish the attack
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    }
    case "CHOOSE_OPPONENT_POKEMON_DAMAGE": {
      if (pending.options.length === 0) return null;
      // Pick best target: prefer KO'd by this damage, then most damaged (closest to KO).
      // pending.amount is already the DAMAGE (e.g. Cursed Blast = 130), not a counter
      // count — do NOT multiply by 10 again.
      const damage = pending.amount ?? 130;
      const opponent = getPlayer(state, getOpponentId(playerId));
      const allOppInPlay = [...(opponent.active ? [opponent.active] : []), ...opponent.bench];
      const validTargets = allOppInPlay.filter((p) => pending.options.includes(p.instanceId));
      const bestTarget = validTargets.sort((a, b) => {
        const aHp = remainingHp(state, a);
        const bHp = remainingHp(state, b);
        const aKo = aHp <= damage ? 1 : 0;
        const bKo = bHp <= damage ? 1 : 0;
        if (aKo !== bKo) return bKo - aKo; // prefer KO
        return aHp - bHp; // else target most damaged (lowest remaining HP)
      })[0];
      return gameReducer(state, {
        type: "CHOOSE_OPPONENT_POKEMON_DAMAGE_TARGET",
        playerId,
        targetId: bestTarget?.instanceId ?? pending.options[0]!,
      });
    }
    case "CHOOSE_BENCH_DAMAGE": {
      if (pending.options.length === 0) return null;
      // Smart targeting: prefer bench Pokémon with lowest remaining HP (set up future KOs)
      const oppBench = getPlayer(state, getOpponentId(playerId)).bench;
      const bestBenchTarget = oppBench
        .filter((p) => pending.options.includes(p.instanceId))
        .sort((a, b) => remainingHp(state, a) - remainingHp(state, b))[0];
      return gameReducer(state, {
        type: "CHOOSE_BENCH_DAMAGE_TARGET",
        playerId,
        targetId: bestBenchTarget?.instanceId ?? pending.options[0]!,
      });
    }
    case "SWITCH_WITH_BENCH": {
      const player = getPlayer(state, playerId);
      if (pending.optional) {
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      if (!player.bench.length) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      // Pick best bench Pokémon to promote: prefer energized attackers, then archetype primary
      const bestBench = [...player.bench].sort((a, b) => {
        const aDef = getDefinition(state, a.definitionId);
        const bDef = getDefinition(state, b.definitionId);
        const aName = aDef?.name?.toLowerCase() ?? "";
        const bName = bDef?.name?.toLowerCase() ?? "";
        // 1. Archetype priority (primary attacker first)
        const aArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aArchPrio !== bArchPrio) return bArchPrio - aArchPrio;
        // 2. Tie-break: more energy attached (closer to attacking)
        return b.attachedEnergy.length - a.attachedEnergy.length;
      })[0];
      return gameReducer(state, {
        type: "SWITCH_WITH_BENCH",
        playerId,
        benchInstanceId: bestBench!.instanceId,
      });
    }
    case "DRAW_UNTIL_HAND":
      return gameReducer(state, { type: "CONFIRM_DRAW_UNTIL_HAND", playerId });
    case "SEARCH_DECK":
      if (pending.filter === "MEGA_EVOLUTION_EX_HAND" || pending.filter === "SALVATORE_EVOLUTION") {
        if (pending.options.length > 0) {
          return gameReducer(state, {
            type: "PICK_DECK_CARD",
            playerId,
            instanceId: pending.options[0]!,
          });
        }
        return null;
      }
      // NOTE: do NOT skip multi-slot searches (slotsRemaining > 1).
      // Buddy-Buddy Poffin / Proton etc. create a new SEARCH_DECK(slotsRemaining-1) after each pick.
      // Skipping here ends the ENTIRE search early (0 picks instead of 2).
      if (pending.options.length > 0) {
        // Pick best card: prefer evolutions/attackers over basic energy/items
        const bestSearchCard = pickBestSearchDeckCard(state, playerId, pending.options, ctx);
        return gameReducer(state, {
          type: "PICK_DECK_CARD",
          playerId,
          instanceId: bestSearchCard,
        });
      }
      return null;
    case "BOSS_ORDERS": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      if (!opponent.bench.length) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      // SWITCH_OPPONENT_ACTIVE requires opponent.active !== null (engine guard at reducer line 699).
      // If opponent has no active (e.g. Dudunsparce just shuffled itself to deck via Run Away Draw),
      // skip Boss's Orders — the switch can't legally complete, causing a stall.
      if (!opponent.active) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      // Estimate our active Pokémon's best attack damage for KO evaluation
      const selfPlayer = getPlayer(state, playerId);
      const selfActiveDef = selfPlayer.active ? getDefinition(state, selfPlayer.active.definitionId) : undefined;
      const ourMaxDmg = (selfActiveDef?.attacks ?? []).reduce((best, atk) => {
        const est = estimateAttackDamage(state, playerId, atk.name, atk.damage);
        return Math.max(best, est);
      }, 0);
      // Target scoring: KO target > archetype priority > lowest HP
      const target = [...opponent.bench].sort((a, b) => {
        const aDef = getDefinition(state, a.definitionId);
        const bDef = getDefinition(state, b.definitionId);
        const aNameLower = aDef?.name?.toLowerCase() ?? "";
        const bNameLower = bDef?.name?.toLowerCase() ?? "";
        const aArchPrio = ctx ? getArchetypeBossPriority(ctx.archetype, aNameLower) : 0;
        const bArchPrio = ctx ? getArchetypeBossPriority(ctx.archetype, bNameLower) : 0;
        const aHp = remainingHp(state, a);
        const bHp = remainingHp(state, b);
        const aKo = ourMaxDmg > 0 && aHp <= ourMaxDmg ? 1 : 0;
        const bKo = ourMaxDmg > 0 && bHp <= ourMaxDmg ? 1 : 0;
        // 1. KO target first; 2. archetype priority; 3. lowest remaining HP
        if (aKo !== bKo) return bKo - aKo;
        if (aArchPrio !== bArchPrio) return bArchPrio - aArchPrio;
        return aHp - bHp;
      })[0];
      if (!target) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, {
        type: "SWITCH_OPPONENT_ACTIVE",
        playerId,
        benchInstanceId: target.instanceId,
      });
    }
    case "ULTRA_BALL_DISCARD": {
      const player = getPlayer(state, playerId);
      const discardCandidates = player.hand.filter(
        (card) => !pending.selectedIds.includes(card.instanceId),
      );
      if (discardCandidates.length === 0) return null;
      // Build set of names to protect from discard based on archetype strategy.
      // Keep: cards in ultraBallKeep list AND archetype-specific "ammo" cards.
      const keepSet = new Set(ctx ? ctx.profile.ultraBallKeep.map((s) => s.toLowerCase()) : []);
      // Honchkrow: TR Supporters are ammo for Rocket Feathers — never discard them
      const isHonchkrow = ctx?.archetype === "honchkrow";
      // Prefer discarding: Energy > duplicate Basics > Supporters > Items > key Pokémon
      const scoredCandidates = discardCandidates.map((card) => {
        const def = getDefinition(state, card.definitionId);
        if (!def) return { card, score: 50 };
        const nameLower = def.name.toLowerCase();
        // Never discard protected cards
        if (keepSet.has(nameLower) || keepSet.size > 0 && [...keepSet].some((k) => nameLower.includes(k))) {
          return { card, score: -10 };
        }
        if (def.supertype === "Energy") return { card, score: 90 }; // discard energy first
        if (def.supertype === "Pokémon" && isBasicPokemon(def)) return { card, score: 70 };
        if (def.supertype === "Trainer" && isSupporter(def)) {
          // Honchkrow keeps TR Supporters as Rocket Feathers ammo
          if (isHonchkrow && nameLower.includes("team rocket's")) return { card, score: -5 };
          return { card, score: 60 };
        }
        if (def.supertype === "Trainer") return { card, score: 40 };
        return { card, score: 30 };
      }).sort((a, b) => b.score - a.score);
      return gameReducer(state, {
        type: "SELECT_HAND_DISCARD",
        playerId,
        instanceId: scoredCandidates[0]!.card.instanceId,
      });
    }
    case "RARE_CANDY": {
      const player = getPlayer(state, playerId);
      const allInPlay = [
        ...(player.active ? [player.active] : []),
        ...player.bench,
      ];
      const validBasic = allInPlay.find((mon) => {
        const monDef = getDefinitionSafe(state, mon.definitionId);
        if (!isBasicPokemon(monDef) || mon.enteredPlayTurn === state.turnNumber) return false;
        return player.hand.some((card) => {
          const cardDef = getDefinitionSafe(state, card.definitionId);
          return isStage2(cardDef) && canRareCandyEvolveInto(state, monDef, cardDef);
        });
      });
      if (!validBasic) return null;
      return gameReducer(state, {
        type: "SELECT_RARE_CANDY_BASIC",
        playerId,
        targetId: validBasic.instanceId,
      });
    }
    case "CRISPIN_ATTACH": {
      const player = getPlayer(state, playerId);
      if (pending.targets.length === 0) return null;
      // Pick the best energy target: prefer primary attacker (by archetype), then one-away from attacking
      const allOwn = [...(player.active ? [player.active] : []), ...player.bench];
      const bestCrispin = [...pending.targets].sort((a, b) => {
        const aMon = allOwn.find((p) => p.instanceId === a);
        const bMon = allOwn.find((p) => p.instanceId === b);
        const aDef = aMon ? getDefinition(state, aMon.definitionId) : undefined;
        const bDef = bMon ? getDefinition(state, bMon.definitionId) : undefined;
        const aName = aDef?.name?.toLowerCase() ?? "";
        const bName = bDef?.name?.toLowerCase() ?? "";
        const aArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aArchPrio !== bArchPrio) return bArchPrio - aArchPrio;
        // Tie-break: Pokémon already with some energy (closer to attacking)
        const aEnergy = aMon?.attachedEnergy.length ?? 0;
        const bEnergy = bMon?.attachedEnergy.length ?? 0;
        return bEnergy - aEnergy;
      })[0];
      return gameReducer(state, {
        type: "SELECT_CRISPIN_TARGET",
        playerId,
        pokemonId: bestCrispin ?? pending.targets[0]!,
      });
    }
    case "CRISPIN_DISCARD":
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "ERI_DISCARD":
    case "JANINE_DARKNESS":
    case "GLASS_TRUMPET":
      return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
    case "BIANCA_HEAL": {
      const player = getPlayer(state, playerId);
      const targetId =
        pending.options[0] ?? player.active?.instanceId ?? player.bench[0]?.instanceId;
      if (!targetId) return null;
      return gameReducer(state, {
        type: "SELECT_BIANCA_HEAL",
        playerId,
        pokemonId: targetId,
      });
    }
    case "EXPLORERS_GUIDANCE": {
      const player = getPlayer(state, playerId);
      const pick = pending.revealPool.find(
        (id) =>
          !pending.pickedIds.includes(id) &&
          player.deck.some((entry) => entry.instanceId === id),
      );
      if (!pick) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pick });
    }
    case "MORTY_DISCARD": {
      const player = getPlayer(state, playerId);
      const card = player.hand[0];
      if (!card) return null;
      return gameReducer(state, {
        type: "SELECT_MORTY_DISCARD",
        playerId,
        instanceId: card.instanceId,
      });
    }
    case "SALVATORE_EVOLVE": {
      const targetId = pending.options[0];
      if (!targetId) return null;
      return gameReducer(state, {
        type: "SELECT_SALVATORE_EVOLVE",
        playerId,
        targetId,
      });
    }
    case "PERRIN":
      if (pending.step === "HAND") {
        const pick = pending.options.find((id) => !pending.pickedIds.includes(id));
        if (pick) {
          return gameReducer(state, { type: "SELECT_PERRIN_HAND", playerId, instanceId: pick });
        }
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      if (pending.step === "SEARCH") {
        const pick = pending.options.find((id) => !pending.pickedIds.includes(id));
        if (pick) {
          return gameReducer(state, { type: "SELECT_PERRIN_SEARCH", playerId, instanceId: pick });
        }
        return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      }
      return null;
    case "PICK_DISCARD": {
      if (pending.options.length === 0) return null;
      // Pick the most valuable Pokémon from the discard pile options
      const pdPlayer = getPlayer(state, playerId);
      const bestPdOption = pending.options.slice().sort((a, b) => {
        // Options are instance IDs; find them in the discard pile
        const aCard = pdPlayer.discard.find((c) => c.instanceId === a);
        const bCard = pdPlayer.discard.find((c) => c.instanceId === b);
        const aDef = aCard ? getDefinitionSafe(state, aCard.definitionId) : undefined;
        const bDef = bCard ? getDefinitionSafe(state, bCard.definitionId) : undefined;
        const aName = aDef?.name?.toLowerCase() ?? "";
        const bName = bDef?.name?.toLowerCase() ?? "";
        const aPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        return bPrio - aPrio; // highest priority first
      })[0]!;
      return gameReducer(state, {
        type: "PICK_DISCARD_POKEMON",
        playerId,
        instanceId: bestPdOption,
      });
    }
    case "ATTACH_HAND_ENERGY": {
      // energyId is pre-selected by the engine; pick the best target Pokémon
      const { energyId, targetIds } = pending;
      if (!energyId || targetIds.length === 0) return null;
      const player = getPlayer(state, playerId);
      const allOwn = [...(player.active ? [player.active] : []), ...player.bench];
      // Pick target that needs energy most (fewest attached, prefer primary attacker)
      const bestTarget = targetIds.reduce((best, id) => {
        const p = allOwn.find((m) => m.instanceId === id);
        const bestP = allOwn.find((m) => m.instanceId === best);
        if (!p || !bestP) return best;
        const pDef = getDefinition(state, p.definitionId);
        const bestDef = getDefinition(state, bestP.definitionId);
        const pName = pDef?.name?.toLowerCase() ?? "";
        const bestName = bestDef?.name?.toLowerCase() ?? "";
        const pArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, pName) : 0;
        const bestArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bestName) : 0;
        if (pArchPrio !== bestArchPrio) return pArchPrio > bestArchPrio ? id : best;
        // Tie-break: fewer energy attached = needs it more
        return p.attachedEnergy.length <= bestP.attachedEnergy.length ? id : best;
      }, targetIds[0]!);
      return gameReducer(state, {
        type: "ATTACH_HAND_ENERGY_TO_POKEMON",
        playerId,
        pokemonId: bestTarget,
        energyId,
      });
    }
    case "PROMOTE": {
      const promotePlayer = getPlayer(state, playerId);
      if (promotePlayer.bench.length === 0) {
        const finished = { ...state, pendingAction: null };
        finished.winnerId = getOpponentId(playerId);
        finished.phase = GamePhase.Finished;
        return finished;
      }
      // Smart selection: prefer primary archetype attackers, then most energy attached, then highest remaining HP
      const bestPromote = promotePlayer.bench.slice().sort((a, b) => {
        const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
        const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
        const aPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aPrio !== bPrio) return bPrio - aPrio;
        // Tie-break: more energy = ready to attack sooner
        if (a.attachedEnergy.length !== b.attachedEnergy.length) return b.attachedEnergy.length - a.attachedEnergy.length;
        // Tie-break: higher HP = safer to send out
        return remainingHp(state, b) - remainingHp(state, a);
      })[0]!;
      return gameReducer(state, {
        type: "PROMOTE_BENCH",
        playerId,
        instanceId: bestPromote.instanceId,
      });
    }
    case "DAMAGE_TWO_OPPONENT": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const candidates = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].filter((pokemon) => !pending.pickedIds.includes(pokemon.instanceId));
      if (candidates.length === 0) return null;
      // Prefer targets closest to KO (lowest remaining HP), then boss-priority targets
      const bestDmgTarget = candidates.slice().sort((a, b) => {
        const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
        const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
        const aBoss = ctx ? getArchetypeBossPriority(ctx.archetype, aName) : 0;
        const bBoss = ctx ? getArchetypeBossPriority(ctx.archetype, bName) : 0;
        const aHp = remainingHp(state, a);
        const bHp = remainingHp(state, b);
        // Tie-break order: lowest HP first (soften KO targets), then boss priority
        if (aHp !== bHp) return aHp - bHp;
        return bBoss - aBoss;
      })[0]!;
      return gameReducer(state, {
        type: "CHOOSE_OPPONENT_DAMAGE",
        playerId,
        targetId: bestDmgTarget.instanceId,
      });
    }
    case "IONO_HAND_BOTTOM": {
      const ioPlayer = getPlayer(state, playerId);
      if (ioPlayer.hand.length === 0) return null;
      // Discard the card with the lowest keep-value (put it to the bottom of the deck)
      const handEnergyCount = ioPlayer.hand.filter((c) => {
        const d = getDefinitionSafe(state, c.definitionId);
        return d?.supertype === "Energy";
      }).length;
      const ioScored = ioPlayer.hand.map((card) => {
        const def = getDefinitionSafe(state, card.definitionId);
        const name = def?.name?.toLowerCase() ?? "";
        const supertype = def?.supertype ?? "";
        let score = 50;
        if (supertype === "Pokémon") {
          // Primary attackers are most valuable to keep; bench filler less so
          const archPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, name) : 0;
          score = 10 + archPrio; // e.g. 10 for unknown, 110 for primary attacker
        } else if (supertype === "Energy") {
          // Excess energy is cheap to lose; but keep at least one for attachment
          score = handEnergyCount > 2 ? 15 : 35;
        } else {
          // Trainers: key supporters & search items are critical
          if (name.includes("professor's research") || name.includes("iono")) score = 95;
          else if (name.includes("boss's orders") || name.includes("prime catcher")) score = 85;
          else if (name.includes("rare candy") || name.includes("ultra ball") || name.includes("nest ball")) score = 70;
          else score = 50;
        }
        return { instanceId: card.instanceId, score };
      });
      // Put the lowest-scored card on the bottom of the deck
      const worst = ioScored.sort((a, b) => a.score - b.score)[0]!;
      return gameReducer(state, { type: "IONO_SELECT_HAND", playerId, instanceId: worst.instanceId });
    }
    case "MOVE_ENERGY_TO_BENCH": {
      const mebPlayer = getPlayer(state, playerId);
      if (mebPlayer.bench.length === 0) return null;
      // Pick bench Pokémon that needs energy most: highest archetype priority, fewest energy attached
      const bestMebTarget = mebPlayer.bench.slice().sort((a, b) => {
        const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
        const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
        const aPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aPrio !== bPrio) return bPrio - aPrio;
        return a.attachedEnergy.length - b.attachedEnergy.length; // fewer energy = needs it more
      })[0]!;
      return gameReducer(state, { type: "MOVE_ENERGY_TO_BENCH", playerId, benchInstanceId: bestMebTarget.instanceId });
    }
    case "SEARCH_EVOLUTION": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "SWITCH_TYPED_BENCH": {
      if (pending.options.length === 0) return null;
      // Pick the best pivot target, not just options[0]: prefer the
      // archetype's primary attacker, with energy, and (Mochi-pivot combo) a
      // Binding Mochi holder — the incoming Pokémon gets Poisoned, which is
      // exactly what switches the Mochi's +40 on.
      const swPlayer = getPlayer(state, playerId);
      const bestSwitch = pending.options
        .map((id) => {
          const mon = swPlayer.bench.find((p) => p.instanceId === id);
          const name = mon
            ? getDefinition(state, mon.definitionId)?.name?.toLowerCase() ?? ""
            : "";
          let score = 0;
          if (ctx) score += getArchetypeEnergyPriority(ctx.archetype, name);
          if (mon && mon.attachedEnergy.length > 0) score += 30;
          if (mon && holdsBindingMochi(state, mon)) score += 40;
          return { id, score };
        })
        .sort((a, b) => b.score - a.score)[0]!;
      return gameReducer(state, { type: "SWITCH_WITH_BENCH", playerId, benchInstanceId: bestSwitch.id });
    }
    case "ENERGY_SWITCH": {
      if (pending.options.length === 0) return null;
      const esPlayer = getPlayer(state, playerId);
      const allEsMons = [...(esPlayer.active ? [esPlayer.active] : []), ...esPlayer.bench];

      if (pending.step === "SOURCE") {
        // Take energy FROM the Pokémon least in need of it right now
        const scored = pending.options
          .map((id) => {
            const mon = allEsMons.find((p) => p.instanceId === id);
            const def = mon ? getDefinition(state, mon.definitionId) : undefined;
            const name = def?.name?.toLowerCase() ?? "";
            let score = 0;
            // Ogerpon: Teal Mask generates energy — happy to donate to main attacker
            if (name.includes("teal mask ogerpon")) score = 80;
            // Bench Pokémon that already has excess energy
            if (mon && mon.attachedEnergy.length >= 3) score = Math.max(score, 60);
            // Don't strip the active attacker
            if (esPlayer.active?.instanceId === id) score -= 30;
            return { id, score };
          })
          .sort((a, b) => b.score - a.score);
        return gameReducer(state, { type: "SELECT_ENERGY_SWITCH_POKEMON", playerId, pokemonId: scored[0]?.id ?? pending.options[0]! });
      } else {
        // Move energy TO the Pokémon that needs it most (about to attack)
        const scored = pending.options
          .map((id) => {
            const mon = allEsMons.find((p) => p.instanceId === id);
            const def = mon ? getDefinition(state, mon.definitionId) : undefined;
            const name = def?.name?.toLowerCase() ?? "";
            let score = 0;
            // Active attacker is top priority
            if (esPlayer.active?.instanceId === id) score = 50;
            // Archetype-preferred attackers get bonus
            if (ctx) score += getArchetypeEnergyPriority(ctx.archetype, name);
            // Ogerpon: Wellspring / Lillie's Clefairy / Kangaskhan are primary attackers
            if (name.includes("wellspring")) score = Math.max(score, 90);
            if (name.includes("lillie's clefairy")) score = Math.max(score, 85);
            if (name.includes("mega kangaskhan")) score = Math.max(score, 75);
            return { id, score };
          })
          .sort((a, b) => b.score - a.score);
        return gameReducer(state, { type: "SELECT_ENERGY_SWITCH_POKEMON", playerId, pokemonId: scored[0]?.id ?? pending.options[0]! });
      }
    }
    case "ENHANCED_HAMMER": {
      if (pending.step === "POKEMON") {
        const opponent = getPlayer(state, getOpponentId(playerId));
        const mon = [
          ...(opponent.active ? [opponent.active] : []),
          ...opponent.bench,
        ].find((p) => p.attachedEnergy.length > 0);
        if (!mon) return null;
        return gameReducer(state, { type: "SELECT_ENHANCED_HAMMER_POKEMON", playerId, pokemonId: mon.instanceId });
      }
      if (pending.options.length === 0) return null;
      const opt = pending.options[0]!;
      return gameReducer(state, { type: "DISCARD_OPPONENT_ENERGY", playerId, pokemonId: opt.pokemonId, energyId: opt.energyId });
    }
    case "WALLYS_COMPASSION": {
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      // Prefer healing the most-damaged Mega Lopunny ex on the bench/active
      const player = getPlayer(state, playerId);
      const allPokemon = [...(player.active ? [player.active] : []), ...player.bench];
      const bestHealTarget = pending.options
        .map((id) => {
          const mon = allPokemon.find((p) => p.instanceId === id);
          if (!mon) return { id, score: 0 };
          const def = getDefinition(state, mon.definitionId);
          const isLopunny = def?.name?.toLowerCase().includes("mega lopunny") ?? false;
          const dmg = mon.damageCounters;
          return { id, score: (isLopunny ? 1000 : 0) + dmg };
        })
        .sort((a, b) => b.score - a.score)[0];
      return gameReducer(state, {
        type: "SELECT_WALLYS_POKEMON",
        playerId,
        pokemonId: bestHealTarget?.id ?? pending.options[0]!,
      });
    }
    case "HILDA": {
      if (pending.options.length === 0) return null;
      // Hilda searches top 5 cards and picks up to 2. Use smart card selection.
      const hildaBest = pickBestSearchDeckCard(state, playerId, pending.options, ctx);
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: hildaBest });
    }
    case "DAWN":
    case "COLRESS":
    case "RECON_DIRECTIVE": {
      if (pending.options.length === 0) return null;
      // Use smart selection — pick the card that's most valuable from the top 2
      const bestRDCard = pickBestSearchDeckCard(state, playerId, pending.options, ctx);
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: bestRDCard });
    }
    case "GIOVANNI": {
      if (pending.options.length === 0) return null;

      // OPPONENT_BENCH edge case: resolveGiovanniOpponentBench has a guard
      // `if (!opponent.active) return;` that returns WITHOUT clearing pendingAction.
      // If opponent's active is null (e.g. just shuffled itself to deck via Run Away Draw),
      // skip by manually clearing the pending state — the switch can't complete anyway.
      if (pending.step === "OPPONENT_BENCH") {
        const giovanniOpponent = getPlayer(state, getOpponentId(playerId));
        if (!giovanniOpponent.active) {
          return { ...state, pendingAction: null };
        }
        // Smart target: archetype boss-priority > lowest HP (same logic as BOSS_ORDERS)
        const oppBench = giovanniOpponent.bench.filter((p) => pending.options.includes(p.instanceId));
        const bestOpp = oppBench.sort((a, b) => {
          const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
          const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
          const aPrio = ctx ? getArchetypeBossPriority(ctx.archetype, aName) : 0;
          const bPrio = ctx ? getArchetypeBossPriority(ctx.archetype, bName) : 0;
          const aHp = remainingHp(state, a);
          const bHp = remainingHp(state, b);
          if (aPrio !== bPrio) return bPrio - aPrio;
          return aHp - bHp; // lowest HP first = weakest target
        })[0];
        return gameReducer(state, {
          type: "SELECT_GIOVANNI_BENCH",
          playerId,
          benchInstanceId: bestOpp?.instanceId ?? pending.options[0]!,
        });
      }

      // OWN_BENCH: bring up the best attacker (primary archetype Pokémon with energy)
      const ownPlayer = getPlayer(state, playerId);
      const ownBench = ownPlayer.bench.filter((p) => pending.options.includes(p.instanceId));
      const bestOwn = ownBench.sort((a, b) => {
        const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
        const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
        const aPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aPrio !== bPrio) return bPrio - aPrio;
        return b.attachedEnergy.length - a.attachedEnergy.length;
      })[0];
      return gameReducer(state, {
        type: "SELECT_GIOVANNI_BENCH",
        playerId,
        benchInstanceId: bestOwn?.instanceId ?? pending.options[0]!,
      });
    }
    case "PRIME_CATCHER": {
      if (pending.options.length === 0) return null;
      if (pending.step === "OPPONENT_BENCH") {
        // Pull out the opponent's most threatening or lowest-HP bench Pokémon
        const pcOpponent = getPlayer(state, getOpponentId(playerId));
        const pcOppBench = pcOpponent.bench.filter((p) => pending.options.includes(p.instanceId));
        const bestPcOpp = pcOppBench.slice().sort((a, b) => {
          const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
          const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
          const aBoss = ctx ? getArchetypeBossPriority(ctx.archetype, aName) : 0;
          const bBoss = ctx ? getArchetypeBossPriority(ctx.archetype, bName) : 0;
          if (aBoss !== bBoss) return bBoss - aBoss; // higher boss priority first
          return remainingHp(state, a) - remainingHp(state, b); // then lowest HP
        })[0];
        return gameReducer(state, {
          type: "SELECT_PRIME_CATCHER_BENCH",
          playerId,
          benchInstanceId: bestPcOpp?.instanceId ?? pending.options[0]!,
        });
      }
      // OWN_BENCH step: bring up the best attacker from our bench
      const pcPlayer = getPlayer(state, playerId);
      const pcOwnBench = pcPlayer.bench.filter((p) => pending.options.includes(p.instanceId));
      const bestPcOwn = pcOwnBench.slice().sort((a, b) => {
        const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
        const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
        const aPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
        const bPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
        if (aPrio !== bPrio) return bPrio - aPrio;
        return b.attachedEnergy.length - a.attachedEnergy.length; // more energy = readier
      })[0];
      return gameReducer(state, {
        type: "SELECT_PRIME_CATCHER_BENCH",
        playerId,
        benchInstanceId: bestPcOwn?.instanceId ?? pending.options[0]!,
      });
    }
    case "N_PP_UP": {
      if (pending.options.length === 0) return null;
      if (pending.step === "ENERGY") {
        return gameReducer(state, { type: "SELECT_N_PP_UP_ENERGY", playerId, instanceId: pending.options[0]! });
      }
      return gameReducer(state, { type: "SELECT_N_PP_UP_TARGET", playerId, pokemonId: pending.options[0]! });
    }
    case "TOOL_SCRAPPER": {
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_TOOL_SCRAPPER", playerId, toolInstanceId: pending.options[0]! });
    }
    case "ROTO_STICK": {
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_ROTO_STICK", playerId, instanceId: remaining[0]! });
    }
    case "MIRACLE_HEADSET": {
      if (pending.pickedIds.length >= pending.maxPicks) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_MIRACLE_HEADSET", playerId, instanceId: remaining[0]! });
    }
    case "BUG_CATCHING_SET": {
      if (pending.pickedIds.length >= pending.maxPicks) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_BUG_CATCHING", playerId, instanceId: remaining[0]! });
    }
    case "SECRET_BOX": {
      if (pending.options.length === 0) return null;
      if (pending.step === "DISCARD") {
        return gameReducer(state, { type: "SELECT_SECRET_BOX_DISCARD", playerId, instanceId: pending.options[0]! });
      }
      return gameReducer(state, { type: "SELECT_SECRET_BOX_SEARCH", playerId, instanceId: pending.options[0]! });
    }
    case "CIPHERMANIAC": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_CIPHERMANIAC_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "FIGHTING_GONG": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SELECT_FIGHTING_GONG", playerId, instanceId: pending.options[0]! });
    }
    case "LANAS_AID": {
      if (pending.pickedIds.length >= 3) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !pending.pickedIds.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "PICK_DISCARD_POKEMON", playerId, instanceId: remaining[0]! });
    }
    case "BROCKS_SCOUTING": {
      if (pending.step === "MODE") {
        return gameReducer(state, { type: "SELECT_BROCK_MODE", playerId, mode: "basic" });
      }
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "ROSAS_ENCOURAGEMENT": {
      if (pending.step === "TARGET") {
        if (pending.options.length === 0) return null;
        return gameReducer(state, { type: "SELECT_ROSA_TARGET", playerId, pokemonId: pending.options[0]! });
      }
      const picked = pending.pickedEnergyIds ?? [];
      if (picked.length >= 2) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      const remaining = pending.options.filter((id) => !picked.includes(id));
      if (remaining.length === 0) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
      return gameReducer(state, { type: "SELECT_ROSA_ENERGY", playerId, instanceId: remaining[0]! });
    }
    case "SURFER": {
      if (pending.options.length === 0) return null;
      // Pick best bench Pokémon to promote: prefer energized primary attackers
      const surferPlayer = getPlayer(state, playerId);
      const bestSurferBench = [...surferPlayer.bench]
        .filter((p) => pending.options.includes(p.instanceId))
        .sort((a, b) => {
          const aName = getDefinition(state, a.definitionId)?.name?.toLowerCase() ?? "";
          const bName = getDefinition(state, b.definitionId)?.name?.toLowerCase() ?? "";
          const aArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, aName) : 0;
          const bArchPrio = ctx ? getArchetypeEnergyPriority(ctx.archetype, bName) : 0;
          if (aArchPrio !== bArchPrio) return bArchPrio - aArchPrio;
          return b.attachedEnergy.length - a.attachedEnergy.length;
        })[0];
      return gameReducer(state, {
        type: "SELECT_SURFER_BENCH",
        playerId,
        benchInstanceId: bestSurferBench?.instanceId ?? pending.options[0]!,
      });
    }
    case "GRAND_TREE": {
      if (pending.step === "BASIC") {
        if (pending.options.length === 0) return null;
        return gameReducer(state, { type: "SELECT_GRAND_TREE_BASIC", playerId, targetId: pending.options[0]! });
      }
      if (pending.step === "STAGE1") {
        if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_GRAND_TREE_STAGE2", playerId });
        return gameReducer(state, { type: "SELECT_GRAND_TREE_STAGE1", playerId, instanceId: pending.options[0]! });
      }
      if (pending.options.length === 0) return gameReducer(state, { type: "SKIP_GRAND_TREE_STAGE2", playerId });
      return gameReducer(state, { type: "SELECT_GRAND_TREE_STAGE2", playerId, instanceId: pending.options[0]! });
    }
    case "CRUSHING_HAMMER": {
      if (pending.options.length === 0) return null;
      // Discard the Energy whose removal hurts most (deny an attack / strip a
      // Special Energy off the active attacker), not just options[0].
      const opponent = getPlayer(state, getOpponentId(playerId));
      const oppActiveId = opponent.active?.instanceId;
      const oppMons = [...(opponent.active ? [opponent.active] : []), ...opponent.bench];
      const cOpt = pending.options
        .map((opt) => {
          const mon = oppMons.find((p) => p.instanceId === opt.pokemonId);
          const energy = mon?.attachedEnergy.find((e) => e.instanceId === opt.energyId);
          const score = mon && energy ? crushingHammerTargetScore(state, oppActiveId, mon, energy) : 0;
          return { opt, score };
        })
        .sort((a, b) => b.score - a.score)[0]!.opt;
      return gameReducer(state, { type: "DISCARD_OPPONENT_ENERGY", playerId, pokemonId: cOpt.pokemonId, energyId: cOpt.energyId });
    }
    case "DISTRIBUTE_BENCH_DAMAGE": {
      // Snowball: put bench damage on the Pokémon that's already closest to KO
      const opponent = getPlayer(state, getOpponentId(playerId));
      const bestBench = [...opponent.bench]
        .map((b) => {
          const def = getDefinition(state, b.definitionId);
          const maxHp = parseInt(def?.hp ?? "100", 10) || 100;
          return { b, pct: b.damageCounters / maxHp };
        })
        .sort((a, b) => b.pct - a.pct)[0];
      const target = bestBench?.b ?? opponent.bench[0];
      if (!target) return null;
      return gameReducer(state, { type: "ASSIGN_BENCH_DAMAGE", playerId, targetId: target.instanceId });
    }
    case "MOVE_DAMAGE": {
      if (pending.step === "SOURCE") {
        // Move damage AWAY from our most valuable Pokémon (main attacker / high-priority bench)
        const owner = getPlayer(state, playerId);
        const sourceMon = [...(owner.active ? [owner.active] : []), ...owner.bench]
          .filter((p) => p.damageCounters > 0)
          .map((p) => {
            const def = getDefinition(state, p.definitionId);
            const name = def?.name?.toLowerCase() ?? "";
            const isPrimary = ctx?.profile.primaryAttacker && name.includes(ctx.profile.primaryAttacker.toLowerCase());
            // Negative score for primary attacker (keep them healthy), positive for bench filler
            return { p, score: p.damageCounters - (isPrimary ? 1000 : 0) };
          })
          .sort((a, b) => b.score - a.score)[0];
        if (!sourceMon) return null;
        return gameReducer(state, { type: "MOVE_DAMAGE_SOURCE", playerId, sourceId: sourceMon.p.instanceId });
      }
      // TARGET: move damage TO opponent's Pokémon closest to KO threshold
      const targetPlayerId = pending.targetSide === "opponent" ? getOpponentId(playerId) : playerId;
      const targetPlayer = getPlayer(state, targetPlayerId);
      const allTargets = [...(targetPlayer.active ? [targetPlayer.active] : []), ...targetPlayer.bench];
      const bestTarget = allTargets
        .map((p) => {
          const def = getDefinition(state, p.definitionId);
          const maxHp = parseInt(def?.hp ?? "100", 10) || 100;
          const remaining = remainingHp(state, p);
          return { p, score: (maxHp - remaining) / maxHp }; // Most damaged = closest to KO
        })
        .sort((a, b) => b.score - a.score)[0];
      const targetMon = bestTarget?.p ?? targetPlayer.active ?? targetPlayer.bench[0];
      if (!targetMon) return null;
      return gameReducer(state, { type: "MOVE_DAMAGE_TARGET", playerId, targetId: targetMon.instanceId });
    }
    case "REDISTRIBUTE_OPPONENT_COUNTERS": {
      if (pending.step === "SOURCE") {
        // Dusknoir / Munkidori: take counters from opponent's least-important Pokémon
        const opponent = getPlayer(state, getOpponentId(playerId));
        const allOpponent = [...(opponent.active ? [opponent.active] : []), ...opponent.bench];
        const source = allOpponent
          .filter((p) => p.damageCounters > 0)
          .map((p) => {
            const def = getDefinition(state, p.definitionId);
            const remaining = remainingHp(state, p);
            // Prefer taking from Pokémon with most "excess" damage (already near KO — harvest overflow)
            // or from support Pokémon (low max HP = less important)
            const isEx = def?.subtypes?.includes("ex") || def?.subtypes?.includes("V");
            return { p, score: p.damageCounters + (isEx ? 0 : 50) - remaining };
          })
          .sort((a, b) => b.score - a.score)[0]?.p;
        if (!source) {
          if (pending.optional) return gameReducer(state, { type: "SKIP_OPTIONAL", playerId });
          return null;
        }
        return gameReducer(state, { type: "SELECT_REDISTRIBUTE_SOURCE", playerId, sourceId: source.instanceId });
      }
      // TARGET: pile counters onto opponent's Pokémon nearest to KO (consolidate for KO)
      const opponent = getPlayer(state, getOpponentId(playerId));
      const allOpponent = [...(opponent.active ? [opponent.active] : []), ...opponent.bench];
      const targetMon = allOpponent
        .filter((p) => p.instanceId !== pending.sourceId)
        .map((p) => {
          const def = getDefinition(state, p.definitionId);
          const maxHp = parseInt(def?.hp ?? "100", 10) || 100;
          const remaining = remainingHp(state, p);
          const isEx = def?.subtypes?.includes("ex") || def?.subtypes?.includes("V");
          // Priority: Pokémon within exactly 30 HP of KO (3 counters will finish it)
          const willKO = remaining <= 30 ? 100 : 0;
          return { p, score: willKO + p.damageCounters / maxHp + (isEx ? 0.5 : 0) };
        })
        .sort((a, b) => b.score - a.score)[0]?.p
        ?? allOpponent.find((p) => p.instanceId !== pending.sourceId);
      if (!targetMon) return null;
      return gameReducer(state, { type: "SELECT_REDISTRIBUTE_TARGET", playerId, targetId: targetMon.instanceId });
    }
    case "COPY_BENCH_ATTACK": {
      if (pending.options.length === 0) return null;
      const cbPlayer = getPlayer(state, playerId);
      const cbOpponent = getPlayer(state, getOpponentId(playerId));
      const cbOpponentHp = cbOpponent.active ? remainingHp(state, cbOpponent.active) : 9999;

      // Estimate effective damage for each copyable attack, mirroring estimateAttackDamage.
      function estimateCopiedDamage(
        opt: { benchPokemonId: string; attackName: string },
      ): number {
        const benchMon = cbPlayer.bench.find((p) => p.instanceId === opt.benchPokemonId);
        const benchDef = getDefinition(state, benchMon?.definitionId ?? "");
        const atk = benchDef?.attacks?.find((a) => a.name === opt.attackName);
        if (!atk) return 0;
        const raw = parseInt(atk.damage, 10) || 0;
        const atkLower = atk.name.toLowerCase();
        // Rampaging Thunder: 250 damage but Zoroark can't attack next turn —
        // penalise heavily unless it outright KOs the opponent.
        if (atkLower.includes("rampaging thunder")) {
          return raw >= cbOpponentHp ? raw : Math.round(raw * 0.55);
        }
        // Back Draft (30×): scales with energy in opponent's discard
        if (atkLower.includes("back draft")) {
          const energyInDiscard = cbOpponent.discard.filter(
            (c) => getDefinition(state, c.definitionId)?.supertype === "Energy",
          ).length;
          return (raw || 30) * Math.max(1, energyInDiscard);
        }
        // Powerful Rage (20×): "this Pokémon" when copied = N's Zoroark ex (the active attacker)
        if (atkLower.includes("powerful rage")) {
          return (raw || 20) * (cbPlayer.active?.damageCounters ?? 0);
        }
        // Triple Smash (120×): 3 coins → expected ~1.5 heads
        if (atkLower.includes("triple smash")) {
          return Math.round((raw || 120) * 1.5);
        }
        return raw;
      }

      const bestOpt = [...pending.options].sort((a, b) => {
        const aDmg = estimateCopiedDamage(a);
        const bDmg = estimateCopiedDamage(b);
        const aKo = aDmg >= cbOpponentHp && aDmg > 0 ? 1 : 0;
        const bKo = bDmg >= cbOpponentHp && bDmg > 0 ? 1 : 0;
        if (aKo !== bKo) return bKo - aKo; // prefer KO attack
        return bDmg - aDmg; // else pick highest estimated damage
      })[0]!;
      return gameReducer(state, {
        type: "CHOOSE_BENCH_ATTACK",
        playerId,
        benchPokemonId: bestOpt.benchPokemonId,
        attackName: bestOpt.attackName,
      });
    }
    case "ABILITY_DISCARD_HAND": {
      // Discard least valuable card (for Trade, N's Zoroark ex, etc.)
      const player = getPlayer(state, playerId);
      if (player.hand.length === 0) return null;
      const keepSet = new Set(ctx ? ctx.profile.ultraBallKeep.map((s) => s.toLowerCase()) : []);
      // Zoroark: additionally protect N's Zorua (sole source of Zoroark ex evolution)
      // and N's Zekrom (provides Rampaging Thunder 250 for Night Joker)
      if (ctx?.archetype === "zoroark") {
        keepSet.add("n's zorua");
        keepSet.add("n's zekrom");
      }
      // Track how many copies of each definition are in hand — prefer discarding extras
      const defCount = new Map<string, number>();
      for (const card of player.hand) {
        defCount.set(card.definitionId, (defCount.get(card.definitionId) ?? 0) + 1);
      }
      const worst = [...player.hand].sort((a, b) => {
        const aDef = getDefinition(state, a.definitionId);
        const bDef = getDefinition(state, b.definitionId);
        const aName = aDef?.name?.toLowerCase() ?? "";
        const bName = bDef?.name?.toLowerCase() ?? "";
        // 1. Never discard protected (key archetype) cards
        const aProtected = keepSet.size > 0 && [...keepSet].some((k) => aName.includes(k));
        const bProtected = keepSet.size > 0 && [...keepSet].some((k) => bName.includes(k));
        if (aProtected !== bProtected) return aProtected ? 1 : -1;
        // 2. Prefer discarding duplicate copies (excess in hand)
        const aExtra = (defCount.get(a.definitionId) ?? 1) > 1 ? 1 : 0;
        const bExtra = (defCount.get(b.definitionId) ?? 1) > 1 ? 1 : 0;
        if (aExtra !== bExtra) return bExtra - aExtra;
        // 3. Prefer discarding: Energy > Item > Basic Pokémon > Supporter
        const supertypeScore = (def: typeof aDef): number => {
          if (def?.supertype === "Energy") return 3;
          if (def?.supertype === "Trainer" && !isSupporter(def)) return 2;
          if (def?.supertype === "Pokémon") return 1;
          return 0; // Supporter — avoid discarding
        };
        return supertypeScore(bDef) - supertypeScore(aDef);
      })[0];
      if (!worst) return null;
      return gameReducer(state, { type: "SELECT_HAND_DISCARD", playerId, instanceId: worst.instanceId });
    }
    case "ABILITY_DISCARD_HAND_ENERGY": {
      // Discard a specific energy type from hand (e.g. Water for Mortal Shuriken)
      const player = getPlayer(state, playerId);
      const { energyType } = pending;
      const energy = player.hand.find((card) => {
        const d = getDefinition(state, card.definitionId);
        if (!d || d.supertype !== "Energy") return false;
        // Match by type array first, then name fallback
        return d.types?.some((t) => t.toLowerCase() === energyType.toLowerCase())
          ?? d.name.toLowerCase().includes(energyType.toLowerCase());
      }) ?? player.hand.find((card) => getDefinition(state, card.definitionId)?.supertype === "Energy");
      if (!energy) return null;
      return gameReducer(state, { type: "SELECT_HAND_DISCARD", playerId, instanceId: energy.instanceId });
    }
    case "CHOOSE_BLOCKED_ATTACK": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "CHOOSE_BLOCKED_ATTACK", playerId, attackName: pending.options[0]! });
    }
    default:
      return null;
  }
}
