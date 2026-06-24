import { describe, expect, it } from "vitest";
import cards from "../../../../data/standard/cards-index.json";
import type { CardDefinition } from "../../models/definition";
import { parseTrainerText } from "./trainerText";
import { applyTrainerBatch3Kind } from "./trainerBatch3Effects";
import { PlayerId, Zone } from "../../models/enums";
import { createCardInstance } from "../../models/instance";
import type { EngineState } from "../types";

function corpusTrainer(name: string): CardDefinition {
  const c = (cards as any[]).find((x) => x.name === name && x.supertype === "Trainer")!;
  return { ...c, rules: c.trainerRules ? [c.trainerRules.text] : [] } as CardDefinition;
}

const EXPECT: Record<string, string> = {
  "Energy Retrieval": "trainer_recover_typed_to_hand",
  Tarragon: "trainer_recover_typed_to_hand",
  "Great Haul Net": "trainer_shuffle_typed_to_deck",
  "Xerosic's Machinations": "discard_hand_until_count",
  "Hand Trimmer": "trainer_both_discard_hand_until",
  Emma: "trainer_draw_per_opp_pokemon",
  "Larry's Skill": "trainer_discard_hand_search_three",
  "Strange Timepiece": "trainer_devolve_own_typed",
  "Anthea & Concordia": "trainer_extra_prizes_if_team",
  "Tool Scrapper": "trainer_tool_scrapper",
};

describe("Batch 1 trainer effects parse + fire", () => {
  it("all 10 cards parse to a handled effect (gap closed)", () => {
    for (const [name, kind] of Object.entries(EXPECT)) {
      const r = parseTrainerText(corpusTrainer(name));
      expect(r.effects.map((e) => e.kind), name).toContain(kind);
    }
  });

  it("Energy Retrieval pulls up to 2 Basic Energy from discard to hand", () => {
    const grass = { apiId: "g", name: "Grass Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Grass"], set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" } } as CardDefinition;
    const state = {
      players: {
        [PlayerId.P1]: { hand: [], discard: [createCardInstance("g", PlayerId.P1, Zone.Discard), createCardInstance("g", PlayerId.P1, Zone.Discard), createCardInstance("g", PlayerId.P1, Zone.Discard)] },
        [PlayerId.P2]: { hand: [], discard: [] },
      },
      definitions: { g: grass },
      log: [],
    } as unknown as EngineState;
    applyTrainerBatch3Kind(state, PlayerId.P1, { kind: "trainer_recover_typed_to_hand", energyType: "", count: 2 });
    expect(state.players[PlayerId.P1].hand.length).toBe(2);
    expect(state.players[PlayerId.P1].discard.length).toBe(1);
  });

  it("Emma draws one per opponent's Pokémon in hand", () => {
    const mon = { apiId: "m", name: "Pikachu", supertype: "Pokémon", subtypes: ["Basic"], hp: "60", set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" } } as CardDefinition;
    const energy = { apiId: "e", name: "Lightning Energy", supertype: "Energy", subtypes: ["Basic"], set: { id: "t", name: "T" }, number: "2", images: { small: "", large: "" } } as CardDefinition;
    const state = {
      players: {
        [PlayerId.P1]: { hand: [], deck: [createCardInstance("e", PlayerId.P1, Zone.Deck), createCardInstance("e", PlayerId.P1, Zone.Deck), createCardInstance("e", PlayerId.P1, Zone.Deck)] },
        [PlayerId.P2]: { hand: [createCardInstance("m", PlayerId.P2, Zone.Hand), createCardInstance("m", PlayerId.P2, Zone.Hand), createCardInstance("e", PlayerId.P2, Zone.Hand)] },
      },
      definitions: { m: mon, e: energy },
      log: [],
    } as unknown as EngineState;
    applyTrainerBatch3Kind(state, PlayerId.P1, { kind: "trainer_draw_per_opp_pokemon" });
    expect(state.players[PlayerId.P1].hand.length).toBe(2); // 2 Pokémon in opp hand
  });
});
