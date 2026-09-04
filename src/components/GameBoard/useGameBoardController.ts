import { useEffect, useMemo, useState } from "react";
import { GamePhase } from "@/lib/models/enums";
import {
  canStartActiveGame,
  getLegalActions,
  getPlayer,
  type EngineState,
  type GameAction,
} from "@/lib/engine";
import { Zone } from "@/lib/models/enums";
import type { CardInstance } from "@/lib/models/instance";
import { buildPokemonActions } from "./CardActionMenu";
import { getPendingPrompt } from "@/lib/ui/trainerHints";

export type SelectionMode = "none" | "attach-energy" | "evolve" | "target";

export function useGameBoardController(
  engineState: EngineState | null,
  dispatch: (action: GameAction) => void,
) {
  const [selectedHandCard, setSelectedHandCard] = useState<CardInstance | null>(null);
  const [selectedBoardPokemon, setSelectedBoardPokemon] = useState<CardInstance | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("none");
  const [targetPrompt, setTargetPrompt] = useState<string | null>(null);

  const legalActions = useMemo(
    () => (engineState ? getLegalActions(engineState) : []),
    [engineState],
  );

  useEffect(() => {
    if (!engineState) return;
    setSelectedHandCard(null);
    setSelectedBoardPokemon(null);
    setSelectionMode("none");
    setTargetPrompt(null);
  }, [engineState?.turnNumber, engineState?.currentPlayerId, engineState?.phase]);

  function clearSelection() {
    setSelectedHandCard(null);
    setSelectedBoardPokemon(null);
    setSelectionMode("none");
    setTargetPrompt(null);
  }

  function runAction(action: GameAction) {
    dispatch(action);
    clearSelection();
  }

  function getPhasePrompt(game: EngineState, isMyTurn: boolean, currentName: string): string {
    switch (game.phase) {
      case GamePhase.Mulligan:
        return `${getPlayer(game, game.pendingMulliganPlayerId!).name} may mulligan if no Basic Pokémon in hand.`;
      case GamePhase.PlaceActive:
        return "Click a Basic Pokémon in your hand → Place as Active.";
      case GamePhase.PlaceBench:
        return "Optionally place Basics on Bench, then press Start Game.";
      case GamePhase.Active:
        if (game.pendingAction?.type === "BOSS_ORDERS") {
          return "Boss's Orders: click one of your opponent's Benched Pokémon.";
        }
        if (game.pendingAction?.type === "PROMOTE") {
          return `${getPlayer(game, game.pendingAction.playerId).name} must promote a Benched Pokémon to Active.`;
        }
        if (game.pendingAction?.type === "ULTRA_BALL_DISCARD") {
          return getPendingPrompt(game.pendingAction) ?? "Ultra Ball: choose cards to discard.";
        }
        if (game.pendingAction?.type === "RARE_CANDY") {
          return "Rare Candy: click an eligible Basic Pokémon in play.";
        }
        if (game.pendingAction?.type === "CRUSHING_HAMMER") {
          return "Crushing Hammer: click an Energy on your opponent's Pokémon to discard.";
        }
        if (game.pendingAction?.type === "DISTRIBUTE_BENCH_DAMAGE") {
          return `Place ${game.pendingAction.countersRemaining} more damage counter(s) on opponent's Bench (click a Benched Pokémon).`;
        }
        if (game.pendingAction?.type === "MOVE_DAMAGE") {
          return game.pendingAction.step === "SOURCE"
            ? "Choose a Pokémon to move damage from."
            : "Choose a Pokémon to move damage to.";
        }
        if (game.pendingAction?.type === "CHOOSE_BENCH_DAMAGE") {
          return "Choose a Benched Pokémon to damage.";
        }
        if (game.pendingAction?.type === "ABILITY_DISCARD_HAND") {
          return `${game.pendingAction.abilityName}: discard a card from your hand.`;
        }
        if (game.pendingAction?.type === "ABILITY_DISCARD_HAND_ENERGY") {
          return `${game.pendingAction.abilityName}: discard a Basic ${game.pendingAction.energyType} Energy from your hand.`;
        }
        if (game.pendingAction?.type === "COPY_BENCH_ATTACK") {
          return "Night Joker: choose a Benched N's Pokémon's attack to copy.";
        }
        if (game.pendingAction?.type === "CHOOSE_OPPONENT_POKEMON_DAMAGE") {
          return `Choose one of your opponent's Pokémon to place ${game.pendingAction.amount} damage counter(s) on.`;
        }
        if (game.pendingAction?.type === "RECON_DIRECTIVE") {
          return getPendingPrompt(game.pendingAction) ?? "Recon Directive: choose 1 of the top 2 cards of your deck.";
        }
        if (game.pendingAction?.type === "SWITCH_WITH_BENCH") {
          return "Choose a Benched Pokémon to switch with Active.";
        }
        if (game.pendingAction?.type === "MOVE_ENERGY_TO_BENCH") {
          return "Choose a Benched Pokémon to move Energy to.";
        }
        if (game.pendingAction?.type === "GIOVANNI") {
          return game.pendingAction.step === "OWN_BENCH"
            ? "Giovanni: choose your Team Rocket's Benched Pokémon to switch with your Active."
            : "Giovanni: choose an opponent's Benched Pokémon to force into the Active Spot.";
        }
        if (game.pendingAction?.type === "PRIME_CATCHER") {
          return game.pendingAction.step === "OPPONENT_BENCH"
            ? "Prime Catcher: choose an opponent's Benched Pokémon to force into the Active Spot."
            : "Prime Catcher: choose your Benched Pokémon to switch with your Active.";
        }
        {
          const pendingHint = getPendingPrompt(game.pendingAction);
          if (pendingHint) return pendingHint;
        }
        if (targetPrompt) return targetPrompt;
        if (game.itemPlayBlockedForPlayerId === game.viewingPlayerId && isMyTurn) {
          return "Itchy Pollen — you can't play Item cards from your hand this turn.";
        }
        return isMyTurn
          ? "Your turn — click a Pokémon in play or a card in your hand."
          : `${currentName} is waiting. Press Jump to current player or Switch side.`;
      default:
        return "";
    }
  }

  function handleHandSelect(card: CardInstance) {
    if (engineState?.pendingAction?.type === "ULTRA_BALL_DISCARD") {
      const action = legalActions.find(
        (entry) => entry.type === "SELECT_HAND_DISCARD" && entry.instanceId === card.instanceId,
      );
      if (action) runAction(action);
      return;
    }
    if (engineState?.pendingAction?.type === "CRISPIN_DISCARD") {
      const action = legalActions.find(
        (entry) => entry.type === "CRISPIN_OPTIONAL_DISCARD" && entry.instanceId === card.instanceId,
      );
      if (action) runAction(action);
      return;
    }
    if (
      engineState?.pendingAction?.type === "ABILITY_DISCARD_HAND" ||
      engineState?.pendingAction?.type === "ABILITY_DISCARD_HAND_ENERGY"
    ) {
      const action = legalActions.find(
        (entry) => entry.type === "SELECT_HAND_DISCARD" && entry.instanceId === card.instanceId,
      );
      if (action) runAction(action);
      return;
    }
    setSelectedBoardPokemon(null);
    setSelectedHandCard(card);
    setSelectionMode("none");
    setTargetPrompt(null);
  }

  function handleHandAction(action: GameAction) {
    if (action.type === "ATTACH_ENERGY" && !action.targetId && engineState) {
      setSelectionMode("attach-energy");
      const player = getPlayer(engineState, action.playerId);
      const energyDef = engineState.definitions[
        player.hand.find((c) => c.instanceId === action.energyId)?.definitionId ?? ""
      ];
      const targetNames = legalActions
        .filter(
          (entry): entry is Extract<GameAction, { type: "ATTACH_ENERGY" }> =>
            entry.type === "ATTACH_ENERGY" &&
            entry.energyId === action.energyId &&
            Boolean(entry.targetId),
        )
        .map((entry) => {
          const target =
            player.active?.instanceId === entry.targetId
              ? player.active
              : player.bench.find((b) => b.instanceId === entry.targetId);
          if (!target) return null;
          const def = engineState.definitions[target.definitionId];
          const slot = player.active?.instanceId === entry.targetId ? "Active" : "Bench";
          return `${def?.name ?? "Pokémon"} (${slot})`;
        })
        .filter(Boolean);
      const energyLabel = energyDef?.name ?? "Energy";
      setTargetPrompt(
        targetNames.length > 0
          ? `Attach ${energyLabel} to: ${targetNames.join(", ")}`
          : `Choose one of your Pokémon to attach ${energyLabel}.`,
      );
      return;
    }
    if (action.type === "EVOLVE") {
      setSelectionMode("evolve");
      setTargetPrompt("Choose a Pokémon to evolve.");
      return;
    }
    runAction(action);
  }

  function handlePokemonSelect(game: EngineState, card: CardInstance) {
    if (selectionMode === "attach-energy" && selectedHandCard) {
      const attachAction = legalActions.find(
        (entry) =>
          entry.type === "ATTACH_ENERGY" &&
          entry.energyId === selectedHandCard.instanceId &&
          entry.targetId === card.instanceId,
      );
      if (attachAction) runAction(attachAction);
      return;
    }

    if (selectionMode === "evolve" && selectedHandCard) {
      const evolveAction = legalActions.find(
        (entry) =>
          entry.type === "EVOLVE" &&
          entry.evolutionId === selectedHandCard.instanceId &&
          entry.targetId === card.instanceId,
      );
      if (evolveAction) runAction(evolveAction);
      return;
    }

    const def = game.definitions[card.definitionId];
    if (!def || card.zone === Zone.Hand) return;

    const pokemonActions = buildPokemonActions(card, def, legalActions, game);

    if (game.pendingAction && pokemonActions.length === 1) {
      runAction(pokemonActions[0]!.action);
      return;
    }

    setSelectedHandCard(null);
    setSelectedBoardPokemon(card);
    setSelectionMode("none");
    setTargetPrompt(null);
  }

  function isTargetHighlight(game: EngineState): boolean {
    if (selectionMode === "attach-energy" || selectionMode === "evolve") return true;
    if (!game.pendingAction) return false;
    return [
      "BOSS_ORDERS",
      "PROMOTE",
      "RARE_CANDY",
      "CRUSHING_HAMMER",
      "CRISPIN_ATTACH",
      "DISTRIBUTE_BENCH_DAMAGE",
      "MOVE_DAMAGE",
      "CHOOSE_BENCH_DAMAGE",
      "SWITCH_WITH_BENCH",
      "MOVE_ENERGY_TO_BENCH",
      "GIOVANNI",
      "PRIME_CATCHER",
      "CHOOSE_OPPONENT_POKEMON_DAMAGE",
    ].includes(game.pendingAction.type);
  }

  return {
    selectedHandCard,
    selectedBoardPokemon,
    selectionMode,
    targetPrompt,
    legalActions,
    clearSelection,
    runAction,
    getPhasePrompt,
    handleHandSelect,
    handleHandAction,
    handlePokemonSelect,
    isTargetHighlight,
    canStart: engineState ? canStartActiveGame(engineState) : false,
  };
}
