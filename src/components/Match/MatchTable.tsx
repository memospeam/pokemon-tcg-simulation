import type { ReactNode } from "react";
import { GamePhase } from "@/lib/models/enums";
import type { CardDefinition } from "@/lib/models/definition";
import type { CardInstance } from "@/lib/models/instance";
import type { EngineState } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import { getPlayer } from "@/lib/engine";
import { PlayerMat } from "@/components/GameBoard/PlayerMat";
import { TurnBanner } from "@/components/GameBoard/TurnBanner";
import { HandBar } from "@/components/GameBoard/HandBar";
import { BoardCard } from "@/components/GameBoard/BoardCard";
import { TurnPhaseBar } from "@/components/Battle/TurnPhaseBar";
import { HiddenHandBar } from "./HiddenHandBar";
import { useMatchView } from "./useMatchView";
import { useDamageFloats } from "./useDamageFloat";
import type { MatchVisibility } from "./types";
import type { HandDragKind } from "./useHandDragDrop";

export interface MatchTableProps {
  game: EngineState;
  viewingPlayerId: PlayerId;
  visibility: MatchVisibility;
  prompt: string;
  interactive?: boolean;
  highlightOpponentTargets?: boolean;
  highlightSelfTargets?: boolean;
  selectedPokemonId?: string;
  selectedHandId?: string;
  onPokemonSelect?: (card: CardInstance) => void;
  onActiveSelect?: () => void;
  onDiscardClick?: (playerId: PlayerId) => void;
  onHandSelect?: (card: CardInstance) => void;
  getHandQuickLabel?: (def: CardDefinition) => string | null;
  canDragHandCard?: (instanceId: string) => boolean;
  onHandDragStart?: (card: CardInstance) => void;
  onHandDragEnd?: () => void;
  dropKindForTarget?: (instanceId: string) => HandDragKind | null;
  onHandDrop?: (card: CardInstance) => void;
  logTail?: number;
  showPhaseBar?: boolean;
  footer?: ReactNode;
  className?: string;
}

const NOOP = () => {};

export function MatchTable({
  game,
  viewingPlayerId,
  visibility,
  prompt,
  interactive: _interactive = false,
  highlightOpponentTargets = false,
  highlightSelfTargets = false,
  selectedPokemonId,
  selectedHandId,
  onPokemonSelect,
  onActiveSelect,
  onDiscardClick,
  onHandSelect,
  getHandQuickLabel,
  canDragHandCard,
  onHandDragStart,
  onHandDragEnd,
  dropKindForTarget,
  onHandDrop,
  logTail = 8,
  showPhaseBar = true,
  footer,
  className = "",
}: MatchTableProps) {
  const view = useMatchView(game, viewingPlayerId, visibility);
  const damageFloats = useDamageFloats(game, viewingPlayerId);
  if (!view) return null;

  const { self, opponent, opponentPlayerId, isMyTurn, hideOpponentHand, opponentHandCount } = view;
  const onPokemon = onPokemonSelect ?? NOOP;
  const onHand = onHandSelect ?? NOOP;
  const winner = game.winnerId ? getPlayer(game, game.winnerId).name : null;

  return (
    <div className={`match-table ${className}`.trim()}>
      {showPhaseBar && <TurnPhaseBar game={game} isMyTurn={isMyTurn} />}
      <TurnBanner game={game} prompt={prompt} isMyTurn={isMyTurn} />

      {hideOpponentHand ? (
        <HiddenHandBar playerName={opponent.name} count={opponentHandCount} isOpponent />
      ) : (
        <HandBar
          game={game}
          hand={opponent.hand}
          onSelect={onHand}
          playerName={opponent.name}
          isOpponent
        />
      )}

      <div className="match-table__felt">
        <PlayerMat
          game={game}
          player={opponent}
          label={opponent.name}
          isOpponent
          isActiveTurn={game.currentPlayerId === opponentPlayerId && game.phase === GamePhase.Active}
          highlightTargets={highlightOpponentTargets}
          onPokemonSelect={onPokemon}
          onDiscardClick={onDiscardClick ? () => onDiscardClick(opponentPlayerId) : undefined}
          selectedPokemonId={selectedPokemonId}
          damageFloats={damageFloats}
        />

        <div className="match-table__center">
          {game.stadium ? (
            <div className="match-table__stadium">
              <span className="match-table__stadium-label">Stadium</span>
              <BoardCard state={game} card={game.stadium} size="mini" showName={false} />
            </div>
          ) : (
            <div className="match-table__stadium match-table__stadium--empty">Stadium</div>
          )}

          <ul className="match-table__log">
            {game.log.slice(-logTail).map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>

          {winner && <p className="match-table__winner">Winner: {winner}</p>}
        </div>

        <PlayerMat
          game={game}
          player={self}
          label={self.name}
          isActiveTurn={isMyTurn && game.phase === GamePhase.Active}
          highlightTargets={highlightSelfTargets}
          onPokemonSelect={onPokemon}
          onActiveSelect={
            onActiveSelect
              ? (card) => {
                  onActiveSelect();
                  void card;
                }
              : undefined
          }
          onDiscardClick={onDiscardClick ? () => onDiscardClick(viewingPlayerId) : undefined}
          selectedPokemonId={selectedPokemonId}
          dropKindForTarget={dropKindForTarget}
          onHandDrop={onHandDrop}
          damageFloats={damageFloats}
        />
      </div>

      <HandBar
        game={game}
        hand={self.hand}
        selectedId={selectedHandId}
        onSelect={onHand}
        getQuickLabel={getHandQuickLabel}
        canDragHandCard={canDragHandCard}
        onHandDragStart={onHandDragStart}
        onHandDragEnd={onHandDragEnd}
        playerName={self.name}
      />

      {footer}
    </div>
  );
}
