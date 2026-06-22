/**
 * Combo-line framework for deck-expert AI.
 *
 * A ComboLine is a stateless "next step" the heuristic consults BEFORE its
 * generic scoring chain: given the current state, it returns the single action
 * that advances this deck's signature line, or null if not applicable now.
 * The heuristic forces the first non-null line, so multi-step combos (whose
 * correct ordering the generic scorer tends to miss) play out reliably.
 *
 * Authoring rule (learned the hard way — see detectArchetype's checklist):
 * a line may only return an action it has confirmed is sensible from `state`,
 * and each new per-archetype line must be validated with report:selfplay +
 * a balanced benchmark and kept only if it doesn't regress.
 */
import type { PlayerId } from "../models/enums";
import { applyWeaknessAndResistance, parseDamage } from "../engine/rules";
import { getDefinition, getOpponentId, getPlayer, remainingHp, type EngineState, type GameAction } from "../engine/types";
import type { Archetype } from "./deckStrategy";

export interface ComboContext {
  state: EngineState;
  playerId: PlayerId;
  /** Legal actions for `playerId` this step (so a line only returns legal moves). */
  legal: GameAction[];
}

export interface ComboLine {
  name: string;
  nextStep: (ctx: ComboContext) => GameAction | null;
}

/**
 * Take a lethal attack now rather than dithering with more setup/draw first.
 * Applies to every archetype — taking available game-winning damage is never
 * wrong, and it stops draw abilities from milling on the turn we could just win.
 * Conservative: parseDamage reads the base number, so variable "X+/X×" attacks
 * are only forced when their base alone is already lethal (never a false KO).
 */
const lethalFinisher: ComboLine = {
  name: "lethal-finisher",
  nextStep: ({ state, playerId, legal }) => {
    const me = getPlayer(state, playerId);
    const opp = getPlayer(state, getOpponentId(playerId));
    if (!me.active || !opp.active) return null;
    const oppHp = remainingHp(state, opp.active);
    if (oppHp <= 0) return null;
    const myDef = getDefinition(state, me.active.definitionId);
    const oppDef = getDefinition(state, opp.active.definitionId);
    if (!myDef || !oppDef) return null;
    for (const action of legal) {
      if (action.type !== "ATTACK") continue;
      const atk = (myDef.attacks ?? []).find((a) => a.name === action.attackName);
      if (!atk) continue;
      const dmg = applyWeaknessAndResistance(parseDamage(atk.damage), myDef.types, oppDef);
      if (dmg >= oppHp) return action;
    }
    return null;
  },
};

/**
 * Per-archetype combo lines. Empty today — author here one deck at a time,
 * each validated by benchmark before it stays. The lethal finisher above is
 * shared by every archetype via getComboLines.
 *
 * ponytail: wired into pickHeuristicMainAction (the policy/agent decision
 * path). The sync benchmark driver (runEngineAutoPlay) and Simulation capture
 * keep their own inline chains; route them through getComboLines when a
 * per-archetype line needs to show up there too.
 */
const PER_ARCHETYPE: Partial<Record<Archetype, ComboLine[]>> = {};

export function getComboLines(archetype: Archetype): ComboLine[] {
  return [lethalFinisher, ...(PER_ARCHETYPE[archetype] ?? [])];
}
