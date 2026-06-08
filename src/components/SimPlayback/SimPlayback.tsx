import { useCallback, useEffect, useRef, useState } from "react";
import { capturePresetSimulation, capturePresetPolicySimulation } from "@/lib/deck/simulationCapture";
import { ALL_TOURNAMENTS } from "@/lib/deck/tournamentPresets";
import { createBrowserLlmPolicy } from "@/lib/deck/llm/browserPolicy";
import { useSimStore } from "@/stores/simStore";
import { getOpponentId, getPlayer, type EngineState } from "@/lib/engine";
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

type AiKind = "heuristic" | "llm";

export function SimPlayback() {
  const {
    frames, currentIndex, isPlaying, speedMs, isLive,
    load, beginLive, pushFrame, endLive, stepTo, stepDelta, play, pause, setSpeed,
  } = useSimStore();

  const [tournament, setTournament] = useState(DEFAULT_TOURNAMENT);
  const decks = tournament.decks;
  const [p1Id, setP1Id] = useState(decks[1]?.id ?? "");
  const [p2Id, setP2Id] = useState(decks[7]?.id ?? "");
  const [seed, setSeed] = useState(42);
  const [noLimit, setNoLimit] = useState(false);
  const [aiKind, setAiKind] = useState<AiKind>("heuristic");
  const [running, setRunning] = useState(false);
  const [viewingId, setViewingId] = useState<PlayerId>(PlayerId.P1);
  const [result, setResult] = useState<SimResult | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Cancel flag for an in-flight async (LLM) capture, flipped when a new run
  // starts or the component unmounts.
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

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
        // At the latest frame. If a live (LLM) capture is still streaming, wait
        // for the next frame (this effect re-runs when frames.length grows);
        // otherwise the playback has reached the end → pause.
        if (!isLive) pause();
      } else {
        stepDelta(1);
      }
    }, speedMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, speedMs, frames.length, isLive, stepDelta, pause]);

  // Abort any in-flight LLM capture on unmount.
  useEffect(() => () => { cancelRef.current.cancelled = true; }, []);

  const finishResult = useCallback((frames2: { state: EngineState }[]) => {
    const lastState = frames2.at(-1)?.state;
    setResult({
      winnerName: lastState?.winnerId ? getPlayer(lastState, lastState.winnerId).name : null,
      turnCount: lastState?.turnNumber ?? 0,
      frameCount: frames2.length,
      stalled: !!lastState && !lastState.winnerId,
    });
  }, []);

  const handleRun = useCallback(() => {
    const p1Preset = decks.find((d) => d.id === p1Id);
    const p2Preset = decks.find((d) => d.id === p2Id);
    if (!p1Preset || !p2Preset) return;

    // Cancel any previous in-flight LLM capture.
    cancelRef.current.cancelled = true;
    const cancelToken = { cancelled: false };
    cancelRef.current = cancelToken;

    setResult(null);
    setRunning(true);
    const maxTurns = noLimit ? 500 : 30;
    const maxActions = noLimit ? 2500 : 240;

    if (aiKind === "heuristic") {
      // Synchronous heuristic capture → load all frames, then auto-play.
      setTimeout(() => {
        const captured = capturePresetSimulation(p1Preset, p2Preset, { seed, maxTurns, maxActions });
        load(captured, false);
        finishResult(captured);
        setRunning(false);
        play();
      }, 0);
      return;
    }

    // LLM agents: stream frames live as the two agents think.
    beginLive();
    const p1Policy = createBrowserLlmPolicy();
    const p2Policy = createBrowserLlmPolicy();
    void capturePresetPolicySimulation(p1Preset, p2Preset, p1Policy, p2Policy, {
      seed,
      maxTurns,
      maxActions,
      onFrame: (frame) => {
        if (!cancelToken.cancelled) pushFrame(frame);
      },
      cancel: () => cancelToken.cancelled,
    })
      .then((captured) => {
        if (cancelToken.cancelled) return;
        finishResult(captured);
      })
      .catch(() => {
        // LlmPolicy already falls back to heuristic internally; this guards any
        // unexpected error so the UI never gets stuck "running".
      })
      .finally(() => {
        if (cancelToken.cancelled) return;
        endLive();
        setRunning(false);
      });
  }, [p1Id, p2Id, seed, noLimit, aiKind, decks, load, play, beginLive, pushFrame, endLive, finishResult]);

  const currentFrame = frames[currentIndex];
  const game = currentFrame?.state ?? null;

  const selfId = viewingId;
  const opponentId = getOpponentId(selfId);
  const self = game ? getPlayer(game, selfId) : null;
  const opponent = game ? getPlayer(game, opponentId) : null;

  const total = frames.length;
  const winner = game?.winnerId ? getPlayer(game, game.winnerId).name : null;
  // Only reveal the final outcome once the live playback has reached the end —
  // showing it up-front would spoil the AI-vs-AI match.
  const atEnd = total > 0 && currentIndex >= total - 1;

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

        <select
          value={aiKind}
          onChange={(e) => setAiKind(e.target.value as AiKind)}
          className="sim-setup__select sim-setup__ai"
          title="Which AI drives both players"
        >
          <option value="heuristic">AI: Heuristic</option>
          <option value="llm">AI: LLM agent</option>
        </select>

        <button type="button" onClick={handleRun} disabled={running} className="sim-setup__run">
          {running ? (aiKind === "llm" ? "Thinking…" : "Running…") : "Run Simulation"}
        </button>
      </div>

      {/* Result banner. While the match is still playing/streaming we show a
          live progress line (no spoiler); the outcome appears only once
          playback reaches the final frame. */}
      {(result || isLive) && (() => {
        // "In progress" = capture still streaming, OR playback hasn't reached
        // the end of a finished capture yet.
        const inProgress = isLive || !atEnd;
        const tag = aiKind === "llm" ? "AI vs AI · LLM" : "AI vs AI";
        return (
          <div
            className={`sim-result${inProgress ? " sim-result--live" : result?.winnerName ? "" : " sim-result--stall"}`}
          >
            {inProgress ? (
              <>
                <span className="sim-result__winner">
                  {isPlaying ? `▶ Live · ${tag}` : `⏸ Paused · ${tag}`}
                </span>
                <span className="sim-result__meta">
                  Turn {game?.turnNumber ?? 0} · step {currentIndex + 1} / {total}
                  {isLive ? " · thinking…" : ""}
                </span>
              </>
            ) : result?.winnerName ? (
              <>
                <span className="sim-result__winner">Winner: {result.winnerName}</span>
                <span className="sim-result__meta">Turn {result.turnCount} · {result.frameCount} steps</span>
              </>
            ) : (
              <>
                <span className="sim-result__winner">Stalled (no winner)</span>
                <span className="sim-result__meta">Turn {result?.turnCount ?? 0} · {result?.frameCount ?? 0} steps</span>
              </>
            )}
            {!isLive && (
              <button
                type="button"
                className="sim-result__replay"
                onClick={() => { stepTo(0); play(); }}
              >
                ⏮ Replay from start
              </button>
            )}
          </div>
        );
      })()}

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
