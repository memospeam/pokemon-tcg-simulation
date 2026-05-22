export type DeckSection = "Pokémon" | "Trainer" | "Energy";

export interface ParsedDeckLine {
  count: number;
  name: string;
  setCode?: string;
  number?: string;
  section: DeckSection;
  raw: string;
}

export interface ParsedDeckList {
  sections: Partial<Record<DeckSection, number>>;
  lines: ParsedDeckLine[];
  errors: string[];
}

const SECTION_PATTERN = /^(Pokémon|Pokemon|Trainer|Energy)\s*:\s*(\d+)\s*$/i;
const LINE_PATTERN = /^(\d+)\s+(.+)$/;

function parseCardTail(tail: string): Pick<ParsedDeckLine, "name" | "setCode" | "number"> {
  const tokens = tail.trim().split(/\s+/);
  if (tokens.length >= 3) {
    const number = tokens[tokens.length - 1];
    const setCode = tokens[tokens.length - 2];
    const name = tokens.slice(0, -2).join(" ");
    if (/^\d+[a-zA-Z]?$/.test(number) && /^[A-Za-z0-9]+$/.test(setCode)) {
      return { name, setCode, number };
    }
  }
  return { name: tail.trim() };
}

export function parseLimitlessDeckList(text: string): ParsedDeckList {
  const sections: Partial<Record<DeckSection, number>> = {};
  const lines: ParsedDeckLine[] = [];
  const errors: string[] = [];
  let currentSection: DeckSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(SECTION_PATTERN);
    if (sectionMatch) {
      const label = sectionMatch[1].toLowerCase();
      const count = Number(sectionMatch[2]);
      currentSection =
        label === "pokémon" || label === "pokemon"
          ? "Pokémon"
          : label === "trainer"
            ? "Trainer"
            : "Energy";
      sections[currentSection] = count;
      continue;
    }

    const lineMatch = line.match(LINE_PATTERN);
    if (!lineMatch) {
      errors.push(`Invalid line: ${line}`);
      continue;
    }

    if (!currentSection) {
      errors.push(`Card line outside section: ${line}`);
      continue;
    }

    const count = Number(lineMatch[1]);
    const tail = lineMatch[2];
    const parsedTail = parseCardTail(tail);
    lines.push({
      count,
      section: currentSection,
      raw: line,
      ...parsedTail,
    });
  }

  return { sections, lines, errors };
}

export function deckListToText(name: string, lines: ParsedDeckLine[]): string {
  const grouped: Record<DeckSection, ParsedDeckLine[]> = {
    Pokémon: [],
    Trainer: [],
    Energy: [],
  };

  for (const line of lines) {
    grouped[line.section].push(line);
  }

  const chunks: string[] = [`// ${name}`];
  for (const section of ["Pokémon", "Trainer", "Energy"] as DeckSection[]) {
    const sectionLines = grouped[section];
    if (sectionLines.length === 0) continue;
    const total = sectionLines.reduce((sum, line) => sum + line.count, 0);
    chunks.push(`${section}: ${total}`);
    for (const line of sectionLines) {
      const suffix =
        line.setCode && line.number ? ` ${line.setCode} ${line.number}` : "";
      chunks.push(`${line.count} ${line.name}${suffix}`);
    }
  }
  return chunks.join("\n");
}
