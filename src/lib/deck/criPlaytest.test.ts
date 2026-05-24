import { describe, expect, it } from "vitest";
import { GamePhase } from "../models/enums";
import { buildPlaytestDeckFromCorpusText } from "./corpusDeckBuilder";
import {
  analyzeAllCriPlaytestDecks,
  analyzeCriDeck,
  collectCriImplementationGaps,
  CRI_ENGINE_READY_SIGNATURES,
  summarizeCriPlaytestAnalysis,
  summarizeCriTrainerCoverage,
} from "./criDeckAnalyzer";
import { CRI_PLAYTEST_DECKS, getCriDeckById } from "./criDeckPresets";
import { runMatchFromBuiltDecks, runTournamentPresetMatch } from "./utrechtGameRunner";

describe("Chaos Rising playtest presets", () => {
  it("builds 60-card corpus decks with all Pokémon lines resolved", () => {
    for (const preset of CRI_PLAYTEST_DECKS) {
      const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
      expect(deck.resolveErrors, preset.id).toEqual([]);
      expect(deck.cards, preset.id).toHaveLength(60);
      expect(deck.validation.valid, preset.id).toBe(true);
    }
  });

  it("tracks signature effects as engine-ready for implemented CRI mechanics", () => {
    const summary = summarizeCriPlaytestAnalysis();
    expect(summary.deckCount).toBe(CRI_PLAYTEST_DECKS.length);
    expect(summary.pokemonCardsMissing).toBe(0);
    expect(summary.signatureEffects.engineReady).toBeGreaterThanOrEqual(8);
    expect(CRI_ENGINE_READY_SIGNATURES.has("Ninja Spinner")).toBe(true);
    expect(CRI_ENGINE_READY_SIGNATURES.has("Mortal Shuriken")).toBe(true);
    expect(collectCriImplementationGaps()).toEqual([]);
  });

  it("resolves CRI trainer staples with corpus rules text and engine coverage", () => {
    const summary = summarizeCriTrainerCoverage();
    expect(summary.stapleCount).toBeGreaterThan(20);
    expect(summary.engineReady).toBe(summary.stapleCount);
    expect(summary.gaps).toEqual([]);
  });

  it("analyzes Mega Greninja ex signature attacks and ability", () => {
    const preset = getCriDeckById("cri-greninja-water")!;
    const analysis = analyzeCriDeck(preset);
    expect(analysis.signatureEffects.map((entry) => entry.effectName).sort()).toEqual([
      "Mortal Shuriken",
      "Ninja Spinner",
    ]);
    expect(analysis.signatureEffects.every((entry) => entry.implementationCoverage === "implemented")).toBe(
      true,
    );
  });

  it("auto-setups and runs Greninja mirror without unresolved pending actions", async () => {
    const preset = getCriDeckById("cri-greninja-water")!;
    const result = await runTournamentPresetMatch(preset, preset, {
      seed: 11,
      setup: { placeBenchBasics: true, maxMulligans: 40 },
      run: { maxTurns: 25, maxActions: 200 },
    });
    expect(result.resolveErrors).toEqual([]);
    expect(result.setupComplete).toBe(true);
    expect(result.actionCount).toBeGreaterThan(5);
    expect(result.stalled).toBe(false);
    expect([GamePhase.Active, GamePhase.Finished]).toContain(result.state.phase);
  });

  it("runs Greninja vs Floette cross-match from built decks", () => {
    const greninja = getCriDeckById("cri-greninja-water")!;
    const floette = getCriDeckById("cri-floette-psychic")!;
    const p1Deck = buildPlaytestDeckFromCorpusText(greninja.label, greninja.text);
    const p2Deck = buildPlaytestDeckFromCorpusText(floette.label, floette.text);
    const result = runMatchFromBuiltDecks(
      {
        player1Name: "Greninja",
        player2Name: "Floette",
        player1Deck: p1Deck,
        player2Deck: p2Deck,
        seed: 23,
      },
      { placeBenchBasics: true, maxMulligans: 40 },
      { maxTurns: 30, maxActions: 240 },
    );
    expect(result.setupComplete).toBe(true);
    expect(result.resolveErrors).toEqual([]);
    expect(result.stalled, `pending=${String(result.state.pendingAction?.type)}`).toBe(false);
    expect(result.actionCount).toBeGreaterThan(5);
  });

  it("runs all CRI preset mirrors without stalling on optional attack steps", () => {
    for (const preset of CRI_PLAYTEST_DECKS) {
      const deck = buildPlaytestDeckFromCorpusText(preset.label, preset.text);
      const result = runMatchFromBuiltDecks(
        {
          player1Name: "P1",
          player2Name: "P2",
          player1Deck: deck,
          player2Deck: deck,
          seed: preset.placement * 17,
        },
        { placeBenchBasics: true, maxMulligans: 40 },
        { maxTurns: 20, maxActions: 180 },
      );
      expect(result.setupComplete, preset.id).toBe(true);
      expect(result.resolveErrors, preset.id).toEqual([]);
      expect(result.stalled, `${preset.id} pending=${String(result.state.pendingAction?.type)}`).toBe(
        false,
      );
      expect(result.actionCount, preset.id).toBeGreaterThan(5);
    }
  });
});
