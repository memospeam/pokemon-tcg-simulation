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
 * Per-archetype combo lines. Author here one deck at a time, each validated by
 * benchmark before it stays (keep-the-winner). The lethal finisher above is
 * shared by every archetype via getComboLines.
 *
 * ponytail: consumed via pickComboAction, wired into all three heuristic
 * drivers — pickHeuristicMainAction (policy/agent), runEngineAutoPlay (sync
 * benchmark + Play-vs-AI), and captureSimulationFrames (Simulation tab +
 * report:selfplay).
 */
/**
 * N's Zoroark — close the Mochi combo kill the generic lethal finisher can't
 * see. When the Active N's Zoroark ex is the Poisoned Binding Mochi holder
 * (so its +40 is live) and can Night Joker, but the copied attack's raw damage
 * ISN'T lethal while raw + Mochi(40) + Black Belt's Training(40 vs an ex) IS,
 * force the kill: play Black Belt's first if it adds the needed 40, otherwise
 * swing Night Joker now (the engine applies the Mochi/Black Belt buffs at
 * damage time). The setup (attaching Mochi, the Subjugating Chains pivot) is
 * already handled by the heuristic's scoring — this only stops it whiffing the
 * final lethal.
 */
const zoroarkMochiLethal: ComboLine = {
  name: "zoroark-mochi-lethal",
  nextStep: ({ state, playerId, legal }) => {
    const me = getPlayer(state, playerId);
    const opp = getPlayer(state, getOpponentId(playerId));
    const active = me.active;
    if (!active || !opp.active) return null;
    const aDef = getDefinition(state, active.definitionId);
    if (!aDef?.name.toLowerCase().includes("n's zoroark ex")) return null;
    const poisoned = active.statusConditions?.includes("Poisoned") ?? false;
    const holdsMochi = (active.attachedTools ?? []).some((t) =>
      getDefinition(state, t.definitionId)?.name.toLowerCase().includes("binding mochi"),
    );
    const njAttack = legal.find(
      (a) => a.type === "ATTACK" && a.attackName.toLowerCase().includes("night joker"),
    );
    if (!poisoned || !holdsMochi || !njAttack) return null;

    // Best Night Joker template damage from a benched N's Pokémon.
    const njRaw = me.bench.reduce((best, b) => {
      const bd = getDefinition(state, b.definitionId);
      if (!bd?.name.toLowerCase().startsWith("n's")) return best;
      return Math.max(best, ...(bd.attacks ?? []).map((a) => parseDamage(a.damage)));
    }, 0);
    if (njRaw <= 0) return null;

    const oppDef = getDefinition(state, opp.active.definitionId);
    const oppHp = remainingHp(state, opp.active);
    const oppIsEx = (oppDef?.subtypes ?? []).includes("ex");
    const bbCard = me.hand.find((c) =>
      getDefinition(state, c.definitionId)?.name.toLowerCase().includes("black belt's training"),
    );
    const bbLegal =
      bbCard && oppIsEx && !state.turnFlags.supporterPlayed
        ? legal.find((a) => a.type === "PLAY_TRAINER" && a.instanceId === bbCard.instanceId)
        : undefined;

    const rawWR = applyWeaknessAndResistance(njRaw, aDef.types, oppDef!);
    const comboWR = applyWeaknessAndResistance(njRaw + 40 + (bbLegal ? 40 : 0), aDef.types, oppDef!);
    if (rawWR >= oppHp) return null; // generic lethal finisher already covers this
    if (comboWR < oppHp) return null; // even the combo can't kill — don't force it
    return bbLegal ?? njAttack; // play Black Belt's for the extra 40, else swing
  },
};

const PER_ARCHETYPE: Partial<Record<Archetype, ComboLine[]>> = {
  zoroark: [zoroarkMochiLethal],
};

export function getComboLines(archetype: Archetype): ComboLine[] {
  return [lethalFinisher, ...(PER_ARCHETYPE[archetype] ?? [])];
}
