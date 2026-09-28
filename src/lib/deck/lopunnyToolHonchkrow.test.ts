import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../models/definition";
import { createCardInstance } from "../models/instance";
import { GamePhase, PlayerId, Zone } from "../models/enums";
import { pickAutoToolAction, pickAutoTrainerAction, pickBestAttack, pickRetreatAction, runAIOneStep } from "./metaGameRunner";
import { buildStrategyContext } from "./deckStrategy";
import { emptyTurnFlags, type EngineState } from "../engine/types";

function mockPokemon(
  name: string,
  opts: { hp?: string; types?: string[]; attacks?: CardDefinition["attacks"]; subtypes?: string[] } = {},
): CardDefinition {
  return {
    apiId: name,
    name,
    supertype: "Pokémon",
    subtypes: opts.subtypes ?? ["Basic"],
    hp: opts.hp ?? "120",
    types: opts.types ?? ["Colorless"],
    abilities: [],
    attacks: opts.attacks ?? [],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function mockAirBalloon(): CardDefinition {
  return {
    apiId: "air-balloon",
    name: "Air Balloon",
    supertype: "Trainer",
    subtypes: ["Pokémon Tool"],
    rules: ["The Pokémon this card is attached to has no Retreat Cost."],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function baseState(
  definitions: Record<string, CardDefinition>,
  p1: { active: ReturnType<typeof createCardInstance>; bench?: ReturnType<typeof createCardInstance>[]; hand?: ReturnType<typeof createCardInstance>[] },
  p2Active: ReturnType<typeof createCardInstance>,
  turnNumber = 3,
): EngineState {
  return {
    phase: GamePhase.Active,
    turnNumber,
    currentPlayerId: PlayerId.P1,
    viewingPlayerId: PlayerId.P1,
    firstPlayerId: PlayerId.P1,
    players: {
      [PlayerId.P1]: {
        id: PlayerId.P1, name: "P1",
        deck: Array.from({ length: 20 }, () => createCardInstance("filler", PlayerId.P1, Zone.Deck)),
        hand: p1.hand ?? [], active: p1.active, bench: p1.bench ?? [],
        prizes: [], discard: [], lostZone: [],
      },
      [PlayerId.P2]: {
        id: PlayerId.P2, name: "P2", deck: [], hand: [], active: p2Active, bench: [],
        prizes: [], discard: [], lostZone: [],
      },
    },
    stadium: null, stadiumOwnerId: null,
    definitions: { ...definitions, filler: mockPokemon("Filler") },
    log: [], actionLog: [], winnerId: null, rngSeed: 1,
    turnFlags: emptyTurnFlags(),
    pendingMulliganPlayerId: null, pendingAction: null, heldCard: null, itemPlayBlockedForPlayerId: null,
    teamRocketKnockedOutSinceMyLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    legacyEnergyPrizeReductionUsed: { [PlayerId.P1]: false, [PlayerId.P2]: false },
    ownPokemonKnockedOutOpponentLastTurn: { [PlayerId.P1]: false, [PlayerId.P2]: false },
  };
}

describe("pickAutoToolAction — Air Balloon onto Mega Lopunny ex", () => {
  it("attaches Air Balloon to bench Mega Lopunny ex over a non-Lopunny active", () => {
    const defs = {
      "lopunny-def": mockPokemon("Mega Lopunny ex", { hp: "330", subtypes: ["Stage 2", "MEGA", "ex"] }),
      "dunsparce-def": mockPokemon("Dudunsparce", { hp: "140" }),
      "air-balloon": mockAirBalloon(),
      "opp-def": mockPokemon("Opponent"),
    };
    const active = createCardInstance("dunsparce-def", PlayerId.P1, Zone.Active);
    const lopunny = createCardInstance("lopunny-def", PlayerId.P1, Zone.Bench);
    const balloon = createCardInstance("air-balloon", PlayerId.P1, Zone.Hand);
    const oppActive = createCardInstance("opp-def", PlayerId.P2, Zone.Active);

    const state = baseState(defs, { active, bench: [lopunny], hand: [balloon] }, oppActive);
    const ctx = buildStrategyContext(["Mega Lopunny ex", "Dudunsparce", "Buneary"]);

    const action = pickAutoToolAction(state, ctx);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("ATTACH_TOOL");
    expect(action!.toolId).toBe(balloon.instanceId);
    expect(action!.targetId).toBe(lopunny.instanceId); // → the Lopunny, not the active Dudunsparce
  });
});

describe("Honchkrow — Rocket Feathers fires only when lethal", () => {
  function honchkrowState(trSupportersInHand: number, oppHp: string, turnNumber = 4): EngineState {
    const honchkrow = mockPokemon("Team Rocket's Honchkrow", {
      hp: "150",
      types: ["Darkness"],
      attacks: [{ name: "Rocket Feathers", cost: ["Darkness"], convertedEnergyCost: 1, damage: "60", text: "Discard any number of Team Rocket Supporter cards from your hand. This attack does 60 damage for each card discarded." }],
    });
    const ariana = mockPokemon("Team Rocket's Ariana"); // placeholder def; replaced below for supporters
    const supporterDef: CardDefinition = {
      apiId: "tr-ariana", name: "Team Rocket's Ariana", supertype: "Trainer", subtypes: ["Supporter"],
      set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" },
    };
    void ariana;

    const active = createCardInstance("honchkrow-def", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [createCardInstance("dark-energy", PlayerId.P1, Zone.Active)];
    const hand = Array.from({ length: trSupportersInHand }, () =>
      createCardInstance("tr-ariana", PlayerId.P1, Zone.Hand),
    );
    const oppActive = createCardInstance("opp-def", PlayerId.P2, Zone.Active);

    const defs = {
      "honchkrow-def": honchkrow,
      "tr-ariana": supporterDef,
      "dark-energy": { apiId: "dark-energy", name: "Darkness Energy", supertype: "Energy", subtypes: ["Basic"], types: ["Darkness"], set: { id: "t", name: "T" }, number: "1", images: { small: "", large: "" } } as CardDefinition,
      "opp-def": mockPokemon("Opponent", { hp: oppHp }),
    };
    return baseState(defs, { active, bench: [], hand }, oppActive, turnNumber);
  }

  const ctx = buildStrategyContext(["Team Rocket's Honchkrow", "Team Rocket's Murkrow", "Team Rocket's Ariana"]);

  it("does NOT attack when Rocket Feathers can't KO (keeps loading the hand)", () => {
    // 2 supporters → 120 damage vs 200 HP opponent → not lethal.
    const state = honchkrowState(2, "200");
    expect(pickBestAttack(state, PlayerId.P1, ctx)).toBeNull();
  });

  it("attacks when Rocket Feathers is lethal", () => {
    // 4 supporters → 240 damage vs 200 HP opponent → lethal.
    const state = honchkrowState(4, "200");
    expect(pickBestAttack(state, PlayerId.P1, ctx)).toBe("Rocket Feathers");
  });
});

function colorlessEnergy(): CardDefinition {
  return {
    apiId: "colorless-energy",
    name: "Colorless Energy",
    supertype: "Energy",
    subtypes: ["Basic"],
    types: ["Colorless"],
    set: { id: "t", name: "T" },
    number: "1",
    images: { small: "", large: "" },
  };
}

function attachColorless(owner: PlayerId): ReturnType<typeof createCardInstance> {
  return createCardInstance("colorless-energy", owner, Zone.Attached);
}

describe("AI skill — weakness, prizes, and taking the KO", () => {
  const hit = (name: string, damage: string): NonNullable<CardDefinition["attacks"]>[number] => ({
    name,
    damage,
    cost: ["Colorless"],
    text: "",
  });

  it("picks the attack that KOs through weakness over a signature attack that does not", () => {
    const attacker = mockPokemon("Striker", {
      hp: "200",
      types: ["Fighting"],
      attacks: [hit("Poke", "60"), hit("Smash", "100")],
    });
    const defender = mockPokemon("Target", { hp: "180", types: ["Colorless"] });
    defender.weaknesses = [{ type: "Fighting", value: "×2" }];
    const active = createCardInstance("striker", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attachColorless(PlayerId.P1)];
    const opp = createCardInstance("target", PlayerId.P2, Zone.Active);
    const state = baseState(
      { striker: attacker, target: defender, "colorless-energy": colorlessEnergy() },
      { active },
      opp,
    );
    const detected = buildStrategyContext(["Rattata"]);
    const ctx = { archetype: detected.archetype, profile: { ...detected.profile, signatureAttack: "Poke" } };

    expect(pickBestAttack(state, PlayerId.P1, ctx)).toBe("Smash");
  });

  it("retreats into a benched attacker that can KO when the Active cannot", () => {
    const lead = mockPokemon("Lead", { hp: "200", types: ["Colorless"], attacks: [hit("Nibble", "20")] });
    const finisher = mockPokemon("Finisher", { hp: "200", types: ["Colorless"], attacks: [hit("Crush", "200")] });
    const defender = mockPokemon("Target", { hp: "100" });
    const active = createCardInstance("lead", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attachColorless(PlayerId.P1)];
    const bench = createCardInstance("finisher", PlayerId.P1, Zone.Bench);
    bench.attachedEnergy = [attachColorless(PlayerId.P1)];
    const opp = createCardInstance("target", PlayerId.P2, Zone.Active);
    const state = baseState(
      { lead, finisher, target: defender, "colorless-energy": colorlessEnergy() },
      { active, bench: [bench] },
      opp,
    );

    expect(pickRetreatAction(state, PlayerId.P1)?.benchInstanceId).toBe(bench.instanceId);
  });

  it("Boss's Orders pulls the prize-heavier KO, counting weakness", () => {
    const attacker = mockPokemon("Striker", {
      hp: "200",
      types: ["Fighting"],
      attacks: [hit("Smash", "110")],
    });
    const wall = mockPokemon("Wall", { hp: "300" });
    const ex = mockPokemon("Absol ex", { hp: "200", types: ["Darkness"], subtypes: ["Basic", "ex"] });
    ex.weaknesses = [{ type: "Fighting", value: "×2" }];
    const basic = mockPokemon("Rookie", { hp: "50" });
    const active = createCardInstance("striker", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attachColorless(PlayerId.P1)];
    const oppActive = createCardInstance("wall", PlayerId.P2, Zone.Active);
    const oppEx = createCardInstance("ex", PlayerId.P2, Zone.Bench);
    const oppBasic = createCardInstance("rookie", PlayerId.P2, Zone.Bench);
    const state = baseState(
      {
        striker: attacker,
        wall,
        ex,
        rookie: basic,
        "colorless-energy": colorlessEnergy(),
      },
      { active },
      oppActive,
    );
    state.players[PlayerId.P2].bench = [oppEx, oppBasic];
    state.pendingAction = { type: "BOSS_ORDERS", playerId: PlayerId.P1 };
    const ctx = buildStrategyContext(["Rattata"]);

    const next = runAIOneStep(state, ctx, PlayerId.P1).state;
    expect(next.players[PlayerId.P2].active?.definitionId).toBe("ex");
  });

  it("knocks out through weakness before playing Boss's Orders", () => {
    const attacker = mockPokemon("Striker", {
      hp: "200",
      types: ["Fighting"],
      attacks: [hit("Smash", "60")],
    });
    const defender = mockPokemon("Target", { hp: "100", types: ["Colorless"] });
    defender.weaknesses = [{ type: "Fighting", value: "×2" }];
    const benchDef = mockPokemon("Bench", { hp: "60" });
    const boss: CardDefinition = {
      apiId: "boss",
      name: "Boss's Orders",
      supertype: "Trainer",
      subtypes: ["Supporter"],
      rules: ["Switch in 1 of your opponent's Benched Pokémon to the Active Spot."],
      set: { id: "t", name: "T" },
      number: "1",
      images: { small: "", large: "" },
    };
    const active = createCardInstance("striker", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attachColorless(PlayerId.P1)];
    const bossCard = createCardInstance("boss", PlayerId.P1, Zone.Hand);
    const opp = createCardInstance("target", PlayerId.P2, Zone.Active);
    const oppBench = createCardInstance("bench", PlayerId.P2, Zone.Bench);
    const state = baseState(
      { striker: attacker, target: defender, bench: benchDef, boss, "colorless-energy": colorlessEnergy() },
      { active, hand: [bossCard] },
      opp,
    );
    state.players[PlayerId.P2].bench = [oppBench];
    for (const id of [PlayerId.P1, PlayerId.P2]) {
      state.players[id].prizes = [0, 1].map((n) => createCardInstance(`prize-${id}-${n}`, id, Zone.Prizes));
    }
    const ctx = buildStrategyContext(["Rattata"]);

    const next = runAIOneStep(state, ctx, PlayerId.P1).state;
    expect(next.log.some((line) => line.includes("Knocked Out"))).toBe(true);
    expect(next.players[PlayerId.P1].hand.some((card) => card.instanceId === bossCard.instanceId)).toBe(true);
  });

  it("gusts a bench KO before refreshing the hand", () => {
    const attacker = mockPokemon("Striker", {
      hp: "200",
      types: ["Fighting"],
      attacks: [hit("Smash", "110")],
    });
    const wall = mockPokemon("Wall", { hp: "300" });
    const ex = mockPokemon("Absol ex", { hp: "200", types: ["Darkness"], subtypes: ["Basic", "ex"] });
    ex.weaknesses = [{ type: "Fighting", value: "×2" }];
    const boss: CardDefinition = {
      apiId: "boss",
      name: "Boss's Orders",
      supertype: "Trainer",
      subtypes: ["Supporter"],
      set: { id: "t", name: "T" },
      number: "1",
      images: { small: "", large: "" },
    };
    const lillie: CardDefinition = {
      apiId: "lillie",
      name: "Lillie's Determination",
      supertype: "Trainer",
      subtypes: ["Supporter"],
      set: { id: "t", name: "T" },
      number: "2",
      images: { small: "", large: "" },
    };
    const active = createCardInstance("striker", PlayerId.P1, Zone.Active);
    active.attachedEnergy = [attachColorless(PlayerId.P1)];
    const bossCard = createCardInstance("boss", PlayerId.P1, Zone.Hand);
    const lillieCard = createCardInstance("lillie", PlayerId.P1, Zone.Hand);
    const oppActive = createCardInstance("wall", PlayerId.P2, Zone.Active);
    const oppEx = createCardInstance("ex", PlayerId.P2, Zone.Bench);
    const state = baseState(
      {
        striker: attacker,
        wall,
        ex,
        boss,
        lillie,
        "colorless-energy": colorlessEnergy(),
      },
      {
        active,
        hand: [
          bossCard,
          lillieCard,
          createCardInstance("colorless-energy", PlayerId.P1, Zone.Hand),
          createCardInstance("colorless-energy", PlayerId.P1, Zone.Hand),
        ],
      },
      oppActive,
    );
    state.players[PlayerId.P2].bench = [oppEx];
    for (const id of [PlayerId.P1, PlayerId.P2]) {
      state.players[id].prizes = [0, 1, 2, 3].map((n) => createCardInstance(`prize-${id}-${n}`, id, Zone.Prizes));
    }

    const action = pickAutoTrainerAction(state, buildStrategyContext(["Rattata"]));
    expect(action?.instanceId).toBe(bossCard.instanceId);
  });
});
