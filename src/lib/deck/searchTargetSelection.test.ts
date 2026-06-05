import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { drainAutoPending } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, getPlayer, type EngineState } from "../engine/types";

/**
 * Deck-search target selection (Ultra Ball, etc.) must be board-aware:
 *   • Don't grab a 3rd copy of an attacker already saturated in play.
 *   • Don't grab an Evolution you can't deploy (pre-evolution not in play/hand).
 *   • Prefer an Evolution whose pre-evolution IS in play (ready to evolve).
 *
 * Regression: the Lopunny AI used to fetch Mega Lopunny ex even with 2 already
 * in play and no Buneary to evolve, instead of Dudunsparce for the benched
 * Dunsparce.
 */

function mon(name: string, subtypes: string[], hp = "120", evolvesFrom?: string): CardDefinition {
  return {
    apiId: name, name, supertype: "Pokémon", subtypes, hp, types: ["Colorless"],
    abilities: [], attacks: [], evolvesFrom,
    set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}

describe("deck-search target selection is board-aware", () => {
  it("Lopunny: with 2 Mega Lopunny ex in play, no Buneary, Dunsparce benched → fetch Dudunsparce", () => {
    const defs: Record<string, CardDefinition> = {
      lop: mon("Mega Lopunny ex", ["Stage 2", "MEGA", "ex"], "330", "Buneary"),
      dun: mon("Dunsparce", ["Basic"], "70"),
      dudun: mon("Dudunsparce", ["Stage 1"], "140", "Dunsparce"),
      bun: mon("Buneary", ["Basic"], "70"),
      opp: mon("Opp", ["Basic"]),
    };
    const active = createCardInstance("lop", PlayerId.P1, Zone.Active);
    const benchLop = createCardInstance("lop", PlayerId.P1, Zone.Bench);
    const benchDun = createCardInstance("dun", PlayerId.P1, Zone.Bench);
    const deckLop = createCardInstance("lop", PlayerId.P1, Zone.Deck);
    const deckDudun = createCardInstance("dudun", PlayerId.P1, Zone.Deck);
    const deckBun = createCardInstance("bun", PlayerId.P1, Zone.Deck);

    const state: EngineState = {
      phase: GamePhase.Active, turnNumber: 6, currentPlayerId: PlayerId.P1, viewingPlayerId: PlayerId.P1, firstPlayerId: PlayerId.P1,
      players: {
        [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [deckLop, deckDudun, deckBun], hand: [], active, bench: [benchLop, benchDun], prizes: [], discard: [], lostZone: [] },
        [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: createCardInstance("opp", PlayerId.P2, Zone.Active), bench: [], prizes: [], discard: [], lostZone: [] },
      },
      stadium: null, stadiumOwnerId: null, definitions: defs, log: [], actionLog: [], winnerId: null, rngSeed: 1, turnFlags: emptyTurnFlags(),
      pendingMulliganPlayerId: null,
      pendingAction: { type: "SEARCH_DECK", playerId: PlayerId.P1, filter: "POKEMON", options: [deckLop.instanceId, deckDudun.instanceId, deckBun.instanceId], slotsRemaining: 1 } as EngineState["pendingAction"],
      heldCard: null, itemPlayBlockedForPlayerId: null,
      teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
      ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    };

    const ctx = buildStrategyContext(["Mega Lopunny ex", "Buneary", "Dunsparce", "Dudunsparce"]);
    const { state: after } = drainAutoPending(state, 4, ctx);
    const handNames = getPlayer(after, PlayerId.P1).hand.map((c) => after.definitions[c.definitionId]?.name);

    expect(handNames).toContain("Dudunsparce"); // ready to evolve the benched Dunsparce
    expect(handNames).not.toContain("Mega Lopunny ex"); // already 2 in play + no Buneary to evolve
  });
});
