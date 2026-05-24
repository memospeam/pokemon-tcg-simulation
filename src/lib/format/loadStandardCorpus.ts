import type {
  EffectTextRecord,
  StandardCardIndex,
  StandardCorpus,
  StandardCorpusManifest,
} from "./prepareStandardCorpus";

import manifest from "../../../data/standard/manifest.json";
import effectTexts from "../../../data/standard/effect-texts.json";
import cardsIndex from "../../../data/standard/cards-index.json";

const corpus: StandardCorpus = {
  manifest: manifest as unknown as StandardCorpusManifest,
  effectTexts: effectTexts as EffectTextRecord[],
  cards: cardsIndex as StandardCardIndex[],
};

export function loadStandardCorpus(): StandardCorpus {
  return corpus;
}

export function getStandardEffectText(id: string): EffectTextRecord | undefined {
  return corpus.effectTexts.find((entry) => entry.id === id);
}

/** Resolve playable rules text for a Trainer card name from the Standard corpus. */
export function getTrainerRulesTextByCardName(cardName: string): string | undefined {
  const normalized = cardName.trim().toLowerCase();
  const record = corpus.effectTexts.find(
    (entry) =>
      entry.kind === "trainer" &&
      entry.exampleCards.some((name) => name.trim().toLowerCase() === normalized),
  );
  return record?.text;
}

export function findStandardEffectsByText(text: string): EffectTextRecord[] {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return corpus.effectTexts.filter(
    (entry) => entry.text.trim().replace(/\s+/g, " ").toLowerCase() === normalized,
  );
}

export function getStandardCardIndex(apiId: string): StandardCardIndex | undefined {
  return corpus.cards.find((entry) => entry.apiId === apiId);
}

export function getStandardCardsBySet(ptcgoCode: string): StandardCardIndex[] {
  const code = ptcgoCode.toUpperCase();
  return corpus.cards.filter((card) => card.set === code);
}

export function countStandardCardsBySet(ptcgoCode: string): number {
  return getStandardCardsBySet(ptcgoCode).length;
}
