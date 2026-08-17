/**
 * What an IBM Enterprise COBOL run reported, and the gate that decides whether
 * this repository is allowed to say one happened.
 *
 * The project's standing limit is that everything ends at GnuCOBOL. That
 * sentence appears on the website, in the README, on the validation page and in
 * thirteen evidence bundles, and until now every one of those was a string
 * somebody had typed. A disclaimer that depends on an author remembering to
 * write it is not a control: the day somebody runs the bundle on real hardware,
 * the honest edit and the overstated one look identical in review, and the day
 * nobody runs it the disclaimer can be deleted by accident and nothing fails.
 *
 * So the claim is derived instead. `ibmValidationStatus` looks for imported
 * execution evidence and reports what it finds; the report generator asks it
 * rather than being told. With no evidence on disk the only sentence available
 * is that native IBM validation has not been performed, and there is no code
 * path that produces any other.
 *
 * **A template is not evidence.** `emptyIbmResult` writes a file for somebody
 * with z/OS access to fill in, and it carries `executed: false`. The validator
 * refuses it in as many words. That is deliberate: the failure mode this guards
 * against is not a forged result, it is a template committed by somebody being
 * helpful and then read by a generator that cannot tell the difference.
 */

import { createHash } from "node:crypto";

/** The shape version, bumped when this file's own contract changes. */
export const IBM_RESULT_VERSION = 1;

/** How a single bundle case came out under IBM's compiler. */
export interface IbmCaseResult {
  /** The bundle case id, matching `manifest.json`'s `cases[].id`. */
  id: string;
  /** The load module or member the case compiled. */
  program: string;
  /**
   * What the case established.
   *
   * `compile` is a compilation only, which is all a case needing CICS, Db2, IMS
   * or MQ can claim from a batch bundle. `execute` means the program ran and its
   * output was compared. Reporting a compile as an execution is the single
   * easiest way to overstate a bundle run, so the category is carried on the
   * case rather than inferred from whether an output happens to be present.
   */
  kind: "compile" | "execute";
  /** The compiler or step return code. */
  returnCode: number;
  /** Highest message severity the compiler emitted: I, W, E, S or U. */
  severity?: "I" | "W" | "E" | "S" | "U";
  /** sha256 of the output dataset, where the case produced one. */
  outputSha256?: string;
  /** Whether the output matched what the bundle expected of it. */
  matchedExpected?: boolean;
  /** Anything the runner saw that the fields above do not carry. */
  notes?: string;
}

export interface IbmResult {
  version: number;
  /**
   * False in the template, and the reason the template is not evidence.
   *
   * A run sets it true. The validator refuses a false one as a *result* while
   * still parsing it, so a half-filled template reports "this has not been run"
   * rather than a schema error nobody can act on.
   */
  executed: boolean;
  compiler: string;
  /** The compiler release, e.g. `6.4`. */
  version_compiler: string;
  /** z/OS release, and anything else that decides behaviour. */
  platform: string;
  /** Which BankLang built the bundle. */
  banklangVersion: string;
  /** The commit the bundle was built from, so the artifacts can be regenerated. */
  banklangCommit: string;
  /** sha256 of the bundle manifest the run was performed against. */
  bundleManifestSha256: string;
  /** ISO date of the run. */
  date: string;
  /** Who ran it, so a question has somewhere to go. */
  runBy: string;
  cases: IbmCaseResult[];
}

export class IbmResultError extends Error {}

const SEVERITIES = new Set(["I", "W", "E", "S", "U"]);

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new IbmResultError(`${path}: ${key} must be a non-empty string`);
  }
  return value;
}

/**
 * An IBM result file, parsed and checked.
 *
 * Throws rather than returning a partial record. A result that does not parse
 * is not a weaker result, it is an unknown one, and the caller's only safe
 * reading of an unknown is that no run happened.
 */
export function parseIbmResult(text: string, path: string): IbmResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new IbmResultError(
      `${path}: not valid JSON, ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new IbmResultError(`${path}: must be a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  if (record["version"] !== IBM_RESULT_VERSION) {
    throw new IbmResultError(
      `${path}: version must be ${IBM_RESULT_VERSION}, got ${JSON.stringify(record["version"])}`,
    );
  }
  if (typeof record["executed"] !== "boolean") {
    throw new IbmResultError(`${path}: executed must be true or false`);
  }
  const cases = record["cases"];
  if (!Array.isArray(cases)) {
    throw new IbmResultError(`${path}: cases must be an array`);
  }

  const parsed: IbmResult = {
    version: IBM_RESULT_VERSION,
    executed: record["executed"],
    compiler: requireString(record, "compiler", path),
    version_compiler: requireString(record, "version_compiler", path),
    platform: requireString(record, "platform", path),
    banklangVersion: requireString(record, "banklangVersion", path),
    banklangCommit: requireString(record, "banklangCommit", path),
    bundleManifestSha256: requireString(record, "bundleManifestSha256", path),
    date: requireString(record, "date", path),
    runBy: requireString(record, "runBy", path),
    cases: cases.map((entry, index) => {
      const where = `${path}: cases[${index}]`;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new IbmResultError(`${where} must be an object`);
      }
      const item = entry as Record<string, unknown>;
      const kind = item["kind"];
      if (kind !== "compile" && kind !== "execute") {
        throw new IbmResultError(
          `${where}: kind must be "compile" or "execute"`,
        );
      }
      const returnCode = item["returnCode"];
      if (typeof returnCode !== "number" || !Number.isInteger(returnCode)) {
        throw new IbmResultError(`${where}: returnCode must be an integer`);
      }
      const severity = item["severity"];
      if (
        severity !== undefined &&
        (typeof severity !== "string" || !SEVERITIES.has(severity))
      ) {
        throw new IbmResultError(`${where}: severity must be one of I W E S U`);
      }
      // An execution that reports no output and no comparison established that
      // the program ran, not that it ran correctly, and the difference is the
      // whole point of the category.
      if (kind === "execute" && item["matchedExpected"] === undefined) {
        throw new IbmResultError(
          `${where}: an execute case must say whether the output matched`,
        );
      }
      return {
        id: requireString(item, "id", where),
        program: requireString(item, "program", where),
        kind,
        returnCode,
        ...(severity === undefined
          ? {}
          : { severity: severity as IbmCaseResult["severity"] }),
        ...(typeof item["outputSha256"] === "string"
          ? { outputSha256: item["outputSha256"] }
          : {}),
        ...(typeof item["matchedExpected"] === "boolean"
          ? { matchedExpected: item["matchedExpected"] }
          : {}),
        ...(typeof item["notes"] === "string" ? { notes: item["notes"] } : {}),
      };
    }),
  };

  if (parsed.executed && parsed.cases.length === 0) {
    throw new IbmResultError(
      `${path}: executed is true but no cases were reported`,
    );
  }
  return parsed;
}

/**
 * What this repository may say about IBM validation.
 *
 * Two states, and the absent one is the default. Nothing here reads a
 * configuration flag or an environment variable: the only way to reach
 * `performed: true` is a result file that parses, says it was executed, and
 * carries at least one case.
 */
export type IbmValidationStatus =
  | { performed: false; reason: string }
  | {
      performed: true;
      compiler: string;
      compilerVersion: string;
      platform: string;
      date: string;
      compiled: number;
      executed: number;
      matched: number;
      failed: number;
    };

/** The sentence the generated pages use, derived from the status. */
export function ibmClaimSentence(status: IbmValidationStatus): string {
  if (!status.performed) {
    return "Native IBM Enterprise COBOL validation: NOT YET PERFORMED.";
  }
  return (
    `Native IBM Enterprise COBOL validation: ${status.compiler} ` +
    `${status.compilerVersion} on ${status.platform}, ${status.date}. ` +
    `${status.compiled} compiled, ${status.executed} executed, ` +
    `${status.matched} matched expected output, ${status.failed} failed.`
  );
}

/**
 * Read imported IBM evidence, if any, and say what it supports.
 *
 * `text` is the file's bytes or null when there is no file. Passing the bytes
 * rather than a path keeps this usable from the browser bundle and from a test
 * that never touches the filesystem, and keeps the decision in one function
 * rather than one per caller.
 */
export function ibmValidationStatus(text: string | null): IbmValidationStatus {
  if (text === null) {
    return {
      performed: false,
      reason: "no IBM execution result has been imported",
    };
  }
  let result: IbmResult;
  try {
    result = parseIbmResult(text, "IBM result");
  } catch (error) {
    // Refused rather than ignored, and refused *into the absent state*: a
    // result file nobody can parse is not evidence of a run.
    return {
      performed: false,
      reason: `the imported IBM result could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!result.executed) {
    return {
      performed: false,
      reason: "the imported IBM result is a template that records no run",
    };
  }
  const executed = result.cases.filter((entry) => entry.kind === "execute");
  return {
    performed: true,
    compiler: result.compiler,
    compilerVersion: result.version_compiler,
    platform: result.platform,
    date: result.date,
    compiled: result.cases.filter((entry) => entry.kind === "compile").length,
    executed: executed.length,
    matched: executed.filter((entry) => entry.matchedExpected === true).length,
    failed: result.cases.filter(
      (entry) => entry.returnCode > 4 || entry.matchedExpected === false,
    ).length,
  };
}

/**
 * The file somebody with z/OS access fills in.
 *
 * Written with `executed: false` and every field blank, so that committing it
 * unchanged claims nothing. The case list comes from the bundle rather than
 * from here, so a template can never disagree with the artifacts it describes.
 */
export function emptyIbmResult(
  banklangVersion: string,
  banklangCommit: string,
  bundleManifestSha256: string,
  cases: { id: string; program: string; kind: "compile" | "execute" }[],
): string {
  const template = {
    version: IBM_RESULT_VERSION,
    executed: false,
    compiler: "IBM Enterprise COBOL",
    version_compiler: "6.4",
    platform: "FILL IN: z/OS release",
    banklangVersion,
    banklangCommit,
    bundleManifestSha256,
    date: "FILL IN: YYYY-MM-DD",
    runBy: "FILL IN: who ran this",
    cases: cases.map((entry) => ({
      id: entry.id,
      program: entry.program,
      kind: entry.kind,
      returnCode: -1,
      ...(entry.kind === "execute" ? { matchedExpected: false } : {}),
      notes: "FILL IN",
    })),
  };
  return `${JSON.stringify(template, null, 2)}\n`;
}

export function hashManifest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
