import type { EngineState, GameAction } from "@/lib/engine";
import { getDefinition } from "@/lib/engine";
import type { PlayerId } from "@/lib/models/enums";
import {
  canUseCommunityCenter,
  canUseLumioseCity,
  getLumioseDeckOptions,
  getStadiumKind,
} from "@/lib/engine/effects/stadiumEffects";
import {
  canUseAcademyAtNight,
  canUseLevincia,
  canUseSpikemuthGym,
  canUseSurfingBeach,
} from "@/lib/engine/effects/stadiumOptionalEffects";
import { canUseGrandTree } from "@/lib/engine/effects/grandTreeEffects";

interface StadiumAbilityPanelProps {
  game: EngineState;
  viewingId: PlayerId;
  isMyTurn: boolean;
  onRun: (action: GameAction) => void;
}

function stadiumLabel(kind: ReturnType<typeof getStadiumKind>): string {
  switch (kind) {
    case "lumiose_city":
      return "Lumiose City";
    case "grand_tree":
      return "Grand Tree";
    case "community_center":
      return "Community Center";
    case "team_rocket_factory":
      return "Team Rocket's Factory";
    case "academy_at_night":
      return "Academy at Night";
    case "levincia":
      return "Levincia";
    case "spikemuth_gym":
      return "Spikemuth Gym";
    case "surfing_beach":
      return "Surfing Beach";
    default:
      return "Stadium";
  }
}

export function StadiumAbilityPanel({ game, viewingId, isMyTurn, onRun }: StadiumAbilityPanelProps) {
  if (!isMyTurn || game.pendingAction || game.winnerId) return null;

  const kind = getStadiumKind(game);
  const showFactory = game.turnFlags.trFactoryDrawAvailable;
  const showCommunity = canUseCommunityCenter(game, viewingId);
  const showLumiose = canUseLumioseCity(game, viewingId);
  const showGrandTree = canUseGrandTree(game, viewingId);
  const showAcademy = canUseAcademyAtNight(game, viewingId);
  const showLevincia = canUseLevincia(game, viewingId);
  const showSpikemuth = canUseSpikemuthGym(game, viewingId);
  const showSurfing = canUseSurfingBeach(game, viewingId);

  if (
    !showFactory &&
    !showCommunity &&
    !showLumiose &&
    !showGrandTree &&
    !showAcademy &&
    !showLevincia &&
    !showSpikemuth &&
    !showSurfing
  ) {
    return null;
  }

  const lumioseOptions = showLumiose ? getLumioseDeckOptions(game, viewingId) : [];

  return (
    <div className="stadium-ability-panel pending-panel pending-panel--compact pending-panel--top">
      <p className="stadium-ability-panel__title">{stadiumLabel(kind)} — optional ability</p>
      <div className="stadium-ability-panel__actions pending-panel__actions">
        {showFactory && (
          <>
            <button
              type="button"
              className="pending-panel__pick"
              onClick={() => onRun({ type: "USE_TR_FACTORY_DRAW", playerId: viewingId })}
            >
              Draw 2
            </button>
            <button
              type="button"
              className="pending-panel__skip"
              onClick={() => onRun({ type: "SKIP_OPTIONAL", playerId: viewingId })}
            >
              Skip
            </button>
          </>
        )}
        {showCommunity && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_COMMUNITY_CENTER", playerId: viewingId })}
          >
            Heal 10 from each Pokémon
          </button>
        )}
        {showAcademy && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_ACADEMY_AT_NIGHT", playerId: viewingId })}
          >
            Put hand card on deck top
          </button>
        )}
        {showLevincia && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_LEVINCIA", playerId: viewingId })}
          >
            Recover Lightning Energy (≤2)
          </button>
        )}
        {showSpikemuth && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_SPIKEMUTH_GYM", playerId: viewingId })}
          >
            Search Marnie's Pokémon
          </button>
        )}
        {showSurfing && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_SURFING_BEACH", playerId: viewingId })}
          >
            Switch Water Active
          </button>
        )}
        {showGrandTree && (
          <button
            type="button"
            className="pending-panel__pick"
            onClick={() => onRun({ type: "USE_GRAND_TREE", playerId: viewingId })}
          >
            Evolve from deck
          </button>
        )}
        {showLumiose &&
          lumioseOptions.map((card) => {
            const def = getDefinition(game, card.definitionId);
            return (
              <button
                key={card.instanceId}
                type="button"
                className="pending-panel__pick"
                onClick={() =>
                  onRun({ type: "USE_LUMIOSE_CITY", playerId: viewingId, instanceId: card.instanceId })
                }
              >
                Bench {def?.name ?? "Basic"} (ends turn)
              </button>
            );
          })}
      </div>
    </div>
  );
}
