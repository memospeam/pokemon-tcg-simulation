/**
 * Build the text observation + candidate-action list that an LLM agent reads
 * to choose a move. The "knowledge source" wired in here is **card effect
 * text** — every card shown to the model includes its attacks' and abilities'
 * rules text, so the LLM decides with the actual card behaviour in view.
 */
import { getLegalActions } from "../../engine/reducer";
import {
  getDefinition,
  getOpponentId,
  getPlayer,
  remainingHp,
  type EngineState,
  type GameAction,
} from "../../engine/types";
import type { CardDefinition } from "../../models/definition";
import type { CardInstance } from "../../models/instance";
import type { PlayerId } from "../../models/enums";

/** Main-phase action types the LLM chooses among (sub-choices stay heuristic). */
const MAIN_PHASE_TYPES = new Set<GameAction["type"]>([
  "PLAY_TRAINER",
  "PLAY_BASIC_TO_BENCH",
  "EVOLVE",
  "ATTACH_ENERGY",
  "USE_ABILITY",
  "RETREAT",
  "ATTACK",
]);

export interface ActionCandidate {
  action: GameAction;
  label: string;
}

function defName(state: EngineState, id: string | undefined): string {
  if (!id) return "?";
  return getDefinition(state, id)?.name ?? "?";
}

function instName(state: EngineState, instanceId: string): string {
  for (const p of Object.values(state.players)) {
    const all = [...(p.active ? [p.active] : []), ...p.bench, ...p.hand];
    const found = all.find((c) => c.instanceId === instanceId);
    if (found) return defName(state, found.definitionId);
  }
  return "?";
}

/** Compact effect text for a card: its attacks (cost/dmg/text) + abilities. */
export function cardEffectText(def: CardDefinition | undefined): string {
  if (!def) return "";
  const parts: string[] = [];
  for (const atk of def.attacks ?? []) {
    const cost = atk.cost?.length ? atk.cost.join("/") : "—";
    const txt = atk.text ? ` — ${atk.text}` : "";
    parts.push(`atk ${atk.name} [${cost}] ${atk.damage || "0"}${txt}`);
  }
  for (const ab of def.abilities ?? []) {
    parts.push(`ability ${ab.name} — ${ab.text}`);
  }
  return parts.join("; ");
}

function pokemonLine(state: EngineState, c: CardInstance, withText: boolean): string {
  const def = getDefinition(state, c.definitionId);
  const hp = `${remainingHp(state, c)}/${def?.hp ?? "?"}`;
  const energy = c.attachedEnergy.length
    ? ` E:${c.attachedEnergy.map((e) => getDefinition(state, e.definitionId)?.types?.[0]?.[0] ?? "?").join("")}`
    : "";
  const status = c.statusConditions?.length ? ` [${c.statusConditions.join(",")}]` : "";
  const tool = c.toolId ? ` tool:${defName(state, c.toolId)}` : "";
  const text = withText ? ` {${cardEffectText(def)}}` : "";
  return `${def?.name ?? "?"} HP ${hp}${energy}${status}${tool}${text}`;
}

/**
 * Render the full board from `playerId`'s perspective. Own hand + both
 * actives/benches include effect text; opponent hand is hidden (count only).
 */
export function buildObservation(state: EngineState, playerId: PlayerId): string {
  const me = getPlayer(state, playerId);
  const opp = getPlayer(state, getOpponentId(playerId));
  const lines: string[] = [];

  lines.push(`Turn ${state.turnNumber}. You are ${me.name}.`);
  lines.push(`Prizes left — you: ${me.prizes.length}, opponent: ${opp.prizes.length}.`);
  if (state.stadium) lines.push(`Stadium: ${defName(state, state.stadium.definitionId)}.`);

  lines.push("");
  lines.push("YOUR ACTIVE: " + (me.active ? pokemonLine(state, me.active, true) : "(none)"));
  lines.push("YOUR BENCH:");
  me.bench.forEach((c, i) => lines.push(`  ${i + 1}. ${pokemonLine(state, c, true)}`));
  if (me.bench.length === 0) lines.push("  (empty)");

  lines.push("YOUR HAND:");
  me.hand.forEach((c, i) => {
    const def = getDefinition(state, c.definitionId);
    const kind = def?.supertype ?? "?";
    const text = cardEffectText(def);
    lines.push(`  ${i + 1}. ${def?.name ?? "?"} (${kind})${text ? ` {${text}}` : ""}`);
  });
  if (me.hand.length === 0) lines.push("  (empty)");

  lines.push("");
  lines.push("OPPONENT ACTIVE: " + (opp.active ? pokemonLine(state, opp.active, true) : "(none)"));
  lines.push("OPPONENT BENCH:");
  opp.bench.forEach((c, i) => lines.push(`  ${i + 1}. ${pokemonLine(state, c, false)}`));
  if (opp.bench.length === 0) lines.push("  (empty)");
  lines.push(`Opponent hand: ${opp.hand.length} card(s).`);

  if (state.log.length) {
    lines.push("");
    lines.push("RECENT LOG:");
    state.log.slice(-8).forEach((l) => lines.push(`  - ${l}`));
  }
  return lines.join("\n");
}

/** Human-readable label for a candidate main-phase action. */
function labelAction(state: EngineState, action: GameAction): string {
  switch (action.type) {
    case "PLAY_TRAINER":
      return `Play trainer ${instName(state, action.instanceId)}`;
    case "PLAY_BASIC_TO_BENCH":
      return `Bench basic ${instName(state, action.instanceId)}`;
    case "EVOLVE":
      return `Evolve ${instName(state, action.targetId)} → ${instName(state, action.evolutionId)}`;
    case "ATTACH_ENERGY":
      return `Attach ${instName(state, action.energyId)} to ${instName(state, action.targetId)}`;
    case "USE_ABILITY":
      return `Use ability ${action.abilityName} (${instName(state, action.pokemonId)})`;
    case "RETREAT":
      return `Retreat → ${instName(state, action.benchInstanceId)}`;
    case "ATTACK":
      return `Attack: ${action.attackName}`;
    default:
      return action.type;
  }
}

/**
 * Enumerate the legal main-phase actions for the active player, de-duplicated
 * and labelled. END_TURN is always appended as the final option.
 */
export function enumerateMainPhaseActions(
  state: EngineState,
  playerId: PlayerId,
): ActionCandidate[] {
  const legal = getLegalActions(state).filter(
    (a) => MAIN_PHASE_TYPES.has(a.type) && (a as { playerId?: PlayerId }).playerId === playerId,
  );
  const seen = new Set<string>();
  const candidates: ActionCandidate[] = [];
  for (const action of legal) {
    const key = JSON.stringify(action);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ action, label: labelAction(state, action) });
  }
  candidates.push({ action: { type: "END_TURN" } as GameAction, label: "End turn" });
  return candidates;
}

/** Format the numbered action menu for the prompt (1-based). */
export function renderActionMenu(candidates: ActionCandidate[]): string {
  return candidates.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
}

/**
 * Parse the model's reply into a chosen candidate. Accepts the first integer
 * in the text (1-based), tolerating prose like "I choose 3 because…" or
 * "ACTION: 3". Returns null if no valid in-range index is found.
 */
export function parseActionChoice(
  reply: string,
  candidates: ActionCandidate[],
): GameAction | null {
  const match = reply.match(/\d+/);
  if (!match) return null;
  const idx = parseInt(match[0], 10) - 1;
  if (idx < 0 || idx >= candidates.length) return null;
  return candidates[idx]!.action;
}
