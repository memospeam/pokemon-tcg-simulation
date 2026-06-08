import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoAbilityAction } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

/**
 * Pecharunt ex's Subjugating Chains says:
 *   "Switch 1 of your Benched Darkness Pokémon, except any Pecharunt ex,
 *    with your Active Pokémon. The new Active Pokémon is now Poisoned."
 *
 * The AI must NEVER pick this ability when:
 *   1. There is no Darkness bench Pokémon to swap with.
 *   2. The only Darkness bench Pokémon is ANOTHER Pecharunt ex (excluded).
 *   3. The Active is the primary attacker and healthy — swapping it out
 *      poisons a worse Pokémon while parking our win condition on the bench.
 */

function mockPokemon(
  name: string,
  attacks: { name: string; cost: string[]; convertedEnergyCost: number; damage: string }[],
  types: string[],
  hp = "200",
  abilities: { name: string; text: string; type: string }[] = [],
): CardDefinition {
  return {
    apiId: name, name,
    supertype: "Pokémon", subtypes: ["Basic"], hp, types,
    abilities,
    attacks: attacks.map((a) => ({ ...a, text: "" })),
    set: { id: "t", name: "t" }, number: "1",
    images: { small: "", large: "" },
  };
}

function buildState(
  defs: Record<string, CardDefinition>,
  active: ReturnType<typeof createCardInstance>,
  bench: ReturnType<typeof createCardInstance>[],
): EngineState {
  const opp = createCardInstance("opp", PlayerId.P2, Zone.Active);
  return {
    phase: GamePhase.Active,
    turnNumber: 5,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: { id: PlayerId.P1, name: "P1", deck: [], hand: [], active, bench, prizes: [], discard: [], lostZone: [] },
      [PlayerId.P2]: { id: PlayerId.P2, name: "P2", deck: [], hand: [], active: opp, bench: [], prizes: [], discard: [], lostZone: [] },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { ...defs, opp: mockPokemon("Opp", [], []) },
    log: [], actionLog: [], winnerId: null, rngSeed: 42,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null,
    heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("Pecharunt ex Subjugating Chains — AI gating", () => {
  // The activated-ability scoring uses the ability NAME via getLegalActions →
  // canUseAbilityNow. For these tests we hand the AI a state where the ability
  // is legal and verify whether the AI fires it.

  const pecharuntDef = mockPokemon(
    "Pecharunt ex",
    [{ name: "Irritated Outburst", cost: ["Darkness", "Darkness"], convertedEnergyCost: 2, damage: "60" }],
    ["Darkness"],
    "210",
    [{ name: "Subjugating Chains", type: "Ability", text: "Once during your turn, you may switch 1 of your Benched Darkness Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn." }],
  );
  const zoroarkDef = mockPokemon(
    "N's Zoroark ex",
    [{ name: "Night Joker", cost: ["Darkness", "Darkness"], convertedEnergyCost: 2, damage: "0" }],
    ["Darkness"], "270",
  );
  const munkidoriDef = mockPokemon(
    "Munkidori",
    [{ name: "Goodnight, Babies", cost: ["Psychic"], convertedEnergyCost: 1, damage: "0" }],
    ["Psychic"], "70",
  );

  it("does NOT fire when active is N's Zoroark ex (healthy primary attacker) with Pecharunt on bench", () => {
    // Common Zoroark-deck board: Zoroark ex active, Pecharunt ex on bench (the
    // ability holder). Swapping Zoroark out for ANOTHER Darkness Pokémon
    // wastes our setup.
    const zoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Active);
    const pecharunt = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Bench);
    const ctx = buildStrategyContext(["N's Zoroark ex", "Pecharunt ex"]);
    const state = buildState(
      { "N's Zoroark ex": zoroarkDef, "Pecharunt ex": pecharuntDef },
      zoroark, [pecharunt],
    );

    const picked = pickAutoAbilityAction(state, ctx);
    // Two-Pokémon board: legal abilities probably include Subjugating Chains
    // on Pecharunt. The AI must NOT fire it.
    if (picked) {
      expect(picked.abilityName.toLowerCase()).not.toBe("subjugating chains");
    }
  });

  it("does NOT fire when the only Darkness bench Pokémon is another Pecharunt ex (engine excludes it)", () => {
    // Active Pecharunt ex (the one that would use the ability), bench = another
    // Pecharunt ex. Card text excludes Pecharunt ex → engine would fail. AI
    // must refuse rather than burn the once-per-turn use.
    const activePecharunt = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Active);
    const benchPecharunt = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Bench);
    const ctx = buildStrategyContext(["Pecharunt ex"]);
    const state = buildState(
      { "Pecharunt ex": pecharuntDef },
      activePecharunt, [benchPecharunt],
    );

    const picked = pickAutoAbilityAction(state, ctx);
    if (picked) {
      expect(picked.abilityName.toLowerCase()).not.toBe("subjugating chains");
    }
  });

  it("DOES fire to pivot when the active Zoroark ex can't attack but a fresh bench Zoroark ex can", () => {
    // Zoroark loop: the active N's Zoroark ex is attack-locked (here: no Energy
    // → no legal ATTACK, standing in for Rampaging Thunder's "can't attack next
    // turn"). A fresh Benched N's Zoroark ex HAS Energy. Subjugating Chains must
    // pivot the fresh one into the Active spot so we keep swinging.
    const darkEnergyDef: CardDefinition = {
      apiId: "dark-e", name: "Darkness Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Darkness"],
      set: { id: "t", name: "t" }, number: "1", images: { small: "", large: "" },
    };
    const lockedZoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Active); // 0 energy
    const freshZoroark = createCardInstance("N's Zoroark ex", PlayerId.P1, Zone.Bench);
    freshZoroark.attachedEnergy = [
      createCardInstance("dark-e", PlayerId.P1, Zone.Bench),
      createCardInstance("dark-e", PlayerId.P1, Zone.Bench),
    ];
    const pecharunt = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Bench);
    const ctx = buildStrategyContext(["N's Zoroark ex", "Pecharunt ex"]);
    const state = buildState(
      { "N's Zoroark ex": zoroarkDef, "Pecharunt ex": pecharuntDef, "dark-e": darkEnergyDef },
      lockedZoroark, [freshZoroark, pecharunt],
    );

    const picked = pickAutoAbilityAction(state, ctx);
    expect(picked).not.toBeNull();
    expect(picked!.abilityName.toLowerCase()).toBe("subjugating chains");
  });

  it("does NOT fire when bench has only a non-Darkness Pokémon (Munkidori)", () => {
    // Active Pecharunt ex, bench has only Munkidori (Psychic) — engine would
    // find 0 eligible targets and abort. AI must refuse.
    const activePecharunt = createCardInstance("Pecharunt ex", PlayerId.P1, Zone.Active);
    const munkidori = createCardInstance("Munkidori", PlayerId.P1, Zone.Bench);
    const ctx = buildStrategyContext(["Pecharunt ex", "Munkidori"]);
    const state = buildState(
      { "Pecharunt ex": pecharuntDef, "Munkidori": munkidoriDef },
      activePecharunt, [munkidori],
    );

    const picked = pickAutoAbilityAction(state, ctx);
    if (picked) {
      expect(picked.abilityName.toLowerCase()).not.toBe("subjugating chains");
    }
  });
});
