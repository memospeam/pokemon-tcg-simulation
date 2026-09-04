import { useEffect, useMemo, useState } from "react";
import { GamePhase } from "@/lib/models/enums";
import { getOpponentId, getPlayer } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import { isSupporter } from "@/lib/models/definition";
import { getTrainerCategory } from "@/lib/ui/trainerHints";
import { useGameStore } from "@/stores/gameStore";
import { MatchTable } from "@/components/Match/MatchTable";
import { useMatchEventClass } from "@/components/Match/useMatchAnimations";
import { CoinFlipOverlay } from "@/components/Match/CoinFlipOverlay";
import { useHandDragDrop } from "@/components/Match/useHandDragDrop";
import { ActionDock } from "./ActionDock";
import { buildAttackActions, CardPreviewPanel } from "./CardPreviewPanel";
import { buildHandActions, buildPokemonActions } from "./CardActionMenu";
import { DiscardPilePanel } from "./DiscardPilePanel";
import { PendingActionPanel } from "./PendingActionPanel";
import { StadiumAbilityPanel } from "./StadiumAbilityPanel";
import { useGameBoardController } from "./useGameBoardController";

export function GameBoard() {
  const { engineState, dispatch, startGame, clearSaved, humanPlayerId } = useGameStore();
  const vsAI = humanPlayerId !== null;
  const controller = useGameBoardController(engineState, dispatch);
  const [discardViewPlayerId, setDiscardViewPlayerId] = useState<PlayerId | null>(null);
  const eventClass = useMatchEventClass(engineState);

  const handDrag = useHandDragDrop(
    controller.legalActions,
    (energyId, targetId) => {
      const attachAction = controller.legalActions.find(
        (entry) =>
          entry.type === "ATTACH_ENERGY" &&
          entry.energyId === energyId &&
          entry.targetId === targetId,
      );
      if (attachAction) controller.runAction(attachAction);
    },
    (evolutionId, targetId) => {
      const evolveAction = controller.legalActions.find(
        (entry) =>
          entry.type === "EVOLVE" &&
          entry.evolutionId === evolutionId &&
          entry.targetId === targetId,
      );
      if (evolveAction) controller.runAction(evolveAction);
    },
  );

  useEffect(() => {
    if (engineState?.pendingAction?.type === "PICK_DISCARD") {
      setDiscardViewPlayerId(engineState.pendingAction.playerId);
    }
  }, [engineState?.pendingAction]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (!engineState || engineState.winnerId) return;

      if (event.key === "Escape") {
        controller.clearSelection();
        setDiscardViewPlayerId(null);
        return;
      }

      if (event.key === "e" || event.key === "E") {
        const myTurn = humanPlayerId !== null
          ? engineState.currentPlayerId === humanPlayerId
          : engineState.currentPlayerId === engineState.viewingPlayerId;
        if (
          engineState.phase === GamePhase.Active &&
          myTurn &&
          !engineState.pendingAction
        ) {
          event.preventDefault();
          dispatch({ type: "END_TURN" });
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, dispatch, engineState, humanPlayerId]);

  const game = engineState;
  const viewingId = game?.viewingPlayerId;
  const opponentId = viewingId ? getOpponentId(viewingId) : null;

  const viewingPlayer = game && viewingId ? getPlayer(game, viewingId) : null;
  const opponent = game && opponentId ? getPlayer(game, opponentId) : null;
  const currentPlayer = game ? getPlayer(game, game.currentPlayerId) : null;
  const isMyTurn = game && viewingId ? game.currentPlayerId === viewingId : false;

  const selectedDef = controller.selectedHandCard && game
    ? game.definitions[controller.selectedHandCard.definitionId]
    : null;

  const selectedBoardDef = controller.selectedBoardPokemon && game
    ? game.definitions[controller.selectedBoardPokemon.definitionId]
    : null;

  const handActions = useMemo(() => {
    if (!controller.selectedHandCard || !selectedDef || !game) return [];
    return buildHandActions(controller.selectedHandCard, selectedDef, controller.legalActions, game);
  }, [controller.selectedHandCard, selectedDef, controller.legalActions, game]);

  const boardPokemonActions = useMemo(() => {
    if (!controller.selectedBoardPokemon || !selectedBoardDef || !game) return [];
    return buildPokemonActions(
      controller.selectedBoardPokemon,
      selectedBoardDef,
      controller.legalActions,
      game,
    );
  }, [controller.selectedBoardPokemon, selectedBoardDef, controller.legalActions, game]);

  const boardAttackActions = useMemo(() => {
    if (!controller.selectedBoardPokemon || !selectedBoardDef || !game) return [];
    return buildAttackActions(
      controller.selectedBoardPokemon,
      selectedBoardDef,
      controller.legalActions,
    );
  }, [controller.selectedBoardPokemon, selectedBoardDef, controller.legalActions, game]);

  const boardOtherActions = useMemo(
    () => boardPokemonActions.filter((entry) => entry.action.type !== "ATTACK"),
    [boardPokemonActions],
  );

  if (!game || !viewingPlayer || !opponent || !currentPlayer || !viewingId || !opponentId) {
    return (
      <section className="panel">
        <p>No active game. Return to Battle to start a match.</p>
      </section>
    );
  }

  const boardGame = game;
  const prompt = controller.getPhasePrompt(boardGame, isMyTurn, currentPlayer.name);
  const highlight = controller.isTargetHighlight(boardGame);

  function getHandQuickLabel(def: typeof selectedDef) {
    if (!def || !isMyTurn) return null;
    if (def.supertype === "Energy") return "Energy";
    if (def.supertype === "Trainer") {
      return isSupporter(def) ? "Supporter" : getTrainerCategory(def);
    }
    if (def.supertype === "Pokémon") return def.subtypes.includes("Basic") ? "Basic" : "Evolve";
    return null;
  }

  const pendingDiscardPick =
    boardGame.pendingAction?.type === "PICK_DISCARD" ? boardGame.pendingAction : null;

  const opponentTargetPending =
    highlight &&
    (boardGame.pendingAction?.type === "BOSS_ORDERS" ||
      boardGame.pendingAction?.type === "CRUSHING_HAMMER" ||
      boardGame.pendingAction?.type === "CHOOSE_OPPONENT_POKEMON_DAMAGE" ||
      (boardGame.pendingAction?.type === "GIOVANNI" && (boardGame.pendingAction as { step: string }).step === "OPPONENT_BENCH") ||
      (boardGame.pendingAction?.type === "PRIME_CATCHER" && (boardGame.pendingAction as { step: string }).step === "OPPONENT_BENCH"));

  return (
    <>
      <CoinFlipOverlay game={boardGame} />
      <MatchTable
        className={eventClass}
        game={boardGame}
        viewingPlayerId={viewingId}
        visibility="player"
        prompt={prompt}
        interactive
        highlightOpponentTargets={!!opponentTargetPending}
        highlightSelfTargets={highlight && !opponentTargetPending}
        selectedPokemonId={controller.selectedBoardPokemon?.instanceId}
        selectedHandId={controller.selectedHandCard?.instanceId}
        onPokemonSelect={(card) => controller.handlePokemonSelect(boardGame, card)}
        onActiveSelect={() => {
          const active = viewingPlayer.active;
          if (active) controller.handlePokemonSelect(boardGame, active);
        }}
        onDiscardClick={setDiscardViewPlayerId}
        onHandSelect={controller.handleHandSelect}
        getHandQuickLabel={(def) => getHandQuickLabel(def)}
        canDragHandCard={isMyTurn ? handDrag.canDragHandCard : undefined}
        onHandDragStart={isMyTurn ? handDrag.onHandDragStart : undefined}
        onHandDragEnd={isMyTurn ? handDrag.onHandDragEnd : undefined}
        dropKindForTarget={isMyTurn ? handDrag.dropKindForTarget : undefined}
        onHandDrop={isMyTurn ? handDrag.onHandDrop : undefined}
      />

      {controller.selectedHandCard && selectedDef && (
        <CardPreviewPanel
          definition={selectedDef}
          actions={handActions.filter(
            (entry) => entry.action.type !== "ATTACH_ENERGY" || entry.action.targetId,
          )}
          attackActions={[]}
          onAction={controller.handleHandAction}
          onClose={controller.clearSelection}
        />
      )}

      {controller.selectedBoardPokemon && selectedBoardDef && (
        <CardPreviewPanel
          definition={selectedBoardDef}
          actions={boardOtherActions}
          attackActions={boardAttackActions}
          onAction={controller.runAction}
          onClose={controller.clearSelection}
        />
      )}

      {discardViewPlayerId && (
        <DiscardPilePanel
          game={boardGame}
          playerId={discardViewPlayerId}
          onClose={() => setDiscardViewPlayerId(null)}
          onPick={
            pendingDiscardPick && pendingDiscardPick.playerId === discardViewPlayerId
              ? (instanceId) => {
                  if (!pendingDiscardPick.options.includes(instanceId)) return;
                  controller.runAction({
                    type: "PICK_DISCARD_POKEMON",
                    playerId: pendingDiscardPick.playerId,
                    instanceId,
                  });
                  setDiscardViewPlayerId(null);
                }
              : undefined
          }
          pickLabel="Add to hand"
          selectableIds={
            pendingDiscardPick && pendingDiscardPick.playerId === discardViewPlayerId
              ? pendingDiscardPick.options
              : undefined
          }
        />
      )}

      <PendingActionPanel
        game={boardGame}
        onPickDeck={(instanceId) => {
          const pid = boardGame.pendingAction?.playerId ?? viewingId;
          const pt = boardGame.pendingAction?.type;
          if (pt === "ROTO_STICK") {
            controller.runAction({ type: "SELECT_ROTO_STICK", playerId: pid, instanceId });
          } else if (pt === "BUG_CATCHING_SET") {
            controller.runAction({ type: "SELECT_BUG_CATCHING", playerId: pid, instanceId });
          } else {
            controller.runAction({ type: "PICK_DECK_CARD", playerId: pid, instanceId });
          }
        }}
        onPickDiscard={(instanceId) => {
          const pid = boardGame.pendingAction?.playerId ?? viewingId;
          const pt = boardGame.pendingAction?.type;
          if (pt === "MIRACLE_HEADSET") {
            controller.runAction({ type: "SELECT_MIRACLE_HEADSET", playerId: pid, instanceId });
          }
        }}
        onDiscardHandCard={(instanceId) =>
          controller.runAction({
            type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
            instanceId,
          })
        }
        onChooseBenchAttack={(benchPokemonId, attackName) =>
          controller.runAction({
            type: "CHOOSE_BENCH_ATTACK",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
            benchPokemonId,
            attackName,
          })
        }
        onSkipOptional={() =>
          controller.runAction({
            type: "SKIP_OPTIONAL",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
          })
        }
        onConfirmDrawUntil={() =>
          controller.runAction({
            type: "CONFIRM_DRAW_UNTIL_HAND",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
          })
        }
        onSelectGrandTreeBasic={(targetId) =>
          controller.runAction({
            type: "SELECT_GRAND_TREE_BASIC",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
            targetId,
          })
        }
        onSelectGrandTreeDeck={(instanceId) => {
          const step = boardGame.pendingAction?.type === "GRAND_TREE" ? boardGame.pendingAction.step : null;
          controller.runAction(
            step === "STAGE1"
              ? {
                  type: "SELECT_GRAND_TREE_STAGE1",
                  playerId: boardGame.pendingAction?.playerId ?? viewingId,
                  instanceId,
                }
              : {
                  type: "SELECT_GRAND_TREE_STAGE2",
                  playerId: boardGame.pendingAction?.playerId ?? viewingId,
                  instanceId,
                },
          );
        }}
        onSkipGrandTreeStage2={() =>
          controller.runAction({
            type: "SKIP_GRAND_TREE_STAGE2",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
          })
        }
      />

      <StadiumAbilityPanel
        game={boardGame}
        viewingId={viewingId}
        isMyTurn={isMyTurn}
        onRun={controller.runAction}
      />

      {boardGame.pendingAction?.type === "DISTRIBUTE_BENCH_DAMAGE" && (
        <div className="pending-panel pending-panel--compact pending-panel--top">
          <p>
            {boardGame.pendingAction.countersRemaining} damage counter(s) left — click opponent Bench Pokémon
          </p>
        </div>
      )}

      {vsAI && !isMyTurn && !boardGame.winnerId && (
        <div className="ai-thinking-banner">🤖 AI is playing…</div>
      )}

      <ActionDock
        phase={boardGame.phase}
        isMyTurn={isMyTurn}
        hasPendingAction={!!boardGame.pendingAction}
        canStart={controller.canStart}
        viewingId={viewingId}
        currentId={boardGame.currentPlayerId}
        opponentId={opponentId}
        onEndTurn={() => dispatch({ type: "END_TURN" })}
        onSwitchSide={vsAI ? undefined : () => dispatch({ type: "SWITCH_VIEW", playerId: opponentId })}
        onJumpToCurrent={() => dispatch({ type: "SWITCH_VIEW", playerId: boardGame.currentPlayerId })}
        onMulligan={
          boardGame.pendingMulliganPlayerId
            ? () => dispatch({ type: "MULLIGAN", playerId: boardGame.pendingMulliganPlayerId! })
            : undefined
        }
        onStartGame={startGame}
        onConcede={() => dispatch({ type: "CONCEDE", playerId: viewingId })}
        showMulligan={boardGame.phase === GamePhase.Mulligan && !!boardGame.pendingMulliganPlayerId}
      />

      <button type="button" className="play-screen__clear" onClick={clearSaved}>
        Reset saved game
      </button>
    </>
  );
}
