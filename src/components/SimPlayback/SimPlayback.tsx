import { useCallback, useEffect, useRef, useState } from "react";
import { capturePresetSimulation } from "@/lib/deck/simulationCapture";
import { ALL_TOURNAMENTS } from "@/lib/deck/tournamentPresets";
import { useSimStore } from "@/stores/simStore";
import { getOpponentId, getPlayer } from "@/lib/engine";
import { PlayerId } from "@/lib/models/enums";
import { PlayerMat } from "@/components/GameBoard/PlayerMat";
import { TurnBanner } from "@/components/GameBoard/TurnBanner";
import { HandBar } from "@/components/GameBoard/HandBar";
import { BoardCard } from "@/components/GameBoard/BoardCard";
import { SimAnalysis } from "./SimAnalysis";

interface SimResult {
  winnerName: string | null;
  turnCount: number;
  frameCount: number;
  stalled: boolean;
}

const DEFAULT_TOURNAMENT = ALL_TOURNAMENTS[0]!;
const SPEEDS = [
  { label: "0.5×", ms: 2000 },
  { label: "1×", ms: 1000 },
  { label: "2×", ms: 500 },
  { label: "5×", ms: 200 },
  { label: "10×", ms: 100 },
];
const NOOP = () => {};

export function SimPlayback() {
  const { frames, currentIndex, isPlaying, speedMs, load, stepTo, stepDelta, play, pause, setSpeed } =
    useSimStore();

  const [tournament, setTournament] = useState(DEFAULT_TOURNAMENT);
  const decks = tournament.decks;
  const [p1Id, setP1Id] = useState(decks[1]?.id ?? "");
  const [p2Id, setP2Id] = useState(decks[7]?.id ?? "");
  const [seed, setSeed] = useState(42);
  const [noLimit, setNoLimit] = useState(false);
  const [running, setRunning] = useState(false);
  const [viewingId, setViewingId] = useState<PlayerId>(PlayerId.P1);
  const [result, setResult] = useState<SimResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleTournamentChange = useCallback((id: string) => {
    const t = ALL_TOURNAMENTS.find((t) => String(t.tournamentId) === id) ?? DEFAULT_TOURNAMENT;
    setTournament(t);
    setP1Id(t.decks[1]?.id ?? t.decks[0]?.id ?? "");
    setP2Id(t.decks[7]?.id ?? t.decks[t.decks.length - 1]?.id ?? "");
    setResult(null);
  }, []);

  // auto-advance timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isPlaying) return;
    timerRef.current = setTimeout(() => {
      if (currentIndex >= frames.length - 1) {
        pause();
      } else {
        stepDelta(1);
      }
    }, speedMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, speedMs, frames.length, stepDelta, pause]);

  const handleRun = useCallback(() => {
    const p1Preset = decks.find((d) => d.id === p1Id);
    const p2Preset = decks.find((d) => d.id === p2Id);
    if (!p1Preset || !p2Preset) return;
    setRunning(true);
    // run synchronously in next microtask so React can show the loading state
    setTimeout(() => {
      const captured = capturePresetSimulation(p1Preset, p2Preset, {
        seed,
        maxTurns: noLimit ? 500 : 30,
        maxActions: noLimit ? 2500 : 240,
      });
      load(captured, true);
      const lastState = captured.at(-1)?.state;
      setResult({
        winnerName: lastState?.winnerId ? getPlayer(lastState, lastState.winnerId).name : null,
        turnCount: lastState?.turnNumber ?? 0,
        frameCount: captured.length,
        stalled: !!lastState && !lastState.winnerId,
      });
      setRunning(false);
    }, 0);
  }, [p1Id, p2Id, seed, noLimit, load]);

  const currentFrame = frames[currentIndex];
  const game = currentFrame?.state ?? null;

  const selfId = viewingId;
  const opponentId = getOpponentId(selfId);
  const self = game ? getPlayer(game, selfId) : null;
  const opponent = game ? getPlayer(game, opponentId) : null;

  const total = frames.length;
  const winner = game?.winnerId ? getPlayer(game, game.winnerId).name : null;

  return (
    <div className="sim-screen">
      {/* Setup bar */}
      <div className="sim-setup">
        <select
          value={String(tournament.tournamentId)}
          onChange={(e) => handleTournamentChange(e.target.value)}
          className="sim-setup__tournament"
          title="Tournament"
        >
          {ALL_TOURNAMENTS.map((t) => (
            <option key={t.tournamentId} value={String(t.tournamentId)}>
              {t.name} ({t.date})
            </option>
          ))}
        </select>

        <select value={p1Id} onChange={(e) => setP1Id(e.target.value)} className="sim-setup__select">
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.deckName} ({d.placement}th)
            </option>
          ))}
        </select>

        <span className="sim-setup__vs">vs</span>

        <select value={p2Id} onChange={(e) => setP2Id(e.target.value)} className="sim-setup__select">
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.deckName} ({d.placement}th)
            </option>
          ))}
        </select>

        <label className="sim-setup__seed">
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
            className="sim-setup__seed-input"
          />
        </label>

        <label className="sim-setup__nolimit">
          <input
            type="checkbox"
            checked={noLimit}
            onChange={(e) => setNoLimit(e.target.checked)}
          />
          No turn limit
        </label>

        <button type="button" onClick={handleRun} disabled={running} className="sim-setup__run">
          {running ? "Running…" : "Run Simulation"}
        </button>
      </div>

      {/* Result banner */}
      {result && (
        <div className={`sim-result${result.winnerName ? "" : " sim-result--stall"}`}>
          {result.winnerName ? (
            <>
              <span className="sim-result__winner">Winner: {result.winnerName}</span>
              <span className="sim-result__meta">Turn {result.turnCount} · {result.frameCount} steps</span>
            </>
          ) : (
            <>
              <span className="sim-result__winner">Stalled (no winner)</span>
              <span className="sim-result__meta">Turn {result.turnCount} · {result.frameCount} steps</span>
            </>
          )}
          <button type="button" className="sim-result__replay" onClick={() => stepTo(0)}>
            ⏮ Replay from start
          </button>
        </div>
      )}

      {/* Board + Analysis */}
      {game && self && opponent && (
        <div className="sim-body">
          {/* Left: game board */}
          <div className="sim-board-area">
            <TurnBanner
              game={game}
              prompt={currentFrame?.label ?? ""}
              isMyTurn={game.currentPlayerId === selfId}
            />

            {/* Opponent's hand — sits above their board */}
            <HandBar
              game={game}
              hand={opponent.hand}
              onSelect={NOOP}
              playerName={opponent.name}
              isOpponent
            />

            <div className="play-screen__mat">
              <PlayerMat
                game={game}
                player={opponent}
                label={opponent.name}
                isOpponent
                isActiveTurn={game.currentPlayerId === opponentId}
                onPokemonSelect={NOOP}
              />

              <div className="play-screen__center">
                {game.stadium ? (
                  <div className="play-screen__stadium">
                    <span>Stadium</span>
                    <BoardCard state={game} card={game.stadium} size="mini" showName={false} />
                  </div>
                ) : (
                  <div className="play-screen__stadium play-screen__stadium--empty">Stadium</div>
                )}

                <ul className="play-log">
                  {game.log.slice(-8).map((entry, i) => (
                    <li key={`${i}-${entry}`}>{entry}</li>
                  ))}
                </ul>

                {winner && (
                  <p className="status-ok play-screen__winner">Winner: {winner}</p>
                )}
              </div>

              <PlayerMat
                game={game}
                player={self}
                label={self.name}
                isActiveTurn={game.currentPlayerId === selfId}
                onPokemonSelect={NOOP}
              />
            </div>

            {/* Self's hand — sits below their board */}
            <HandBar
              game={game}
              hand={self.hand}
              onSelect={NOOP}
              playerName={self.name}
            />
          </div>

          {/* Right: step-by-step analysis panel (toggleable) */}
          {showAnalysis && (
            <SimAnalysis
              frames={frames}
              currentIndex={currentIndex}
              onStepTo={(i) => { pause(); stepTo(i); }}
              game={game}
            />
          )}
        </div>
      )}

      {/* Controls */}
      {total > 0 && (
        <div className="sim-controls">
          <div className="sim-controls__buttons">
            <button type="button" onClick={() => stepTo(0)} title="First frame" disabled={currentIndex === 0}>
              ⏮
            </button>
            <button type="button" onClick={() => stepDelta(-1)} disabled={currentIndex === 0}>
              ◀
            </button>
            <button type="button" onClick={isPlaying ? pause : play} className="sim-controls__play">
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button type="button" onClick={() => stepDelta(1)} disabled={currentIndex >= total - 1}>
              ▶
            </button>
            <button type="button" onClick={() => stepTo(total - 1)} title="Last frame" disabled={currentIndex >= total - 1}>
              ⏭
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={total - 1}
            value={currentIndex}
            onChange={(e) => { pause(); stepTo(Number(e.target.value)); }}
            className="sim-controls__scrubber"
          />

          <span className="sim-controls__counter">
            {currentIndex + 1} / {total}
          </span>

          <select
            value={speedMs}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="sim-controls__speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>{s.label}</option>
            ))}
          </select>

          <button
            type="button"
            className="sim-controls__flip"
            onClick={() => setViewingId((id) => getOpponentId(id))}
            title="Flip perspective"
          >
            ⇄ Flip
          </button>

          <button
            type="button"
            className={`sim-controls__analysis-toggle${showAnalysis ? " is-active" : ""}`}
            onClick={() => setShowAnalysis((v) => !v)}
            title={showAnalysis ? "Hide analysis panel" : "Show analysis panel"}
          >
            {showAnalysis ? "✕ Analysis" : "📊 Analysis"}
          </button>

          {currentFrame && (
            <span className="sim-controls__label" title={currentFrame.label}>
              {currentFrame.label}
            </span>
          )}
        </div>
      )}

      {/* Empty state */}
      {total === 0 && !running && (
        <div className="sim-empty">
          <p>Select two decks and click <strong>Run Simulation</strong> to start.</p>
        </div>
      )}
    </div>
  );
}
