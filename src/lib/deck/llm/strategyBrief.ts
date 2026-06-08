/**
 * Formats a deck's tournament-researched play guide (win condition, turn-by-turn
 * game plan, and the matchup note vs the current opponent) into a compact text
 * brief that is injected into the LLM agent's prompt. This is how the LLM
 * "studies the play steps" from the meta guides at decision time — on top of
 * the per-card effect text already in the observation.
 */
import type { Archetype, StrategyProfile } from "../deckStrategy";

export function buildStrategyBrief(
  profile: StrategyProfile,
  opponentArchetype: Archetype | null,
): string {
  // "unknown" archetype has no curated guide — skip the brief entirely.
  if (profile.archetype === "unknown") return "";

  const lines: string[] = [];
  lines.push(`STRATEGY GUIDE — your deck: ${profile.displayName}`);
  if (profile.winCondition) lines.push(`Win condition: ${profile.winCondition}`);
  if (profile.gamePlan?.length) {
    lines.push("Game plan:");
    for (const step of profile.gamePlan) lines.push(`  - ${step}`);
  }
  if (
    opponentArchetype &&
    opponentArchetype !== "unknown" &&
    profile.matchupNotes?.[opponentArchetype]
  ) {
    lines.push(`Matchup vs ${opponentArchetype}: ${profile.matchupNotes[opponentArchetype]}`);
  }
  return lines.join("\n");
}
