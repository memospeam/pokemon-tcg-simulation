export {
  STANDARD_FORMAT,
  STANDARD_REGULATION_MARKS,
  isStandardLegalCard,
  isStandardRegulationMark,
  type StandardRegulationMark,
} from "./standard";
export {
  prepareStandardCorpus,
  type StandardCorpus,
  type StandardCorpusManifest,
  type EffectTextRecord,
  type StandardCardIndex,
  type CoverageStats,
} from "./prepareStandardCorpus";
export {
  loadStandardCorpus,
  getStandardEffectText,
  findStandardEffectsByText,
  getStandardCardIndex,
} from "./loadStandardCorpus";
