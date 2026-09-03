import { GamePhase } from "@/lib/models/enums";
import type { EngineState } from "@/lib/engine";

interface TurnPhaseBarProps {
  game: EngineState;
  isMyTurn: boolean;
}

const PHASES: { id: string; label: string; phases: GamePhase[] }[] = [
  { id: "setup", label: "Setup", phases: [GamePhase.Setup, GamePhase.Mulligan, GamePhase.PlaceActive, GamePhase.PlaceBench] },
  { id: "main", label: "Main", phases: [GamePhase.Active] },
  { id: "done", label: "Match", phases: [GamePhase.Finished] },
];

export function TurnPhaseBar({ game, isMyTurn }: TurnPhaseBarProps) {
  const activeId = PHASES.find((step) => step.phases.includes(game.phase))?.id ?? "main";

  return (
    <div className={`turn-phase-bar${isMyTurn ? " turn-phase-bar--active" : ""}`} aria-label="Turn phase">
      {PHASES.map((step, index) => {
        const isActive = step.id === activeId;
        const isPast = PHASES.findIndex((s) => s.id === activeId) > index;
        return (
          <div
            key={step.id}
            className={`turn-phase-bar__step${isActive ? " turn-phase-bar__step--current" : ""}${isPast ? " turn-phase-bar__step--past" : ""}`}
          >
            <span className="turn-phase-bar__dot" />
            <span className="turn-phase-bar__label">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
