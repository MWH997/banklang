/**
 * Horizontal validation: this compiler against COBOL nobody wrote for it.
 *
 * Everything else in this repository is vertical: tests written for BankLang,
 * measuring BankLang against what their author expected. This package holds the
 * other axis: independent corpora, their licences, the rules that decide what
 * BankTS can express, and the arithmetic that reports the answer without
 * flattering it.
 *
 * The runnable end is `tools/horizontal.ts`. Nothing here fetches anything or
 * touches the network; the corpora arrive in an ignored cache and this reads
 * what is on disk.
 *
 * See `docs/validation/horizontal-validation.md` for the methodology and
 * `docs/validation/horizontal-validation-results.md` for what it currently
 * reports. Both are generated from the same result JSON the harness writes, so
 * neither can drift from the measurement.
 */

export { CORPORA, corpus } from "./registry";
export type {
  CorpusCategory,
  CorpusDefinition,
  FetchMechanism,
  RedistributionPolicy,
} from "./registry";

export { classifyLicence, detectLicence, knownLicences } from "./licence";
export type { LicenceDetermination, RedistributionVerdict } from "./licence";

export {
  hashBytes,
  lockHash,
  parseLock,
  stableLockJson,
  verifyLock,
  LockMismatchError,
} from "./lock";
export type { CorpusLock, LockedCorpus, LockedFile } from "./lock";

export {
  capOutput,
  safeJoin,
  sanitizedEnv,
  UnsafePathError,
  EXTERNAL_OUTPUT_CAP,
  EXTERNAL_TIMEOUT_MS,
} from "./safety";

export { MalformedTaskError, parseSpecOnlyTask } from "./task";
export type {
  Applicability,
  NormalizedTask,
  SealedTask,
  SpecOnlyTask,
  UnsupportedReason,
} from "./task";

export { checkTallyIsComplete, formatRate, tally, PASSING } from "./result";
export type {
  Authoring,
  CorpusTally,
  Execution,
  Outcome,
  RunEnvironment,
  TaskResult,
} from "./result";

export {
  compareEngines,
  compareRun,
  firstDifference,
  isOracleDerivable,
  normalizeOutput,
} from "./compare";
export type { Difference, Expectation, ObservedRun } from "./compare";

export {
  classifyTask,
  needsLineSequential,
  APPLICABILITY_RULES,
} from "./applicability";
export type { ApplicabilityRule, ApplicabilityVerdict } from "./applicability";

export { DEFECT_FAMILIES, defectIdOf, familyOf, parseDefect } from "./defects";
export type { DefectCase, DefectCoverage, DefectFamily } from "./defects";

export {
  DEFECT_DEMONSTRATIONS,
  demonstratedDefects,
} from "./defect-demonstrations";
export type { DefectDemonstration } from "./defect-demonstrations";

export {
  allocateDdNames,
  ddBase,
  ddCandidate,
  isLegalDdName,
} from "./dd-names";

export { CAPABILITIES } from "./capabilities";
export type { Capability } from "./capabilities";

export { blockerFor, TASK_BLOCKERS } from "./task-blockers";
export type { BlockerKind, TaskBlocker } from "./task-blockers";

export {
  analyseFile,
  looksLikeCobol,
  summarise,
  supportGaps,
  COBOL_EXTENSIONS,
} from "./corpus-analysis";
export type { CorpusAnalysis, FileAnalysis } from "./corpus-analysis";

export { classifyProgram, supportFor, SUPPORT_RULES } from "./representability";
export type {
  FeatureSupport,
  Representability,
  RepresentabilityVerdict,
  SupportRule,
} from "./representability";

export {
  emptyIbmResult,
  hashManifest,
  ibmClaimSentence,
  ibmValidationStatus,
  IbmResultError,
  IBM_RESULT_VERSION,
  parseIbmResult,
} from "./ibm-result";
export type {
  IbmCaseResult,
  IbmResult,
  IbmValidationStatus,
} from "./ibm-result";
