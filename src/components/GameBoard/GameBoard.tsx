import { useEffect, useMemo, useState } from "react";
import { GamePhase } from "@/lib/models/enums";
import { getOpponentId, getPlayer } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import { isSupporter } from "@/lib/models/definition";
import { getTrainerCategory } from "@/lib/ui/trainerHints";
import { useGameStore } from "@/stores/gameStore";
import { ActionDock } from "./ActionDock";
import { buildAttackActions, CardPreviewPanel } from "./CardPreviewPanel";
import { buildHandActions, buildPokemonActions } from "./CardActionMenu";
import { HandBar } from "./HandBar";
import { PlayerMat } from "./PlayerMat";
import { TurnBanner } from "./TurnBanner";
import { BoardCard } from "./BoardCard";
import { DiscardPilePanel } from "./DiscardPilePanel";
import { PendingActionPanel } from "./PendingActionPanel";
import { useGameBoardController } from "./useGameBoardController";

export function GameBoard() {
  const { engineState, dispatch, startGame, clearSaved, humanPlayerId } = useGameStore();
  const vsAI = humanPlayerId !== null;
  const controller = useGameBoardController(engineState, dispatch);
  const [discardViewPlayerId, setDiscardViewPlayerId] = useState<PlayerId | null>(null);

  useEffect(() => {
    if (engineState?.pendingAction?.type === "PICK_DISCARD") {
      setDiscardViewPlayerId(engineState.pendingAction.playerId);
    }
  }, [engineState?.pendingAction]);

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
        <p>No active game. Return to the lobby to start a match.</p>
      </section>
    );
  }

  const boardGame = game;
  const self = viewingPlayer;
  const rival = opponent;
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

  function handleActiveSelect() {
    const active = self.active;
    if (!active) return;
    controller.handlePokemonSelect(boardGame, active);
  }

  const pendingDiscardPick =
    boardGame.pendingAction?.type === "PICK_DISCARD" ? boardGame.pendingAction : null;

  return (
    <div className="play-screen">
      <TurnBanner game={boardGame} prompt={prompt} isMyTurn={isMyTurn} />

      <div className="play-screen__mat">
        <PlayerMat
          game={boardGame}
          player={rival}
          label={rival.name}
          isOpponent
          isActiveTurn={boardGame.currentPlayerId === rival.id && boardGame.phase === GamePhase.Active}
          highlightTargets={
            highlight &&
            (boardGame.pendingAction?.type === "BOSS_ORDERS" ||
              boardGame.pendingAction?.type === "CRUSHING_HAMMER")
          }
          onPokemonSelect={(card) => controller.handlePokemonSelect(boardGame, card)}
          onDiscardClick={() => setDiscardViewPlayerId(rival.id)}
          selectedPokemonId={controller.selectedBoardPokemon?.instanceId}
        />

        <div className="play-screen__center">
          {boardGame.stadium ? (
            <div className="play-screen__stadium">
              <span>Stadium</span>
              <BoardCard state={boardGame} card={boardGame.stadium} size="mini" showName={false} />
            </div>
          ) : (
            <div className="play-screen__stadium play-screen__stadium--empty">Stadium</div>
          )}

          <ul className="play-log">
            {boardGame.log.slice(-8).map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>

          {boardGame.winnerId && (
            <p className="status-ok play-screen__winner">
              Winner: {getPlayer(boardGame, boardGame.winnerId).name}
            </p>
          )}
        </div>

        <PlayerMat
          game={boardGame}
          player={self}
          label={self.name}
          isActiveTurn={isMyTurn && boardGame.phase === GamePhase.Active}
          highlightTargets={highlight && boardGame.pendingAction?.type !== "BOSS_ORDERS" && boardGame.pendingAction?.type !== "CRUSHING_HAMMER"}
          onPokemonSelect={(card) => controller.handlePokemonSelect(boardGame, card)}
          onActiveSelect={handleActiveSelect}
          onDiscardClick={() => setDiscardViewPlayerId(self.id)}
          selectedPokemonId={controller.selectedBoardPokemon?.instanceId}
        />
      </div>

      <HandBar
        game={boardGame}
        hand={self.hand}
        selectedId={controller.selectedHandCard?.instanceId}
        onSelect={controller.handleHandSelect}
        getQuickLabel={(def) => getHandQuickLabel(def)}
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
        onPickDeck={(instanceId) =>
          controller.runAction({
            type: "PICK_DECK_CARD",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
            instanceId,
          })
        }
        onDiscardHandCard={(instanceId) =>
          controller.runAction({
            type: "DISCARD_HAND_SUPPORTER_FOR_ATTACK",
            playerId: boardGame.pendingAction?.playerId ?? viewingId,
            instanceId,
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
      />

      {boardGame.pendingAction?.type === "DISTRIBUTE_BENCH_DAMAGE" && (
        <div className="pending-panel pending-panel--compact pending-panel--top">
          <p>
            {boardGame.pendingAction.countersRemaining} damage counter(s) left — click opponent Bench Pokémon
          </p>
        </div>
      )}

      {boardGame.turnFlags.trFactoryDrawAvailable && isMyTurn && !boardGame.pendingAction && (
        <div className="pending-panel pending-panel--compact pending-panel--top">
          <p>Team Rocket's Factory — draw 2 cards?</p>
          <div className="pending-panel__actions">
            <button
              type="button"
              className="pending-panel__pick"
              onClick={() => controller.runAction({ type: "USE_TR_FACTORY_DRAW", playerId: viewingId })}
            >
              Draw 2
            </button>
            <button
              type="button"
              className="pending-panel__skip"
              onClick={() => controller.runAction({ type: "SKIP_OPTIONAL", playerId: viewingId })}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {vsAI && !isMyTurn && !boardGame.winnerId && (
        <div className="ai-thinking-banner">
          🤖 AI is playing…
        </div>
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
    </div>
  );
}
