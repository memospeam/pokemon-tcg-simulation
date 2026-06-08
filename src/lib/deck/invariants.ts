/**
 * Game-state invariant checker — a bug-finding tool.
 *
 * The engine never asserts that its state is *legal*: illegal states (a card in
 * two zones, an over-full bench, two Supporters in one turn) just happen
 * silently. These pure analyzers turn such states into explicit, reproducible
 * violations. They run over the per-action frames produced by
 * capturePresetSimulation() — no engine/runner changes required.
 *
 * Two layers:
 *   • checkStateInvariants(state, startCounts) — properties that must hold of a
 *     single state snapshot (run on every frame).
 *   • checkTurnInvariants(frames) — per-turn rules that need the action sequence
 *     (e.g. at most one Supporter per turn).
 */
import { PlayerId, Zone } from "../models/enums";
import {
  isCarmineCard,
  isProtonSupporter,
  isSupporter,
  isTool,
} from "../models/definition";
import type { CardInstance } from "../models/instance";
import { getDefinition, getPlayer, type EngineState } from "../engine/types";
import { getMaxBenchSize } from "../engine/effects/stadiumEffects";
import type { SimFrame } from "./simulationCapture";

export interface Violation {
  /** Stable machine-readable category, e.g. "duplicate-instance". */
  kind: string;
  /** Human-readable detail with names/ids for triage. */
  detail: string;
  severity: "hard" | "soft";
  turnNumber?: number;
}

const PLAYER_IDS: PlayerId[] = [PlayerId.P1, PlayerId.P2];

function defName(state: EngineState, inst: CardInstance): string {
  return getDefinition(state, inst.definitionId)?.name ?? inst.definitionId;
}

/** Walk a top-level instance plus everything attached to it (energy, tools). */
function* walkInstance(inst: CardInstance): Generator<CardInstance> {
  yield inst;
  for (const e of inst.attachedEnergy) yield* walkInstance(e);
  for (const t of inst.attachedTools) yield* walkInstance(t);
}

/** Count every card instance (including attached) grouped by owner. */
export function countInstancesByOwner(state: EngineState): Record<PlayerId, number> {
  const counts = { [PlayerId.P1]: 0, [PlayerId.P2]: 0 } as Record<PlayerId, number>;
  const bump = (inst: CardInstance) => {
    for (const i of walkInstance(inst)) counts[i.ownerId] = (counts[i.ownerId] ?? 0) + 1;
  };
  for (const pid of PLAYER_IDS) {
    const p = getPlayer(state, pid);
    if (p.active) bump(p.active);
    for (const arr of [p.deck, p.hand, p.bench, p.discard, p.prizes, p.lostZone]) {
      for (const inst of arr) bump(inst);
    }
  }
  if (state.stadium) for (const i of walkInstance(state.stadium)) counts[i.ownerId]++;
  if (state.heldCard) for (const i of walkInstance(state.heldCard)) counts[i.ownerId]++;
  return counts;
}

/**
 * Invariants that must hold of a single state snapshot.
 * `startCounts` (from frame 0) enables the card-conservation check.
 */
export function checkStateInvariants(
  state: EngineState,
  startCounts?: Record<PlayerId, number>,
): Violation[] {
  const v: Violation[] = [];
  const tn = state.turnNumber;
  const seen = new Map<string, string>(); // instanceId -> first location

  const visit = (inst: CardInstance, location: string) => {
    for (const i of walkInstance(inst)) {
      const prev = seen.get(i.instanceId);
      if (prev !== undefined) {
        v.push({
          kind: "duplicate-instance",
          severity: "hard",
          turnNumber: tn,
          detail: `${defName(state, i)} (${i.instanceId.slice(0, 8)}) appears in both ${prev} and ${location}`,
        });
      } else {
        seen.set(i.instanceId, location);
      }
    }
  };

  for (const pid of PLAYER_IDS) {
    const p = getPlayer(state, pid);

    // Top-level zone arrays — also verify the instance's own .zone tag matches.
    const zoneArrays: [CardInstance[], Zone, string][] = [
      [p.deck, Zone.Deck, "deck"],
      [p.hand, Zone.Hand, "hand"],
      [p.bench, Zone.Bench, "bench"],
      [p.discard, Zone.Discard, "discard"],
      [p.prizes, Zone.Prizes, "prizes"],
      [p.lostZone, Zone.LostZone, "lostZone"],
    ];
    if (p.active) {
      visit(p.active, `${pid}.active`);
      if (p.active.zone !== Zone.Active) {
        v.push({ kind: "zone-tag-mismatch", severity: "hard", turnNumber: tn, detail: `${defName(state, p.active)} is the Active but zone=${p.active.zone}` });
      }
    }
    for (const [arr, zone, name] of zoneArrays) {
      for (const inst of arr) {
        visit(inst, `${pid}.${name}`);
        if (inst.zone !== zone) {
          v.push({ kind: "zone-tag-mismatch", severity: "hard", turnNumber: tn, detail: `${defName(state, inst)} is in ${pid}.${name} but zone=${inst.zone}` });
        }
      }
    }

    // Attachment-type sanity over the in-play Pokémon.
    const inPlay = [...(p.active ? [p.active] : []), ...p.bench];
    for (const mon of inPlay) {
      for (const e of mon.attachedEnergy) {
        if (getDefinition(state, e.definitionId)?.supertype !== "Energy") {
          v.push({ kind: "non-energy-attached", severity: "hard", turnNumber: tn, detail: `${defName(state, e)} attached as Energy to ${defName(state, mon)}` });
        }
      }
      for (const t of mon.attachedTools) {
        const td = getDefinition(state, t.definitionId);
        if (td && !isTool(td)) {
          v.push({ kind: "non-tool-attached", severity: "hard", turnNumber: tn, detail: `${td.name} attached as a Tool to ${defName(state, mon)}` });
        }
      }
    }
    // Unresolved-KO (soft): a BENCHED Pokémon at/over its HP should always be
    // cleaned up by resolveBenchKnockouts. The Active is intentionally excluded
    // — it can legitimately sit at lethal damage mid-attack-resolution before
    // the KO is processed.
    for (const mon of p.bench) {
      const hp = parseInt(getDefinition(state, mon.definitionId)?.hp ?? "0", 10) || 0;
      if (hp > 0 && mon.damageCounters * 10 >= hp) {
        v.push({ kind: "unresolved-ko", severity: "soft", turnNumber: tn, detail: `benched ${defName(state, mon)} has ${mon.damageCounters * 10} damage ≥ ${hp} HP but wasn't KO'd` });
      }
    }

    // Bench size (honors bench-expanding stadiums via getMaxBenchSize).
    const maxBench = getMaxBenchSize(state, pid);
    if (p.bench.length > maxBench) {
      v.push({ kind: "bench-overflow", severity: "hard", turnNumber: tn, detail: `${pid} bench has ${p.bench.length} Pokémon (max ${maxBench})` });
    }

    // Prize range.
    if (p.prizes.length < 0 || p.prizes.length > 6) {
      v.push({ kind: "prize-range", severity: "hard", turnNumber: tn, detail: `${pid} has ${p.prizes.length} prizes (expected 0–6)` });
    }
  }

  if (state.stadium) visit(state.stadium, "stadium");
  if (state.heldCard) visit(state.heldCard, "heldCard");

  // Card conservation vs the game's starting counts.
  //   • An INCREASE means a card instance was created from nowhere — always a
  //     real duplication bug (hard).
  //   • A DECREASE is expected in this engine: evolution collapses the stack
  //     (transferPokemonStateOntoEvolution drops the pre-evolution instance
  //     rather than keeping it underneath), so cards are legitimately
  //     "consumed". Report it (soft) so genuine card-loss bugs still surface,
  //     without failing the gate on the known evolution simplification.
  if (startCounts) {
    const now = countInstancesByOwner(state);
    for (const pid of PLAYER_IDS) {
      if (now[pid] > startCounts[pid]) {
        v.push({ kind: "card-count-increased", severity: "hard", turnNumber: tn, detail: `${pid} has ${now[pid]} card instances, started with ${startCounts[pid]} (cards created)` });
      } else if (now[pid] < startCounts[pid]) {
        v.push({ kind: "card-count-decreased", severity: "soft", turnNumber: tn, detail: `${pid} has ${now[pid]} card instances, started with ${startCounts[pid]} (evolution drops pre-evo stacks)` });
      }
    }
  }

  return v;
}

/**
 * Per-turn rule invariants over the captured frame sequence. Frames are grouped
 * by turnNumber (each turnNumber is exactly one player's turn).
 */
export function checkTurnInvariants(frames: SimFrame[]): Violation[] {
  const v: Violation[] = [];
  if (frames.length === 0) return v;
  const defs = frames[0]!.state.definitions;
  const defsByName = new Map(Object.values(defs).map((d) => [d.name, d]));
  const supporterNames = new Set(Object.values(defs).filter((d) => isSupporter(d)).map((d) => d.name));

  interface TurnRec {
    supporters: string[];
    nonExemptSupporters: string[];
    manualEnergy: number;
    attacked: boolean;
    currentPlayer: PlayerId;
    firstPlayer: PlayerId;
  }
  const turns = new Map<number, TurnRec>();

  for (const f of frames) {
    const tn = f.state.turnNumber;
    let rec = turns.get(tn);
    if (!rec) {
      rec = { supporters: [], nonExemptSupporters: [], manualEnergy: 0, attacked: false, currentPlayer: f.state.currentPlayerId, firstPlayer: f.state.firstPlayerId };
      turns.set(tn, rec);
    }
    rec.currentPlayer = f.state.currentPlayerId;
    if (f.category === "energy") rec.manualEnergy += 1;
    if (f.category === "attack") rec.attacked = true;
    for (const line of f.logDelta) {
      const m = line.match(/played (.+?)\.?$/);
      if (m && supporterNames.has(m[1]!)) {
        rec.supporters.push(m[1]!);
        const d = defsByName.get(m[1]!);
        if (d && !isProtonSupporter(d) && !isCarmineCard(d)) rec.nonExemptSupporters.push(m[1]!);
      }
    }
  }

  for (const [tn, rec] of turns) {
    if (rec.supporters.length > 1) {
      v.push({ kind: "supporters-per-turn", severity: "hard", turnNumber: tn, detail: `${rec.supporters.length} Supporters played in one turn: ${rec.supporters.join(", ")}` });
    }
    if (rec.manualEnergy > 1) {
      v.push({ kind: "manual-energy-per-turn", severity: "soft", turnNumber: tn, detail: `${rec.manualEnergy} manual energy attachments in one turn` });
    }
    if (tn === 1 && rec.currentPlayer === rec.firstPlayer) {
      if (rec.nonExemptSupporters.length > 0) {
        v.push({ kind: "first-turn-supporter", severity: "hard", turnNumber: tn, detail: `first player played a non-exempt Supporter on turn 1: ${rec.nonExemptSupporters.join(", ")}` });
      }
      if (rec.attacked) {
        v.push({ kind: "first-turn-attack", severity: "hard", turnNumber: tn, detail: `first player attacked on turn 1` });
      }
    }
  }
  return v;
}

/** Convenience: run both checkers across a full captured match. */
export function checkMatchInvariants(frames: SimFrame[]): Violation[] {
  if (frames.length === 0) return [];
  const startCounts = countInstancesByOwner(frames[0]!.state);
  const out: Violation[] = [];
  for (const f of frames) out.push(...checkStateInvariants(f.state, startCounts));
  out.push(...checkTurnInvariants(frames));
  return out;
}
