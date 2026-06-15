import { Fragment, useEffect, useRef } from "react";
import { getDefinition, getPlayer, remainingHp } from "@/lib/engine";
import { PlayerId } from "@/lib/models/enums";
import type { EngineState, PlayerState } from "@/lib/engine";
import type { ActionCategory, SimFrame } from "@/lib/deck/simulationCapture";
import { deriveInsight } from "./deriveInsight";

// ─── Category metadata ────────────────────────────────────────────────────────

interface CatMeta {
  icon: string;
  label: string;
  color: string;
}

const CAT: Record<ActionCategory, CatMeta> = {
  start:   { icon: "🎮", label: "Start",    color: "#6ee7b7" },
  trainer: { icon: "🃏", label: "Trainer",  color: "#60a5fa" },
  basic:   { icon: "🐣", label: "Play",     color: "#34d399" },
  evolve:  { icon: "🔄", label: "Evolve",   color: "#a78bfa" },
  energy:  { icon: "⚡", label: "Energy",   color: "#fbbf24" },
  ability: { icon: "✨", label: "Ability",  color: "#c084fc" },
  retreat: { icon: "🔀", label: "Retreat",  color: "#f97316" },
  attack:  { icon: "⚔️", label: "Attack",   color: "#f87171" },
  endturn: { icon: "⏩", label: "End Turn", color: "#64748b" },
  resolve: { icon: "🔧", label: "Resolve",  color: "#a8a29e" },
};

// ─── Player summary sub-component ────────────────────────────────────────────

function PlayerSummary({
  player,
  state,
  isCurrentTurn,
}: {
  player: PlayerState;
  state: EngineState;
  isCurrentTurn: boolean;
}) {
  const active = player.active;
  const activeDef = active ? getDefinition(state, active.definitionId) : null;
  const hp = active ? remainingHp(state, active) : 0;
  const maxHp = parseInt(activeDef?.hp ?? "0", 10) || 0;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  const hpColor = hpPct > 0.5 ? "#34d399" : hpPct > 0.25 ? "#fbbf24" : "#f87171";

  return (
    <div className={`sim-analysis__player${isCurrentTurn ? " is-active-turn" : ""}`}>
      <div className="sim-analysis__player-row">
        {isCurrentTurn && <span className="sim-analysis__turn-dot">▶</span>}
        <span className="sim-analysis__player-name">{player.name}</span>
        <span className="sim-analysis__prizes" title="Prize cards remaining">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`sim-analysis__prize-pip${i < player.prizes.length ? " is-filled" : ""}`}
            />
          ))}
        </span>
      </div>

      {active ? (
        <div className="sim-analysis__active">
          <div className="sim-analysis__active-top">
            <span className="sim-analysis__active-name">{activeDef?.name ?? "?"}</span>
            <span className="sim-analysis__active-hp" style={{ color: hpColor }}>
              {hp}/{maxHp}
            </span>
          </div>
          <div className="sim-analysis__hpbar">
            <div
              className="sim-analysis__hpbar-fill"
              style={{ width: `${hpPct * 100}%`, background: hpColor }}
            />
          </div>
          <div className="sim-analysis__active-tags">
            {active.attachedEnergy.length > 0 && (
              <span className="sim-analysis__tag sim-analysis__tag--energy">⚡ {active.attachedEnergy.length}</span>
            )}
            {active.damageCounters > 0 && (
              <span className="sim-analysis__tag sim-analysis__tag--dmg">💢 {active.damageCounters * 10}</span>
            )}
            {(active.statusConditions ?? []).map((s) => (
              <span key={s} className="sim-analysis__tag sim-analysis__tag--status">{s}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="sim-analysis__active sim-analysis__active--empty">No active Pokémon</div>
      )}

      <div className="sim-analysis__bench-row">
        <span className="sim-analysis__bench-label">Bench {player.bench.length}</span>
        {player.bench.map((p) => {
          const def = getDefinition(state, p.definitionId);
          return (
            <span key={p.instanceId} className="sim-analysis__bench-dot" title={def?.name ?? "?"}>
              {p.attachedEnergy.length > 0 ? "⚡" : "•"}
            </span>
          );
        })}
        <span className="sim-analysis__hand-count">🖐 {player.hand.length}</span>
      </div>
    </div>
  );
}

// ─── Main analysis panel ──────────────────────────────────────────────────────

interface SimAnalysisProps {
  frames: SimFrame[];
  currentIndex: number;
  onStepTo: (index: number) => void;
  game: EngineState;
}

export function SimAnalysis({ frames, currentIndex, onStepTo, game }: SimAnalysisProps) {
  const currentItemRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the timeline to keep the current step visible
  useEffect(() => {
    currentItemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  const frame = frames[currentIndex];
  if (!frame) return null;

  const prevFrame = frames[currentIndex - 1];
  // Show all new log entries added by this frame
  const logDelta =
    prevFrame
      ? frame.state.log.slice(prevFrame.state.log.length)
      : frame.state.log.slice(0, 4);

  const cat = CAT[frame.category];
  const insight = deriveInsight(prevFrame?.state, frame.state, frame.category, frame.label, logDelta);
  const actorName = getPlayer(frame.state, prevFrame?.state.currentPlayerId ?? frame.state.currentPlayerId).name;
  const p1 = getPlayer(game, PlayerId.P1);
  const p2 = getPlayer(game, PlayerId.P2);

  return (
    <aside className="sim-analysis">
      {/* ── Step header ────────────────────────────────────────── */}
      <div className="sim-analysis__header">
        <span className="sim-analysis__step-num">Step {currentIndex + 1} / {frames.length}</span>
        <span className="sim-analysis__turn-num">Turn {game.turnNumber}</span>
      </div>

      {/* ── Current action ─────────────────────────────────────── */}
      <div
        className="sim-analysis__action"
        style={{ borderLeftColor: cat.color, ["--cat-color" as string]: cat.color }}
      >
        <span className="sim-analysis__action-icon" style={{ background: `${cat.color}22` }}>
          {cat.icon}
        </span>
        <div className="sim-analysis__action-body">
          <span className="sim-analysis__action-type" style={{ color: cat.color }}>
            {cat.label}
            <span className="sim-analysis__action-actor">{actorName}</span>
          </span>
          <p className="sim-analysis__action-label">{frame.label}</p>
        </div>
      </div>

      {/* ── AI reasoning ("thinking") ──────────────────────────── */}
      <div className="sim-analysis__think" style={{ ["--cat-color" as string]: cat.color }}>
        <span className="sim-analysis__think-icon">💭</span>
        <span className="sim-analysis__think-text">{insight.reasoning}</span>
      </div>
      {insight.badges.length > 0 && (
        <div className="sim-analysis__badges">
          {insight.badges.map((b, i) => (
            <span key={i} className={`sim-analysis__badge sim-analysis__badge--${b.tone}`}>
              <span className="sim-analysis__badge-icon">{b.icon}</span>
              {b.text}
            </span>
          ))}
        </div>
      )}

      {/* ── Log delta ──────────────────────────────────────────── */}
      {logDelta.length > 0 && (
        <div className="sim-analysis__section">
          <div className="sim-analysis__section-title">สิ่งที่เกิดขึ้น</div>
          <ul className="sim-analysis__log-list">
            {logDelta.map((entry, i) => (
              <li key={i} className="sim-analysis__log-entry">{entry}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Board state ────────────────────────────────────────── */}
      <div className="sim-analysis__section">
        <div className="sim-analysis__section-title">สถานะบอร์ด</div>
        <PlayerSummary player={p1} state={game} isCurrentTurn={game.currentPlayerId === PlayerId.P1} />
        <PlayerSummary player={p2} state={game} isCurrentTurn={game.currentPlayerId === PlayerId.P2} />
      </div>

      {/* ── Timeline ───────────────────────────────────────────── */}
      <div className="sim-analysis__section sim-analysis__timeline-section">
        <div className="sim-analysis__section-title">Timeline</div>
        <div className="sim-analysis__timeline" ref={timelineRef}>
          {frames.map((f, i) => {
            const prevF = frames[i - 1];
            const isTurnStart = !prevF || f.state.turnNumber !== prevF.state.turnNumber;
            const meta = CAT[f.category];
            const isCurrent = i === currentIndex;
            return (
              <Fragment key={i}>
                {isTurnStart && (
                  <div className="sim-analysis__turn-header">
                    Turn {f.state.turnNumber}
                    {" · "}
                    {getPlayer(f.state, f.state.currentPlayerId).name}
                  </div>
                )}
                <button
                  ref={isCurrent ? currentItemRef : undefined}
                  className={`sim-analysis__tl-item${isCurrent ? " is-current" : ""}${f.category === "endturn" ? " is-endturn" : ""}`}
                  onClick={() => onStepTo(i)}
                  title={f.label}
                >
                  <span className="sim-analysis__tl-icon" style={{ color: isCurrent ? meta.color : undefined }}>
                    {meta.icon}
                  </span>
                  <span className="sim-analysis__tl-label">{f.label}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Jump buttons ───────────────────────────────────────── */}
      <div className="sim-analysis__jumps">
        <button
          className="sim-analysis__jump-btn"
          onClick={() => {
            // find prev attack frame
            let i = currentIndex - 1;
            while (i >= 0 && frames[i]!.category !== "attack") i--;
            if (i >= 0) onStepTo(i);
          }}
          title="Jump to previous attack"
        >
          ⚔️ ◀
        </button>
        <button
          className="sim-analysis__jump-btn"
          onClick={() => {
            // find next attack frame
            let i = currentIndex + 1;
            while (i < frames.length && frames[i]!.category !== "attack") i++;
            if (i < frames.length) onStepTo(i);
          }}
          title="Jump to next attack"
        >
          ▶ ⚔️
        </button>
        <button
          className="sim-analysis__jump-btn"
          onClick={() => {
            // find next turn start
            const cur = game.turnNumber;
            let i = currentIndex + 1;
            while (i < frames.length && frames[i]!.state.turnNumber <= cur) i++;
            if (i < frames.length) onStepTo(i);
          }}
          title="Jump to next turn"
        >
          ▶ Turn
        </button>
      </div>
    </aside>
  );
}
