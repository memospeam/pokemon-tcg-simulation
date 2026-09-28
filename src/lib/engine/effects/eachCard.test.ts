import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../models/definition";
import { isStadium, isTool } from "../../models/definition";
import { createCardInstance } from "../../models/instance";
import { GamePhase, PlayerId, Zone } from "../../models/enums";
import { loadStandardCorpus } from "../../format/loadStandardCorpus";
import type { StandardCardIndex } from "../../format/prepareStandardCorpus";
import { applyTrainerEffect } from "../trainerEffects";
import { emptyTurnFlags, getPlayer, type EngineState } from "../types";
import { executeEffects } from "./execute";
import { parseAbilityText, parseAttackText } from "./parseText";
import { parseTrainerText } from "./trainerText";

const images = { small: "", large: "" };

function mon(apiId: string, name: string, extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    apiId,
    name,
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "200",
    types: ["Colorless"],
    set: { id: "test", name: "Test" },
    number: "1",
    images,
    ...extra,
  };
}

function energy(apiId: string): CardDefinition {
  return {
    apiId,
    name: "Fire Energy",
    supertype: "Energy",
    subtypes: ["Basic"],
    types: ["Fire"],
    set: { id: "test", name: "Test" },
    number: "2",
    images,
  };
}

function trainerDef(card: StandardCardIndex): CardDefinition {
  return {
    apiId: card.apiId,
    name: card.name,
    supertype: "Trainer",
    subtypes: [...card.subtypes],
    rules: card.trainerRules ? [card.trainerRules.text] : [],
    set: { id: card.set.toLowerCase(), name: card.set, ptcgoCode: card.set },
    number: card.number,
    images,
  };
}

function inst(definitionId: string, owner: PlayerId, zone: Zone) {
  return createCardInstance(definitionId, owner, zone);
}

/** Board with basics, an ex, energy, a discard pile, and a deck, so "up to N" trainers have a legal target. */
function richState(): EngineState {
  const defs: Record<string, CardDefinition> = {
    abra: mon("abra", "Abra", { hp: "60", types: ["Psychic"] }),
    fez: mon("fez", "Fezandipiti ex", { subtypes: ["Basic", "ex"], hp: "210", types: ["Darkness"] }),
    kadabra: mon("kadabra", "Kadabra", {
      subtypes: ["Stage 1"],
      hp: "80",
      types: ["Psychic"],
      evolvesFrom: "Abra",
    }),
    murkrow: mon("murkrow", "Team Rocket's Murkrow", { hp: "70", types: ["Darkness"] }),
    zoroa: mon("zoroa", "N's Zorua", { hp: "70", types: ["Darkness"] }),
    fire: energy("fire"),
    judge: {
      apiId: "judge",
      name: "Judge",
      supertype: "Trainer",
      subtypes: ["Supporter"],
      set: { id: "test", name: "Test" },
      number: "3",
      images,
    },
  };
  const deck = (owner: PlayerId) => [
    ...Array.from({ length: 12 }, () => inst("fire", owner, Zone.Deck)),
    inst("judge", owner, Zone.Deck),
    inst("judge", owner, Zone.Deck),
  ];
  const prizes = (owner: PlayerId) =>
    Array.from({ length: 4 }, () => inst("fire", owner, Zone.Prize));
  const active = (id: string, owner: PlayerId) => {
    const card = inst(id, owner, Zone.Active);
    card.attachedEnergy = [inst("fire", owner, Zone.Active)];
    card.damageCounters = 20;
    return card;
  };
  const bench = (id: string, owner: PlayerId) => inst(id, owner, Zone.Bench);

  return {
    phase: GamePhase.Active,
    turnNumber: 3,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P2,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1,
        name: "P1",
        deck: deck(PlayerId.P1),
        hand: [
          inst("abra", PlayerId.P1, Zone.Hand),
          inst("abra", PlayerId.P1, Zone.Hand),
          inst("fire", PlayerId.P1, Zone.Hand),
        ],
        active: active("abra", PlayerId.P1),
        bench: [bench("kadabra", PlayerId.P1), bench("murkrow", PlayerId.P1), bench("zoroa", PlayerId.P1)],
        prizes: prizes(PlayerId.P1),
        discard: [inst("abra", PlayerId.P1, Zone.Discard), inst("fire", PlayerId.P1, Zone.Discard)],
        lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2,
        name: "P2",
        deck: deck(PlayerId.P2),
        hand: [inst("abra", PlayerId.P2, Zone.Hand), inst("fez", PlayerId.P2, Zone.Hand)],
        active: active("fez", PlayerId.P2),
        bench: [bench("abra", PlayerId.P2), bench("kadabra", PlayerId.P2)],
        prizes: prizes(PlayerId.P2),
        discard: [inst("abra", PlayerId.P2, Zone.Discard)],
        lostZone: [],
      },
    },
    stadium: null,
    stadiumOwnerId: null,
    definitions: defs,
    log: [],
    actionLog: [],
    winnerId: null,
    rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null,
    pendingAction: null,
    heldCard: null,
    itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: true, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: true, [PlayerId.P2]: false },
  };
}

function fingerprint(state: EngineState): string {
  const pack = (id: PlayerId) => {
    const player = getPlayer(state, id);
    const mones = [...(player.active ? [player.active] : []), ...player.bench];
    return {
      hand: player.hand.map((card) => card.definitionId),
      deck: player.deck.map((card) => card.instanceId),
      discard: player.discard.map((card) => card.definitionId),
      prizes: player.prizes.length,
      lost: player.lostZone.length,
      board: mones.map((card) => ({
        id: card.instanceId,
        dmg: card.damageCounters,
        energy: card.attachedEnergy.length,
        tools: card.attachedTools.length,
        status: card.statusConditions,
      })),
    };
  };
  return JSON.stringify({
    pending: state.pendingAction,
    log: state.log,
    flags: state.turnFlags,
    stadium: state.stadium?.definitionId ?? null,
    winner: state.winnerId,
    held: state.heldCard?.definitionId ?? null,
    itemBlock: state.itemPlayBlockedForPlayerId,
    p1: pack(PlayerId.P1),
    p2: pack(PlayerId.P2),
  });
}

describe("each Standard card", () => {
  const cards = loadStandardCorpus().cards;

  it("parses every indexed card's attack, ability, and trainer text", () => {
    let attacks = 0;
    let abilities = 0;
    let trainers = 0;
    for (const card of cards) {
      for (const attack of card.attacks) {
        parseAttackText(attack.text);
        attacks += 1;
      }
      for (const ability of card.abilities) {
        parseAbilityText({ name: ability.name, type: "Ability", text: ability.text });
        abilities += 1;
      }
      if (card.trainerRules?.text) {
        parseTrainerText(trainerDef(card));
        trainers += 1;
      }
    }
    expect(cards.length).toBeGreaterThan(2500);
    expect(attacks).toBeGreaterThan(2000);
    expect(abilities).toBeGreaterThan(400);
    expect(trainers).toBeGreaterThan(300);
  });

  it("plays every implemented trainer and the effect changes the board", () => {
    const seen = new Set<string>();
    const silent: string[] = [];
    const threw: string[] = [];
    let checked = 0;

    for (const card of cards) {
      if (card.supertype !== "Trainer" || !card.trainerRules?.text) continue;
      if (seen.has(card.trainerRules.text)) continue;
      seen.add(card.trainerRules.text);

      const def = trainerDef(card);
      if (isStadium(def) || isTool(def)) continue;
      const parsed = parseTrainerText(def);
      if (parsed.implementationCoverage !== "implemented") continue;

      checked += 1;
      const state = richState();
      state.definitions[def.apiId] = def;
      const before = fingerprint(state);
      try {
        applyTrainerEffect(state, PlayerId.P1, def);
      } catch (error) {
        threw.push(`${card.name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (fingerprint(state) === before) {
        silent.push(`${card.name} (${card.set} ${card.number})`);
      }
    }

    expect(threw, threw.join("\n")).toEqual([]);
    expect(silent, silent.join("\n")).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  });

  it("applies every attack that only gives the opponent's Active a Special Condition", () => {
    const seen = new Set<string>();
    const failures: string[] = [];
    let checked = 0;

    for (const card of cards) {
      if (card.supertype !== "Pokémon") continue;
      for (const attack of card.attacks) {
        if (!attack.text || seen.has(attack.text)) continue;
        seen.add(attack.text);
        const effects = parseAttackText(attack.text);
        if (effects.length !== 1 || effects[0]?.kind !== "status") continue;
        const effect = effects[0];
        if (effect.target !== "opponent_active") continue;

        checked += 1;
        const state = richState();
        const source = getPlayer(state, PlayerId.P1).active!;
        const target = getPlayer(state, PlayerId.P2).active!;
        executeEffects(
          state,
          { playerId: PlayerId.P1, sourcePokemon: source, opponentId: PlayerId.P2, attackName: attack.name },
          effects,
        );
        if (!target.statusConditions.includes(effect.status)) {
          failures.push(`${card.name} · ${attack.name}: expected ${effect.status}`);
        }
      }
    }

    expect(failures, failures.slice(0, 20).join("\n")).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it("applies recoil for every attack whose text only damages the attacker", () => {
    const seen = new Set<string>();
    const failures: string[] = [];
    let checked = 0;

    for (const card of cards) {
      if (card.supertype !== "Pokémon") continue;
      for (const attack of card.attacks) {
        if (!attack.text || seen.has(attack.text)) continue;
        seen.add(attack.text);
        const effects = parseAttackText(attack.text);
        if (effects.length !== 1 || effects[0]?.kind !== "self_recoil") continue;
        const effect = effects[0];

        checked += 1;
        const state = richState();
        const source = getPlayer(state, PlayerId.P1).active!;
        const before = source.damageCounters;
        executeEffects(
          state,
          { playerId: PlayerId.P1, sourcePokemon: source, opponentId: PlayerId.P2, attackName: attack.name },
          effects,
        );
        if (source.damageCounters - before !== effect.amount) {
          failures.push(`${card.name} · ${attack.name}: expected +${effect.amount}`);
        }
      }
    }

    expect(failures, failures.slice(0, 20).join("\n")).toEqual([]);
    expect(checked).toBeGreaterThan(3);
  });

  it("lets Call Bell search a Supporter only on the first turn of the player going second", () => {
    const callBell = cards.find((card) => card.name === "Call Bell");
    expect(callBell?.trainerRules?.text).toContain("only if you go second");
    const def = trainerDef(callBell!);

    const tooLate = richState();
    tooLate.definitions[def.apiId] = def;
    applyTrainerEffect(tooLate, PlayerId.P1, def);
    expect(tooLate.pendingAction).toBeNull();
    expect(tooLate.log.some((line) => line.includes("Call Bell"))).toBe(true);
    expect(getPlayer(tooLate, PlayerId.P1).hand.some((card) => card.definitionId === "judge")).toBe(false);

    const legal = richState();
    legal.turnNumber = 2;
    legal.firstPlayerId = PlayerId.P2;
    legal.currentPlayerId = PlayerId.P1;
    legal.definitions[def.apiId] = def;
    applyTrainerEffect(legal, PlayerId.P1, def);
    expect(legal.pendingAction?.type).toBe("SEARCH_DECK");
    if (legal.pendingAction?.type === "SEARCH_DECK") {
      expect(legal.pendingAction.filter).toBe("SUPPORTER_HAND");
      expect(legal.pendingAction.options.length).toBe(2);
    }
  });
});
