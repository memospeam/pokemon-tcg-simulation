import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoAbilityAction } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

/**
 * Cursed Blast KOs the user (Dusknoir/Dusclops) itself → the opponent takes a
 * prize. So the AI must only fire it when it KOs an opponent Pokémon in return.
 * Dusknoir places 13 counters (130 dmg); Dusclops places only 5 (50 dmg) — the
 * gate must size the KO check to the actual Pokémon.
 */

function mockPokemon(
  name: string,
  hp: string,
  abilities: { name: string; text: string; type: string }[] = [],
  attacks: CardDefinition["attacks"] = [],
): CardDefinition {
  return {
    apiId: name, name, supertype: "Pokémon", subtypes: ["Stage 2"], hp, types: ["Psychic"],
    abilities, attacks,
    set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
  };
}

const cursedBlast13 = { name: "Cursed Blast", type: "Ability", text: "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out." };
const cursedBlast5 = { name: "Cursed Blast", type: "Ability", text: "Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out." };

function state(self: CardDefinition, oppActiveHp: string, oppBenchHp: string | null): EngineState {
  const dusk = createCardInstance("self", PlayerId.P1, Zone.Bench);
  const dragapult = createCardInstance("p1-active", PlayerId.P1, Zone.Active);
  const oppActive = createCardInstance("opp-active", PlayerId.P2, Zone.Active);
  const oppBench = oppBenchHp != null ? [createCardInstance("opp-bench", PlayerId.P2, Zone.Bench)] : [];
  return {
    phase: GamePhase.Active, turnNumber: 5, currentPlayerId: PlayerId.P1, viewingPlayerId: PlayerId.P1, firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active: dragapult, bench: [dusk], prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: oppActive, bench: oppBench, prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: {
      self,
      "p1-active": mockPokemon("Dragapult ex", "320"),
      "opp-active": mockPokemon("OppActive", oppActiveHp),
      "opp-bench": mockPokemon("OppBench", oppBenchHp ?? "200"),
    },
    log: [], actionLog: [], winnerId: null, rngSeed: 1, turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("Cursed Blast — fire only for a KO", () => {
  const ctx = buildStrategyContext(["Dragapult ex", "Dusknoir", "Dreepy"]);
  const dusknoir = (hp = "160") => mockPokemon("Dusknoir", hp, [cursedBlast13]);
  const dusclops = (hp = "90") => mockPokemon("Dusclops", hp, [cursedBlast5]);

  it("Dusknoir fires when its 130 KOs a bench Pokémon", () => {
    const picked = pickAutoAbilityAction(state(dusknoir(), "320", "70"), ctx); // bench 70 HP ≤ 130
    expect(picked?.abilityName.toLowerCase()).toBe("cursed blast");
  });

  it("Dusknoir does NOT fire when nothing is in 130 KO range (healthy Dusknoir)", () => {
    const picked = pickAutoAbilityAction(state(dusknoir(), "320", "200"), ctx); // active 320, bench 200
    if (picked) expect(picked.abilityName.toLowerCase()).not.toBe("cursed blast");
  });

  it("Dusclops (only 50) does NOT fire on a 70 HP target it can't KO", () => {
    // A Dusknoir (130) WOULD fire here, but Dusclops only does 50 — must hold.
    const picked = pickAutoAbilityAction(state(dusclops(), "320", "70"), ctx);
    if (picked) expect(picked.abilityName.toLowerCase()).not.toBe("cursed blast");
  });

  it("Dusclops fires when its 50 KOs a low-HP bench Pokémon", () => {
    const picked = pickAutoAbilityAction(state(dusclops(), "320", "40"), ctx); // bench 40 ≤ 50
    expect(picked?.abilityName.toLowerCase()).toBe("cursed blast");
  });

  it("Dusclops fires the Phantom Dive combo: 50 + spread 60 KOs a 100 HP bench Pokémon", () => {
    // Dragapult ex Active WITH an affordable Phantom Dive → its 6-counter (60)
    // bench spread will finish a Benched Pokémon that Dusclops (50) softens.
    const dragapultDive: CardDefinition = {
      apiId: "p1-active", name: "Dragapult ex", supertype: "Pokémon", subtypes: ["Stage 2", "ex"],
      hp: "320", types: ["Psychic"], abilities: [],
      attacks: [{ name: "Phantom Dive", cost: ["Fire", "Psychic"], convertedEnergyCost: 2, damage: "200", text: "Put 6 damage counters on your opponent's Benched Pokémon in any way you like." }],
      set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
    };
    const s = state(dusclops(), "320", "100"); // bench 100 HP — not a direct 50 KO, but 50+60 = 110 ≥ 100
    // Swap the plain active for a Phantom-Dive Dragapult ex with the energy to use it.
    s.definitions["p1-active"] = dragapultDive;
    s.definitions["fire-e"] = { apiId: "fire-e", name: "Fire Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Fire"], set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" } };
    s.definitions["psy-e"] = { apiId: "psy-e", name: "Psychic Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Psychic"], set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" } };
    s.players[PlayerId.P1].active!.attachedEnergy = [
      createCardInstance("fire-e", PlayerId.P1, Zone.Active),
      createCardInstance("psy-e", PlayerId.P1, Zone.Active),
    ];

    const picked = pickAutoAbilityAction(s, ctx);
    expect(picked?.abilityName.toLowerCase()).toBe("cursed blast");
  });
});
