import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoTrainerAction } from "./utrechtGameRunner";
import { emptyTurnFlags, type EngineState } from "../engine/types";

/**
 * Deck-out awareness: when our deck is critically small, the AI should stop
 * playing trainers that drain the deck further (Professor's Research, search
 * items, etc.) and lean on tools that reshuffle our hand back into the deck
 * (Iono / Lillie's Determination).
 */

function mockSupporter(name: string): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Trainer", subtypes: ["Supporter"],
    set: { id: "t", name: "t" }, number: "1",
    images: { small: "", large: "" },
  };
}
function mockItem(name: string): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Trainer", subtypes: ["Item"],
    set: { id: "t", name: "t" }, number: "1",
    images: { small: "", large: "" },
  };
}
function mockBasic(name: string, hp = "60"): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Pokémon", subtypes: ["Basic"],
    hp, types: ["Colorless"], attacks: [],
    set: { id: "t", name: "t" }, number: "1",
    images: { small: "", large: "" },
  };
}

function buildState(
  defs: Record<string, CardDefinition>,
  hand: ReturnType<typeof createCardInstance>[],
  deck: ReturnType<typeof createCardInstance>[],
): EngineState {
  const myActive = createCardInstance("filler", PlayerId.P1, Zone.Active);
  const oppActive = createCardInstance("filler", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 8,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1, name: "P1",
        deck, hand, active: myActive, bench: [],
        prizes: [], discard: [], lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2, name: "P2",
        deck: [], hand: [], active: oppActive, bench: [],
        prizes: Array.from({ length: 5 }, (_, i) =>
          createCardInstance(`opp-prize-${i}`, PlayerId.P2, Zone.Prize),
        ),
        discard: [], lostZone: [],
      },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { ...defs, filler: mockBasic("Filler") },
    log: [], actionLog: [], winnerId: null, rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null,
    heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("AI deck-out awareness", () => {
  it("when deck is critical (≤4), refuses Professor's Research even with a fat hand", () => {
    const profDef = mockSupporter("Professor's Research");
    const profCard = createCardInstance("Professor's Research", PlayerId.P1, Zone.Hand);
    // Fat hand of 5 random cards so the old scoring would normally play it.
    const handFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(`HF${i}`, PlayerId.P1, Zone.Hand),
    );
    const tinyDeck = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(`D${i}`, PlayerId.P1, Zone.Deck),
    );
    const handDefs = Object.fromEntries(handFillers.map((c, i) => [`HF${i}`, mockBasic(`HF${i}`)]));
    const deckDefs = Object.fromEntries(tinyDeck.map((c, i) => [`D${i}`, mockBasic(`D${i}`)]));
    const state = buildState(
      { "Professor's Research": profDef, ...handDefs, ...deckDefs },
      [profCard, ...handFillers],
      tinyDeck,
    );
    const picked = pickAutoTrainerAction(state);
    expect(picked).toBeNull(); // no trainer should be picked — Professor's Research is the only legal trainer and it's blocked
  });

  it("when deck is critical, Iono is the picked trainer (it refills the deck)", () => {
    const profDef = mockSupporter("Professor's Research");
    const ionoDef = mockSupporter("Iono");
    const profCard = createCardInstance("Professor's Research", PlayerId.P1, Zone.Hand);
    const ionoCard = createCardInstance("Iono", PlayerId.P1, Zone.Hand);
    const tinyDeck = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(`D${i}`, PlayerId.P1, Zone.Deck),
    );
    const deckDefs = Object.fromEntries(tinyDeck.map((c, i) => [`D${i}`, mockBasic(`D${i}`)]));
    const state = buildState(
      { "Professor's Research": profDef, "Iono": ionoDef, ...deckDefs },
      [profCard, ionoCard],
      tinyDeck,
    );
    const picked = pickAutoTrainerAction(state);
    expect(picked).not.toBeNull();
    expect(picked!.instanceId).toBe(ionoCard.instanceId);
  });

  it("when deck is healthy (≥11), Professor's Research is still preferred over Iono", () => {
    const profDef = mockSupporter("Professor's Research");
    const ionoDef = mockSupporter("Iono");
    const profCard = createCardInstance("Professor's Research", PlayerId.P1, Zone.Hand);
    const ionoCard = createCardInstance("Iono", PlayerId.P1, Zone.Hand);
    // Fat hand → Professor's Research base score is ~88 (vs Iono's 55).
    const handFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(`HF${i}`, PlayerId.P1, Zone.Hand),
    );
    const bigDeck = Array.from({ length: 25 }, (_, i) =>
      createCardInstance(`D${i}`, PlayerId.P1, Zone.Deck),
    );
    const handDefs = Object.fromEntries(handFillers.map((c, i) => [`HF${i}`, mockBasic(`HF${i}`)]));
    const deckDefs = Object.fromEntries(bigDeck.map((c, i) => [`D${i}`, mockBasic(`D${i}`)]));
    const state = buildState(
      { "Professor's Research": profDef, "Iono": ionoDef, ...handDefs, ...deckDefs },
      [profCard, ionoCard, ...handFillers],
      bigDeck,
    );
    const picked = pickAutoTrainerAction(state);
    expect(picked).not.toBeNull();
    expect(picked!.instanceId).toBe(profCard.instanceId);
  });

  it("when deck is critical, Ultra Ball / Buddy-Buddy Poffin search items also blocked", () => {
    const ultraDef = mockItem("Ultra Ball");
    const poffinDef = mockItem("Buddy-Buddy Poffin");
    const ultraCard = createCardInstance("Ultra Ball", PlayerId.P1, Zone.Hand);
    const poffinCard = createCardInstance("Buddy-Buddy Poffin", PlayerId.P1, Zone.Hand);
    const handFillers = Array.from({ length: 4 }, (_, i) =>
      createCardInstance(`HF${i}`, PlayerId.P1, Zone.Hand),
    );
    const tinyDeck = Array.from({ length: 2 }, (_, i) =>
      createCardInstance(`D${i}`, PlayerId.P1, Zone.Deck),
    );
    const handDefs = Object.fromEntries(handFillers.map((c, i) => [`HF${i}`, mockBasic(`HF${i}`)]));
    const deckDefs = Object.fromEntries(tinyDeck.map((c, i) => [`D${i}`, mockBasic(`D${i}`)]));
    const state = buildState(
      { "Ultra Ball": ultraDef, "Buddy-Buddy Poffin": poffinDef, ...handDefs, ...deckDefs },
      [ultraCard, poffinCard, ...handFillers],
      tinyDeck,
    );
    const picked = pickAutoTrainerAction(state);
    expect(picked).toBeNull();
  });
});
