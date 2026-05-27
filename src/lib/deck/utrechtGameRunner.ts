import type { BuiltDeck } from "./builder";
import { buildDeckFromText } from "./builder";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import type { TournamentDeckPreset } from "./tournamentPresets";
import { canAffordAttack, canAffordRetreat } from "../engine/energy";
import { canRareCandyEvolveInto, checkMulliganNeeded } from "../engine/rules";
import { beginGame, gameReducer, getLegalActions, startActiveGame } from "../engine/reducer";
import { getDefinitionSafe } from "../engine/rules";
import { getStadiumKind } from "../engine/effects/stadiumEffects";
import { isBasicPokemon, isStage2, isSupporter } from "../models/definition";
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

    if (!state.pendingAction && !state.turnFlags.attacked) {
      const trainerAction = pickAutoTrainerAction(state, ctx);
      if (trainerAction) {
        state = gameReducer(state, trainerAction);
        actionCount += 1;
        const drained = drainAutoPending(state, 12, ctx);
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
        const targetTypes: string[] = targetMon
          ? (getDefinition(state, targetMon.definitionId)?.types ?? ["Colorless"])
          : ["Colorless"];

        // Find best energy from hand: prefer one that matches the target's type.
        // Match rules:
        // 1. Colorless energy → matches any Pokémon (can pay any attack cost)
        // 2. Colorless-type Pokémon → any energy matches (attack costs are Colorless)
        // 3. Same type (e.g. Psychic energy → Psychic Pokémon) → match
        const energiesInHand = player.hand.filter(
          (card) => getDefinition(state, card.definitionId)?.supertype === "Energy",
        );
        const targetIsColorless = targetTypes.includes("Colorless");
        const bestEnergyForTarget = energiesInHand.sort((a, b) => {
          const aTypes = getDefinition(state, a.definitionId)?.types ?? ["Colorless"];
          const bTypes = getDefinition(state, b.definitionId)?.types ?? ["Colorless"];
          // Energy matches target if: energy is Colorless, target is Colorless, or types overlap
          const aMatches = (aTypes.includes("Colorless") || targetIsColorless ||
            aTypes.some((t) => targetTypes.includes(t))) ? 1 : 0;
          const bMatches = (bTypes.includes("Colorless") || targetIsColorless ||
            bTypes.some((t) => targetTypes.includes(t))) ? 1 : 0;
          return bMatches - aMatches; // prefer matching energy first
        })[0];

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
        state = gameReducer(state, abilityAction);
        actionCount += 1;
        const drained = drainAutoPending(state, 12, ctx);
        state = drained.state;
        actionCount += drained.steps;
        if (isPlayStalled(state)) {
          return { state, turnCount, actionCount, stalled: true, winnerId: state.winnerId };
        }
        if (state.phase !== GamePhase.Active || state.winnerId) break;
        continue;
      }
    }

    // Retreat to a better attacker (e.g. Lopunny loop) before attacking
    if (!state.pendingAction && !state.turnFlags.retreated && !state.turnFlags.attacked) {
      const retreatAction = pickRetreatAction(state, playerId, ctx);
      if (retreatAction) {
        state = gameReducer(state, retreatAction);
        actionCount += 1;
        continue;
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
        const beforeTurn = state.turnNumber;
        const beforePlayer = state.currentPlayerId;
        state = gameReducer(state, { type: "ATTACK", playerId, attackName: bestAttack });
        actionCount += 1;
        attacked = true;
        const drained = drainAutoPending(state, 12, ctx);
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
        if (state.currentPlayerId !== beforePlayer || state.turnNumber > beforeTurn) {
          turnCount += 1;
        }
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

/** Resolve simple optional/target pending actions so corpus playtests can finish. */
export function drainAutoPending(state: EngineState, maxSteps = 12, ctx?: StrategyContext): { state: EngineState; steps: number } {
  let next = state;
  let steps = 0;
  while (
    steps < maxSteps &&
    next.pendingAction &&
    next.phase === GamePhase.Active &&
    !next.winnerId
  ) {
    const resolved = tryResolveAutoPending(next, ctx);
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

  // "Night Joker" — copies the best attack from a benched N's Pokémon
  if (lower.includes("night joker")) {
    let bestDamage = 0;
    for (const bench of player.bench) {
      const def = getDefinition(state, bench.definitionId);
      if (!def?.name?.toLowerCase().startsWith("n's")) continue;
      for (const atk of (def.attacks ?? [])) {
        const d = parseInt(atk.damage, 10) || 0;
        if (d > bestDamage) bestDamage = d;
      }
    }
    return bestDamage;
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
      const opponentHp = getPlayer(state, getOpponentId(playerId)).active
        ? remainingHp(state, getPlayer(state, getOpponentId(playerId)).active!)
        : 9999;
      const expectedDamage = trCount * 60;
      // Attack if: can KO with current count, OR 3+ supporters loaded, OR 2+ and long game, OR desperate
      const canKO = expectedDamage >= opponentHp;
      const desperate = player.deck.length <= 10 || state.turnNumber >= 12;
      if (!canKO && !desperate && trCount < 3) return true; // keep loading hand
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
    }

    // === DAMAGE ABILITIES (value scales with KO potential) ===

    else if (abilityLower.includes("cursed blast")) {
      // Place 13 damage counters on any opponent Pokémon, then Dusknoir KOs itself.
      // Only worth it if we get meaningful value — never sacrifice Dusknoir casually.
      // Dusknoir (PRE 37): 150 HP. "Dying" = ≤ 70 HP remaining (≥80 damage taken).
      // This is conservative — only sacrifice when truly at risk of being KO'd next turn.
      const dusknoirHp = pokemon ? remainingHp(state, pokemon) : 9999;
      const dusknoirDying = dusknoirHp <= 70; // ≥80 damage taken — opponent likely KOs next turn
      const canKONow = allOpponent.some((p) => remainingHp(state, p) <= 130);
      // Set-up KO: Cursed Blast 130 + Phantom Dive active 120 = 250 on active
      //            Cursed Blast 130 + Phantom Dive bench 50 = 180 on bench
      const setsUpActiveKO = opponent.active != null && remainingHp(state, opponent.active) <= 250;
      const setsUpBenchKO = opponent.bench.some((p) => remainingHp(state, p) <= 180);
      const setsUpKO = setsUpActiveKO || setsUpBenchKO;
      if (canKONow) score = 95;                       // Immediate KO — always worth the sacrifice
      else if (dusknoirDying && setsUpKO) score = 85; // Dying anyway; secure the KO setup
      else if (dusknoirDying) score = 72;             // Dying anyway — put 13 counters somewhere
      else if (setsUpKO) score = 65;                  // Healthy Dusknoir, sets up a KO next turn
      // else: score stays 0 — don't sacrifice Dusknoir without meaningful outcome

    } else if (abilityLower.includes("mortal shuriken")) {
      // Discard Basic Water Energy, place 6 damage counters on any opponent Pokémon
      const canKOTarget = allOpponent.some((p) => remainingHp(state, p) <= 60);
      score = canKOTarget ? 90 : 50; // High if KO, medium for spread

    } else if (abilityLower.includes("adrena-brain")) {
      // Move up to 3 damage counters from ONE opponent Pokémon to ANOTHER opponent Pokémon
      // Source = opponent's Pokémon with excess counters; Target = opponent's Pokémon nearest to KO
      const opponentDamagedList = allOpponent.filter((p) => p.damageCounters >= 3);
      const canConsolidateKO = allOpponent.some((p) => {
        const hp = remainingHp(state, p);
        // Can we finish off a Pokémon by moving 3 counters (30 damage) onto it?
        return hp <= 30 && opponentDamagedList.some((src) => src.instanceId !== p.instanceId);
      });
      const hasSpreadDamage = opponentDamagedList.length >= 2; // Two damaged Pokémon → consolidate
      if (canConsolidateKO) score = 88;      // Move 30 damage to KO a near-dead Pokémon
      else if (hasSpreadDamage) score = 55;  // Redistribute to consolidate for future KO
      // else score = 0 — nothing to move, don't waste the ability

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
      // Look at top 2 of deck, put 1 into hand — exceptional setup card for Dragapult
      // Drakloak sits on bench passively, triggering this each turn for free card advantage.
      score = player.deck.length >= 2 ? 78 : 0;

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

    }
    // Unknown ability → skip (do not trigger abilities with unhandled pending states)

    return { action, score };
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.action ?? null;
}

/**
 * Pick the best attack for the active Pokémon.
 * - Prefers attacks that KO the opponent
 * - Estimates variable damage (60×, 60+) from game context
 * - Gates strategy-specific attacks (Rocket Feathers, Gale Thrust) on preconditions
 * - Boosts the archetype's signature attack
 */
export function pickBestAttack(state: EngineState, playerId: PlayerId, ctx?: StrategyContext): string | null {
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
export function pickBestEnergyTarget(state: EngineState, playerId: PlayerId, ctx?: StrategyContext): string | null {
  const player = getPlayer(state, playerId);
  const allPokemon = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];
  if (allPokemon.length === 0) return null;

  // Score each Pokémon: prefer those closest to being able to attack
  const scored = allPokemon.map((pokemon) => {
    const def = getDefinitionSafe(state, pokemon.definitionId);
    const energyCount = pokemon.attachedEnergy.length;
    const isActive = player.active?.instanceId === pokemon.instanceId;
    const hasAttacks = (def.attacks?.length ?? 0) > 0;

    // Check if already can attack (skip — no point adding more)
    const alreadyReady = (def.attacks ?? []).some(
      (atk) => canAffordAttack(state, pokemon, atk),
    );

    // Check if ONE more energy would let it attack ("one-away")
    const oneAway = !alreadyReady && hasAttacks && (def.attacks ?? []).some((atk) => {
      const needed = atk.convertedEnergyCost ?? 1;
      return energyCount === needed - 1;
    });

    // Base score: prefer active, prefer closer to attacking
    let score = energyCount * 10 + (isActive ? 5 : 0) + (hasAttacks ? 2 : 0);
    if (alreadyReady) score -= 50; // Don't pile energy on already-ready Pokémon
    if (oneAway) score += 25;      // "One-away": strong bonus — enable the next attacker

    // Archetype-aware: boost Pokémon that the strategy wants energized
    if (ctx) {
      const nameLower = def.name.toLowerCase();
      const archPriority = getArchetypeEnergyPriority(ctx.archetype, nameLower);
      score += archPriority;

      // Dragapult: never attach to Budew (item-locker, has no relevant attacks needing energy)
      if (ctx.archetype === "dragapult" && nameLower.includes("budew")) score -= 100;
      // Zoroark: never attach to N's Zorua (no attacks worth energizing)
      if (ctx.archetype === "zoroark" && nameLower.includes("zorua")) score -= 80;
      // Ogerpon: always keep some energy on Teal Mask Ogerpon ex (Teal Dance ability needs Grass)
      if ((ctx.archetype === "ogerpon-box") && nameLower.includes("teal mask ogerpon")) score += 20;
      // Dusknoir / Munkidori / Dusclops: never attach energy (ability-only Pokémon, no energy attacks)
      if (nameLower.includes("dusknoir") || nameLower.includes("munkidori") || nameLower.includes("dusclops")) score -= 60;
      // Hydrapple: Meganium only provides energy, doesn't attack — skip energy
      if (ctx.archetype === "hydrapple" && nameLower.includes("meganium")) score -= 60;
      if (ctx.archetype === "hydrapple" && nameLower.includes("bayleef")) score -= 30;
      // Garchomp: Roserade/Roselia are bench-only — never attach energy
      if (ctx.archetype === "garchomp" && (nameLower.includes("roserade") || nameLower.includes("roselia"))) score -= 80;
      // Greninja: Budew item-locks only — skip energy
      if (ctx.archetype === "greninja" && nameLower.includes("budew")) score -= 100;
      // Greninja: Froakie/Snorunt/Duskull/Dusclops/Latias ex are support-only — deprioritise energy
      if (ctx.archetype === "greninja" && (nameLower.includes("froakie") || nameLower.includes("snorunt") || nameLower.includes("latias ex"))) score -= 60;
      // Greninja: Frogadier is staging attacker — gets some energy to use Summoning Jutsu/Aqua Edge
      if (ctx.archetype === "greninja" && nameLower.includes("frogadier")) score += 10;
      // Greninja: Mega Froslass ex is secondary attacker — needs at least 1 energy for Resentful Refrain
      // Don't over-load Froslass; Greninja ex (energyPriority 95) takes priority first.
      // When Greninja ex already has enough energy (alreadyReady), the -50 penalty balances this.
      if (ctx.archetype === "greninja" && nameLower.includes("mega froslass ex")) score += 15;
      // Lopunny: prefer BENCH Mega Lopunny ex for energy loading (Gale Thrust loop).
      // The bench Lopunny will retreat to active next turn — it needs energy BEFORE the retreat.
      // Exception: if active Lopunny just moved from bench THIS turn, it needs energy to attack NOW.
      if (ctx.archetype === "lopunny" && nameLower.includes("mega lopunny ex") && !isActive) {
        const movedIds = state.turnFlags.movedFromBenchToActiveIds ?? [];
        const activeJustMoved = player.active && movedIds.includes(player.active.instanceId);
        if (!activeJustMoved) {
          score += 25; // Load bench Lopunny so it can Gale Thrust when promoted
        }
      }
    }

    return { id: pokemon.instanceId, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? (player.active?.instanceId ?? null);
}

export function pickAutoTrainerAction(state: EngineState, ctx?: StrategyContext): Extract<GameAction, { type: "PLAY_TRAINER" }> | null {
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
      // === TEAM ROCKET SUPPORTERS (specific scoring for Honchkrow archetype) ===
      } else if (name.includes("team rocket's transceiver")) {
        // Grab a TR Supporter from deck — critical for Rocket Feathers setup
        score = 70;
      } else if (name.includes("team rocket's ariana")) {
        // Draws to 8 if all Pokémon in play are TR — enormous hand refresh
        score = 65;
      } else if (name.includes("team rocket's proton")) {
        // T1 bench fill: search 3 Basic TR Pokémon from deck
        score = player.bench.length < 2 ? 68 : 22;
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
        score = hasRareCandyTarget ? 72 : 8; // High if ready to use; low if just holding
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
        score = opponent.active && opponent.active.attachedEnergy.length > 0 ? 30 : 15;
      } else if (name.includes("unfair stamp")) {
        score = opponent.prizes.length <= 3 ? 45 : 10;
      } else if (name.includes("air balloon")) {
        // Lopunny: Air Balloon on Lopunny enables Gale Thrust retreat cycle
        const lopunnyNeedsBalloon = (player.active && !player.active.toolId &&
          getDefinition(state, player.active.definitionId)?.name?.toLowerCase().includes("lopunny")) ||
          player.bench.some((p) => !p.toolId && getDefinition(state, p.definitionId)?.name?.toLowerCase().includes("lopunny"));
        score = lopunnyNeedsBalloon ? 65 : (player.active && !player.active.toolId ? 22 : -1);
      } else if (name.includes("energy switch")) {
        score = player.bench.length > 0 ? 28 : -1;
      } else if (name.includes("battle cage")) {
        score = 35;
      } else if (name.includes("team rocket's factory")) {
        // Honchkrow: TR Factory is critical — play ASAP before drawing
        score = !state.stadium ? 80 : 25; // Very high if no stadium in play
      } else if (name.includes("mist energy")) {
        // Mist Energy: blocks Bench attack effects — best on Lopunny bench (prevents Phantom Dive counters)
        const hasBenchNeedsMist = player.bench.some((p) => !p.toolId &&
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

      return { action, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

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
  const inPlayNames = new Set([
    ...(player.active ? [getDefinition(state, player.active.definitionId)?.name?.toLowerCase() ?? ""] : []),
    ...player.bench.map((p) => getDefinition(state, p.definitionId)?.name?.toLowerCase() ?? ""),
  ]);

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
      if (def.evolvesFrom && inPlayNames.has(def.evolvesFrom.toLowerCase())) score += 15;
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
      // Pick best target: prefer KO'd by this damage, then most damaged (closest to KO)
      const damage = (pending.amount ?? 13) * 10;
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
    case "PICK_DISCARD":
      if (pending.options.length === 0) return null;
      return gameReducer(state, {
        type: "PICK_DISCARD_POKEMON",
        playerId,
        instanceId: pending.options[0]!,
      });
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
      const player = getPlayer(state, playerId);
      const bench = player.bench[0];
      if (!bench) {
        const finished = { ...state, pendingAction: null };
        finished.winnerId = getOpponentId(playerId);
        finished.phase = GamePhase.Finished;
        return finished;
      }
      return gameReducer(state, {
        type: "PROMOTE_BENCH",
        playerId,
        instanceId: bench.instanceId,
      });
    }
    case "DAMAGE_TWO_OPPONENT": {
      const opponent = getPlayer(state, getOpponentId(playerId));
      const candidates = [
        ...(opponent.active ? [opponent.active] : []),
        ...opponent.bench,
      ].filter((pokemon) => !pending.pickedIds.includes(pokemon.instanceId));
      if (candidates.length === 0) return null;
      return gameReducer(state, {
        type: "CHOOSE_OPPONENT_DAMAGE",
        playerId,
        targetId: candidates[0]!.instanceId,
      });
    }
    case "IONO_HAND_BOTTOM": {
      const player = getPlayer(state, playerId);
      const card = player.hand[0];
      if (!card) return null;
      return gameReducer(state, { type: "IONO_SELECT_HAND", playerId, instanceId: card.instanceId });
    }
    case "MOVE_ENERGY_TO_BENCH": {
      const player = getPlayer(state, playerId);
      const bench = player.bench[0];
      if (!bench) return null;
      return gameReducer(state, { type: "MOVE_ENERGY_TO_BENCH", playerId, benchInstanceId: bench.instanceId });
    }
    case "SEARCH_EVOLUTION": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
    }
    case "SWITCH_TYPED_BENCH": {
      if (pending.options.length === 0) return null;
      return gameReducer(state, { type: "SWITCH_WITH_BENCH", playerId, benchInstanceId: pending.options[0]! });
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
      return gameReducer(state, { type: "PICK_DECK_CARD", playerId, instanceId: pending.options[0]! });
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
      return gameReducer(state, { type: "SELECT_PRIME_CATCHER_BENCH", playerId, benchInstanceId: pending.options[0]! });
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
      const cOpt = pending.options[0]!;
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
            const maxHp = parseInt(def?.hp ?? "100", 10) || 100;
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
      const player = getPlayer(state, playerId);
      const opponent = getPlayer(state, getOpponentId(playerId));
      const opponentHp = opponent.active ? remainingHp(state, opponent.active) : 9999;
      // Pick the copied attack that best KOs the opponent:
      // prefer attack whose damage >= opponent HP (KO), then highest raw damage
      const bestOpt = [...pending.options].sort((a, b) => {
        const aBenchDef = getDefinition(state, player.bench.find((p) => p.instanceId === a.benchPokemonId)?.definitionId ?? "");
        const bBenchDef = getDefinition(state, player.bench.find((p) => p.instanceId === b.benchPokemonId)?.definitionId ?? "");
        const aAtk = aBenchDef?.attacks?.find((atk) => atk.name === a.attackName);
        const bAtk = bBenchDef?.attacks?.find((atk) => atk.name === b.attackName);
        const aDmg = parseInt(aAtk?.damage ?? "0", 10) || 0;
        const bDmg = parseInt(bAtk?.damage ?? "0", 10) || 0;
        const aKo = aDmg >= opponentHp && aDmg > 0 ? 1 : 0;
        const bKo = bDmg >= opponentHp && bDmg > 0 ? 1 : 0;
        if (aKo !== bKo) return bKo - aKo; // prefer KO attack
        return bDmg - aDmg; // else pick highest damage
      })[0]!;
      return gameReducer(state, { type: "CHOOSE_BENCH_ATTACK", playerId, benchPokemonId: bestOpt.benchPokemonId, attackName: bestOpt.attackName });
    }
    case "ABILITY_DISCARD_HAND": {
      // Discard least valuable card (for Trade, N's Zoroark, etc.)
      const player = getPlayer(state, playerId);
      if (player.hand.length === 0) return null;
      const keepSet = new Set(ctx ? ctx.profile.ultraBallKeep.map((s) => s.toLowerCase()) : []);
      const worst = [...player.hand].sort((a, b) => {
        const aDef = getDefinition(state, a.definitionId);
        const bDef = getDefinition(state, b.definitionId);
        const aName = aDef?.name?.toLowerCase() ?? "";
        const bName = bDef?.name?.toLowerCase() ?? "";
        // Protected cards: never discard
        const aProtected = keepSet.size > 0 && [...keepSet].some((k) => aName.includes(k));
        const bProtected = keepSet.size > 0 && [...keepSet].some((k) => bName.includes(k));
        if (aProtected && !bProtected) return 1;
        if (!aProtected && bProtected) return -1;
        // Prefer discarding: duplicates of energy, then items, then basics
        if (aDef?.supertype === "Energy" && bDef?.supertype !== "Energy") return -1;
        if (aDef?.supertype !== "Energy" && bDef?.supertype === "Energy") return 1;
        return 0;
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
