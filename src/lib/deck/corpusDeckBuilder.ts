import { normalizeSetCode } from "../catalog/setCodeMap";
import { loadStandardCorpus } from "../format/loadStandardCorpus";
import type { StandardCardIndex } from "../format/prepareStandardCorpus";
import type { CardAbility, CardAttack, CardDefinition } from "../models/definition";
import type { BuiltDeck } from "./builder";
import { lookupFetchedAttackCost } from "./attackCostsData";
import { lookupAttackCost } from "./knownAttackCosts";
import { parseLimitlessDeckList, type ParsedDeckLine } from "./limitlessParser";
import { resolveTrainerRulesText } from "./trainerStubTexts";
import { validateDeck, type DeckValidationResult } from "./validator";

export function findCorpusCard(
  setCode: string,
  number: string,
  name?: string,
): StandardCardIndex | undefined {
  const set = normalizeSetCode(setCode);
  if (!set) return undefined;
  return loadStandardCorpus().cards.find(
    (entry) =>
      entry.set === set &&
      entry.number === number &&
      (!name || entry.name.toLowerCase() === name.toLowerCase()),
  );
}

/**
 * Look a card up by name only — used as a fallback to classify a Trainer's
 * subtype (Item / Tool / Supporter / Stadium) when the deck list cites a
 * printing (set + number) that is not in the current Standard corpus. A card's
 * subtype is the same across reprints, so name alone is sufficient here.
 */
export function findCorpusCardByName(name: string): StandardCardIndex | undefined {
  const lower = name.toLowerCase();
  return loadStandardCorpus().cards.find((entry) => entry.name.toLowerCase() === lower);
}

export function validateDeckTextAgainstCorpus(text: string): {
  missing: string[];
  resolved: number;
  pokemonResolved: number;
  pokemonMissing: string[];
} {
  const parsed = parseLimitlessDeckList(text);
  const missing: string[] = [];
  const pokemonMissing: string[] = [];
  let resolved = 0;
  let pokemonResolved = 0;

  for (const line of parsed.lines) {
    if (!line.setCode || !line.number) {
      missing.push(`${line.count} ${line.name} (no set/number)`);
      if (line.section === "Pokémon") {
        pokemonMissing.push(`${line.count} ${line.name} (no set/number)`);
      }
      continue;
    }
    const match = findCorpusCard(line.setCode, line.number, line.name);
    if (!match) {
      missing.push(`${line.count} ${line.name} ${line.setCode} ${line.number}`);
      if (line.section === "Pokémon") {
        pokemonMissing.push(`${line.count} ${line.name} ${line.setCode} ${line.number}`);
      }
      continue;
    }
    resolved += line.count;
    if (line.section === "Pokémon") {
      pokemonResolved += line.count;
    }
  }

  return { missing, resolved, pokemonResolved, pokemonMissing };
}

const EVOLUTION_PARENT: Record<string, string> = {
  drakloak: "Dreepy",
  "dragapult ex": "Drakloak",
  dusclops: "Duskull",
  dusknoir: "Dusclops",
  dudunsparce: "Dunsparce",
  "dudunsparce ex": "Dunsparce",
  kadabra: "Abra",
  alakazam: "Kadabra",
  "mega lopunny ex": "Buneary",
  froslass: "Snorunt",
  glalie: "Snorunt",
  "mega froslass ex": "Froslass",
  frogadier: "Froakie",
  "greninja ex": "Frogadier",
  "mega greninja ex": "Frogadier",
  "mega pyroar ex": "Litleo",
  "mega dragalge ex": "Skrelp",
  "mega gallade ex": "Kirlia",
  "team rocket's honchkrow": "Team Rocket's Murkrow",
  "team rocket's porygon2": "Team Rocket's Porygon",
  // Note: Team Rocket's Articuno is a Basic Pokémon — NOT an evolution of Murkrow
  // Cynthia's Garchomp chain
  "cynthia's roserade": "Cynthia's Roselia",
  "cynthia's gabite": "Cynthia's Gible",
  "cynthia's garchomp ex": "Cynthia's Gabite",
  // N's Zoroark chain
  "n's zoroark ex": "N's Zorua",
  "n's darmanitan": "N's Darumaka",
  // Hydrapple chain
  dipplin: "Applin",
  "hydrapple ex": "Dipplin",
  // Meganium chain
  bayleef: "Chikorita",
  meganium: "Bayleef",
};

const SUPPORTER_NAMES = new Set([
  "Boss's Orders",
  "Lillie's Determination",
  "Iono",
  "Judge",
  "Crispin",
  "Hilda",
  "Team Rocket's Ariana",
  "Team Rocket's Archer",
  "Team Rocket's Giovanni",
  "Team Rocket's Proton",
  "Team Rocket's Petrel",
  "Team Rocket's Transceiver",
  "Rosa's Encouragement",
]);

const STADIUM_NAMES = new Set([
  "Area Zero Underdepths",
  "Risky Ruins",
  "Team Rocket's Watchtower",
  "Team Rocket's Factory",
  "Battle Cage",
]);

const ENERGY_TYPE_BY_NAME: Record<string, string[]> = {
  "Psychic Energy": ["Psychic"],
  "Fire Energy": ["Fire"],
  "Darkness Energy": ["Darkness"],
  "Grass Energy": ["Grass"],
  "Water Energy": ["Water"],
  "Lightning Energy": ["Lightning"],
  "Fighting Energy": ["Fighting"],
  "Metal Energy": ["Metal"],
  "Mist Energy": ["Colorless"],
  "Enriching Energy": ["Colorless"],
  "Team Rocket's Energy": ["Darkness"],
  "Ignition Energy": ["Fire"],
};

function inferEnergyTypes(name: string): string[] {
  for (const [label, types] of Object.entries(ENERGY_TYPE_BY_NAME)) {
    if (name.toLowerCase().includes(label.toLowerCase())) return types;
  }
  return ["Colorless"];
}

function inferPokemonTypes(name: string, deckEnergyTypes: Set<string>): string[] {
  const lower = name.toLowerCase();
  if (lower.includes("froakie") || lower.includes("frogadier") || lower.includes("greninja")) {
    return ["Water"];
  }
  if (lower.includes("litleo") || lower.includes("pyroar")) {
    return ["Fire"];
  }
  if (lower.includes("skrelp") || lower.includes("dragalge")) {
    return ["Psychic"];
  }
  if (lower.includes("floette") || lower.includes("flabebe")) {
    return ["Psychic"];
  }
  if (lower.includes("gallade") || lower.includes("ralts") || lower.includes("kirlia")) {
    return ["Psychic"];
  }
  if (lower.includes("munkidori") || lower.includes("alakazam")) {
    return ["Psychic"];
  }
  if (lower.includes("dragapult") || lower.includes("dreepy") || lower.includes("drakloak")) {
    return ["Psychic"];
  }
  if (lower.includes("hydrapple") || lower.includes("dipplin") || lower.includes("ogerpon")) {
    return ["Grass"];
  }
  if (lower.includes("honchkrow") || lower.includes("murkrow") || lower.includes("zoroark")) {
    return ["Darkness"];
  }
  if (lower.includes("lopunny") || lower.includes("buneary")) {
    return ["Colorless"];
  }
  if (lower.includes("garchomp") || lower.includes("gible") || lower.includes("gabite")) {
    return ["Fighting"];
  }
  if (deckEnergyTypes.size === 1) {
    return [...deckEnergyTypes];
  }
  return ["Colorless"];
}

function inferHp(name: string, subtypes: string[]): string {
  const known: Record<string, string> = {
    Budew: "30",
    Dunsparce: "60",
    Dreepy: "60",
  };
  if (known[name]) return known[name];
  if (subtypes.includes("VMAX")) return "320";
  if (subtypes.includes("VSTAR")) return "280";
  if (subtypes.includes("V")) return "220";
  if (subtypes.includes("ex") || subtypes.includes("EX")) return "330";
  if (subtypes.includes("Stage 2")) return "150";
  if (subtypes.includes("Stage 1")) return "90";
  return "70";
}

function inferSubtypes(name: string, pokemonNames: Set<string>): string[] {
  const subtypes: string[] = [];
  if (/\bVMAX\b/i.test(name)) subtypes.push("VMAX");
  else if (/\bVSTAR\b/i.test(name)) subtypes.push("VSTAR");
  else if (/\bV\b/.test(name) && !/\bVMAX\b|\bVSTAR\b/i.test(name)) subtypes.push("V");
  if (/\bex\b/i.test(name)) subtypes.push("ex");

  const parentName = EVOLUTION_PARENT[name.toLowerCase()];
  if (parentName && pokemonNames.has(parentName)) {
    const parentKey = parentName.toLowerCase();
    const grandparentName = EVOLUTION_PARENT[parentKey];
    subtypes.push(grandparentName && pokemonNames.has(grandparentName) ? "Stage 2" : "Stage 1");
    return subtypes;
  }

  if (subtypes.length === 0 || (!subtypes.includes("Stage 1") && !subtypes.includes("Stage 2"))) {
    subtypes.unshift("Basic");
  }
  return subtypes;
}

function buildAttacks(card: StandardCardIndex, types: string[]): CardAttack[] {
  const primaryType = types[0] ?? "Colorless";
  return card.attacks.map((attack) => {
    // Priority 1: the indexed cost from the Pokémon TCG API — the canonical
    // source. Present once the corpus is rebuilt with cost preserved.
    if (attack.cost && attack.cost.length >= 0 && Array.isArray(attack.cost)) {
      return {
        name: attack.name,
        cost: [...attack.cost],
        convertedEnergyCost: attack.convertedEnergyCost ?? attack.cost.length,
        damage: attack.damage,
        text: attack.text,
      };
    }

    // Priority 2: pre-fetched authoritative dataset
    // (data/standard/attack-costs.json, generated by scripts/fetchAttackCosts.ts).
    // Loads costs the live API gave us at the most recent run — no live
    // round-trip required.
    const fetched = lookupFetchedAttackCost(card.name, attack.name);
    if (fetched) {
      return {
        name: attack.name,
        cost: [...fetched.cost],
        convertedEnergyCost: fetched.convertedEnergyCost,
        damage: attack.damage,
        text: attack.text,
      };
    }

    // Priority 3: hand-curated override for cards still missing from the
    // fetched dataset. See knownAttackCosts.ts for the rationale.
    const known = lookupAttackCost(card.name, attack.name);
    if (known) {
      return {
        name: attack.name,
        cost: [...known.cost],
        convertedEnergyCost: known.convertedEnergyCost ?? known.cost.length,
        damage: attack.damage,
        text: attack.text,
      };
    }

    // Priority 3 (last resort): 1 energy of the inferred primary type.
    // Zero-cost for Discard-Energy attacks so the engine can still simulate
    // them when the cost is dynamic.
    const cost = attack.text.includes("Discard") && attack.text.includes("Energy")
      ? []
      : [primaryType];
    return {
      name: attack.name,
      cost,
      convertedEnergyCost: cost.length,
      damage: attack.damage,
      text: attack.text,
    };
  });
}

function buildAbilities(card: StandardCardIndex): CardAbility[] {
  return card.abilities.map((ability) => ({
    name: ability.name,
    text: ability.text,
    type: "Ability",
  }));
}

function resolveSubtypes(
  card: StandardCardIndex,
  line: ParsedDeckLine,
  pokemonNames: Set<string>,
): string[] {
  if (card.subtypes.length > 0) {
    return [...card.subtypes];
  }
  return inferSubtypes(line.name, pokemonNames);
}

function resolveEvolvesFrom(name: string, pokemonNames: Set<string>): string | undefined {
  const parentName = EVOLUTION_PARENT[name.toLowerCase()];
  if (parentName && pokemonNames.has(parentName)) return parentName;
  return undefined;
}

function corpusCardToDefinition(
  card: StandardCardIndex,
  line: ParsedDeckLine,
  pokemonNames: Set<string>,
  deckEnergyTypes: Set<string>,
): CardDefinition {
  const subtypes = resolveSubtypes(card, line, pokemonNames);
  const parentName = resolveEvolvesFrom(line.name, pokemonNames);
  const types = inferPokemonTypes(line.name, deckEnergyTypes);
  const setCode = normalizeSetCode(line.setCode ?? card.set) ?? card.set;

  return {
    apiId: card.apiId,
    name: line.name,
    supertype: "Pokémon",
    subtypes,
    hp: card.hp ?? inferHp(line.name, subtypes),
    types,
    attacks: buildAttacks(card, types),
    abilities: buildAbilities(card),
    evolvesFrom: parentName,
    regulationMark: card.regulationMark,
    set: { id: setCode.toLowerCase(), name: setCode, ptcgoCode: setCode },
    number: line.number ?? card.number,
    images: { small: "", large: "" },
  };
}

function stubTrainerDefinition(line: ParsedDeckLine, corpusSubtypes?: string[]): CardDefinition {
  const setCode = normalizeSetCode(line.setCode ?? "TST") ?? "TST";
  const apiId = `${setCode}-${line.number ?? line.name}`.toLowerCase().replace(/\s+/g, "-");

  let subtypes: string[];
  if (corpusSubtypes && corpusSubtypes.length > 0) {
    // Authoritative: use the real Trainer subtype from the Standard corpus
    // (Supporter / Item / Stadium / Pokémon Tool / ACE SPEC). The old
    // hard-coded name lists missed many Supporters and Stadiums and silently
    // mislabelled them as Items — a Supporter mislabelled as an Item never sets
    // turnFlags.supporterPlayed, so the AI could play it AND a real Supporter
    // in the same turn (two Supporters/turn); Stadiums-as-Items never entered
    // the Stadium zone or applied their effects.
    subtypes = [...corpusSubtypes];
  } else {
    // Fallback for cards not present in the corpus: name-based heuristics.
    subtypes = ["Item"];
    if (SUPPORTER_NAMES.has(line.name) || line.name.includes("Determination")) {
      subtypes = ["Supporter"];
    } else if (STADIUM_NAMES.has(line.name)) {
      subtypes = ["Stadium"];
    } else if (/ace spec/i.test(line.name) || line.name === "Unfair Stamp" || line.name === "Night Stretcher") {
      subtypes = ["Item", "ACE SPEC"];
    }
  }

  return {
    apiId,
    name: line.name,
    supertype: "Trainer",
    subtypes,
    rules: resolveTrainerRulesText(line.name),
    set: { id: setCode.toLowerCase(), name: setCode, ptcgoCode: setCode },
    number: line.number ?? "1",
    images: { small: "", large: "" },
  };
}

function stubEnergyDefinition(line: ParsedDeckLine, corpus?: StandardCardIndex): CardDefinition {
  const setCode = normalizeSetCode(line.setCode ?? "MEE") ?? "MEE";
  const types = inferEnergyTypes(line.name);
  const apiId = `${setCode}-${line.number ?? line.name}`.toLowerCase().replace(/\s+/g, "-");

  // Authoritative subtype from the corpus when the printing is indexed (e.g.
  // the CRI Special Energies). The name heuristic below tags every card whose
  // name contains "Energy" as Basic — wrong for Special Energies, which must
  // be capped at 4 copies by the validator and stay visible to
  // discard-special-energy effects.
  const subtypes =
    corpus && corpus.subtypes.length > 0
      ? [...corpus.subtypes]
      : line.name.toLowerCase().includes("energy")
        ? ["Basic"]
        : ["Special"];

  return {
    apiId,
    name: line.name,
    supertype: "Energy",
    subtypes,
    rules: corpus?.trainerRules ? [corpus.trainerRules.text] : undefined,
    types,
    set: { id: setCode.toLowerCase(), name: setCode, ptcgoCode: setCode },
    number: line.number ?? "1",
    images: { small: "", large: "" },
  };
}

function lineToDefinition(
  line: ParsedDeckLine,
  pokemonNames: Set<string>,
  deckEnergyTypes: Set<string>,
): { definition?: CardDefinition; error?: string } {
  if (line.section === "Energy") {
    // Special Energies (e.g. CRI 84-86) are indexed in the corpus; basic
    // energies are not (the corpus only fetches Pokémon/Trainer supertypes)
    // and fall through to the name-based stub.
    const corpus =
      (line.setCode && line.number
        ? findCorpusCard(line.setCode, line.number, line.name)
        : undefined) ?? findCorpusCardByName(line.name);
    return { definition: stubEnergyDefinition(line, corpus) };
  }
  if (line.section === "Trainer") {
    // Consult the corpus so Tools are classified correctly instead of
    // defaulting to Item. Fall back to a name-only lookup when the cited
    // printing (set + number) isn't in the current Standard corpus (e.g. an
    // older Air Balloon reprint).
    const corpus =
      (line.setCode && line.number
        ? findCorpusCard(line.setCode, line.number, line.name)
        : undefined) ?? findCorpusCardByName(line.name);
    return { definition: stubTrainerDefinition(line, corpus?.subtypes) };
  }

  if (!line.setCode || !line.number) {
    return { error: `${line.count} ${line.name} (no set/number)` };
  }
  const match = findCorpusCard(line.setCode, line.number, line.name);
  if (!match) {
    return { error: `${line.count} ${line.name} ${line.setCode} ${line.number}` };
  }
  return {
    definition: corpusCardToDefinition(match, line, pokemonNames, deckEnergyTypes),
  };
}

/**
 * Build a 60-card deck synchronously from a Limitless list using the Standard corpus
 * for Pokémon (real attack/ability text) and corpus-backed rules text for Trainer/Energy stubs.
 */
export function buildPlaytestDeckFromCorpusText(name: string, text: string): BuiltDeck {
  const parsed = parseLimitlessDeckList(text);
  const pokemonNames = new Set(
    parsed.lines.filter((line) => line.section === "Pokémon").map((line) => line.name),
  );
  const deckEnergyTypes = new Set(
    parsed.lines
      .filter((line) => line.section === "Energy")
      .flatMap((line) => inferEnergyTypes(line.name)),
  );

  const definitions = new Map<string, CardDefinition>();
  const cards: CardDefinition[] = [];
  const resolveErrors: string[] = [...parsed.errors];

  for (const line of parsed.lines) {
    const { definition, error } = lineToDefinition(line, pokemonNames, deckEnergyTypes);
    if (error) {
      resolveErrors.push(error);
      continue;
    }
    if (!definition) continue;
    definitions.set(definition.apiId, definition);
    for (let i = 0; i < line.count; i += 1) {
      cards.push(definition);
    }
  }

  const validation: DeckValidationResult = validateDeck(cards);

  return {
    id: `corpus-${name}`,
    name,
    text,
    lines: parsed.lines,
    cards,
    definitions,
    validation,
    resolveErrors,
  };
}
