import { normalizeSetCode } from "../catalog/setCodeMap";
import { loadStandardCorpus } from "../format/loadStandardCorpus";
import type { StandardCardIndex } from "../format/prepareStandardCorpus";
import type { CardAbility, CardAttack, CardDefinition } from "../models/definition";
import type { BuiltDeck } from "./builder";
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
    // First: use the curated override table when we have authoritative data.
    // This is the only source of accurate multi-energy costs (the corpus
    // index doesn't preserve them).
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
    // Fallback for unknown cards: assume 1 energy of the primary type, except
    // for Discard-Energy attacks which are treated as "no fixed cost" so the
    // engine can still simulate them at all.
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

function stubTrainerDefinition(line: ParsedDeckLine): CardDefinition {
  const setCode = normalizeSetCode(line.setCode ?? "TST") ?? "TST";
  const apiId = `${setCode}-${line.number ?? line.name}`.toLowerCase().replace(/\s+/g, "-");
  let subtypes = ["Item"];
  if (SUPPORTER_NAMES.has(line.name) || line.name.includes("Determination")) {
    subtypes = ["Supporter"];
  } else if (STADIUM_NAMES.has(line.name)) {
    subtypes = ["Stadium"];
  } else if (/ace spec/i.test(line.name) || line.name === "Unfair Stamp" || line.name === "Night Stretcher") {
    subtypes = ["Item", "ACE SPEC"];
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

function stubEnergyDefinition(line: ParsedDeckLine): CardDefinition {
  const setCode = normalizeSetCode(line.setCode ?? "MEE") ?? "MEE";
  const types = inferEnergyTypes(line.name);
  const apiId = `${setCode}-${line.number ?? line.name}`.toLowerCase().replace(/\s+/g, "-");

  return {
    apiId,
    name: line.name,
    supertype: "Energy",
    subtypes: line.name.toLowerCase().includes("energy") ? ["Basic"] : ["Special"],
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
    return { definition: stubEnergyDefinition(line) };
  }
  if (line.section === "Trainer") {
    return { definition: stubTrainerDefinition(line) };
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
