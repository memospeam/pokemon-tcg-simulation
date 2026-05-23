import { normalizeSetCode } from "../catalog/setCodeMap";
import { loadStandardCorpus } from "../format/loadStandardCorpus";
import type { StandardCardIndex } from "../format/prepareStandardCorpus";
import { parseLimitlessDeckList } from "./limitlessParser";

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
