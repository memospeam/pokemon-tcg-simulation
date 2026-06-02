import { describe, expect, it } from "vitest";
import { getTournamentDeckById } from "./tournamentPresets";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import {
  beginMatchFromBuiltDecks,
  autoSetupEngineState,
  pickHeuristicMainAction,
  runMatchFromBuiltDecks,
} from "./metaGameRunner";
import { HeuristicPolicy } from "./policy";
import { runPolicyMatchFromBuiltDecks } from "./policyMatch";
import { buildStrategyContext } from "./deckStrategy";
import { getDefinition, getPlayer } from "../engine/types";
import { PlayerId } from "../models/enums";

const DRAGAPULT = "utrecht-2-hasan-kunukcu";
const GRENINJA = "utrecht-14-niklas-leitz";

function built(id: string) {
  const preset = getTournamentDeckById(id)!;
  return { preset, deck: buildPlaytestDeckFromCorpusText(preset.label, preset.text) };
}

describe("HeuristicPolicy + runPolicyMatch", () => {
  it("HeuristicPolicy.decide returns the same action pickHeuristicMainAction would, post-setup", async () => {
    const a = built(DRAGAPULT);
    let state = beginMatchFromBuiltDecks({
      player1Name: a.preset.player, player2Name: a.preset.player,
      player1Deck: a.deck, player2Deck: a.deck, seed: 11,
    });
    state = autoSetupEngineState(state, { placeBenchBasics: true, maxMulligans: 40 });

    const pid = state.currentPlayerId;
    const p = getPlayer(state, pid);
    const ctx = buildStrategyContext(
      [...p.deck, ...p.hand, ...(p.active ? [p.active] : []), ...p.bench]
        .map((c) => getDefinition(state, c.definitionId)?.name ?? ""),
    );

    const direct = pickHeuristicMainAction(state, pid, ctx);
    const viaPolicy = await new HeuristicPolicy().decide(state, pid, ctx);
    expect(viaPolicy).toEqual(direct);
  });

  it("runPolicyMatch (heuristic vs heuristic) completes and produces a result", async () => {
    const a = built(DRAGAPULT);
    const b = built(GRENINJA);
    const result = await runPolicyMatchFromBuiltDecks(
      {
        player1Name: a.preset.player, player2Name: b.preset.player,
        player1Deck: a.deck, player2Deck: b.deck, seed: 11,
      },
      new HeuristicPolicy(),
      new HeuristicPolicy(),
      { maxTurns: 45, maxActions: 360 },
    );
    // A decisive or drawn game, but no stall, and turns advanced.
    expect(result.stalled).toBe(false);
    expect(result.turnCount).toBeGreaterThan(0);
    expect([PlayerId.P1, PlayerId.P2, null]).toContain(result.winnerId);
  });
});
