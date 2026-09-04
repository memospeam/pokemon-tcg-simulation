export type AttackBeamDirection = "self-to-opp" | "opp-to-self";

export interface AttackBeam {
  id: string;
  direction: AttackBeamDirection;
}

/** Parse attack log and match attacker name to an in-play Active Pokémon. */
export function parseAttackBeam(
  logLine: string,
  selfActiveName: string | null,
  oppActiveName: string | null,
  logIndex: number,
): AttackBeam | null {
  const match = logLine.match(/^(.+?) used .+ for \d+ damage to Active/i);
  if (!match) return null;

  const attacker = match[1]!.trim();
  if (selfActiveName && attacker === selfActiveName) {
    return { id: `beam-self-${logIndex}`, direction: "self-to-opp" };
  }
  if (oppActiveName && attacker === oppActiveName) {
    return { id: `beam-opp-${logIndex}`, direction: "opp-to-self" };
  }
  return null;
}
