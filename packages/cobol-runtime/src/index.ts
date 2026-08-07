/**
 * Running generated COBOL, without a COBOL compiler.
 *
 * The playground compiles BankTS to COBOL in the browser and then has nothing
 * to run it with: `cobc` is a native toolchain and z/OS is not on the internet.
 * This package closes that gap by interpreting the COBOL the compiler just
 * emitted — the same characters shown in the output pane, read in fixed
 * reference format, laid out byte for byte, and executed.
 *
 * **What a green run here establishes, and what it does not.**
 *
 * It establishes that the generated program's own logic does what the BankTS
 * said: the balances, the audit events, the branch taken on a file status, the
 * return code. It is a second implementation of the same semantics, which is
 * worth having — two implementations disagreeing is how a defect surfaces.
 *
 * It establishes nothing about IBM Enterprise COBOL, and nothing about
 * GnuCOBOL. This is not a COBOL compiler and does not aspire to be one. What
 * keeps it honest is `tests/cobol-runtime-differential.test.ts`, which runs
 * every runnable example through both this interpreter and a real `cobc`, and
 * fails on the first disagreement in output, return code, ledger or audit log.
 * Without that test this file would be a plausible-looking guess.
 *
 * Usage:
 *
 * ```ts
 * const result = runCobol({
 *   sources: [generatedCobol, bankledgSource, bankaudtSource],
 *   entry: "ACCOUNTP",
 * });
 * result.sysout;      // DISPLAY output, in order
 * result.returnCode;  // what the job step would see
 * ledgerOf(result);   // balances the reference ledger ended with
 * ```
 */

export {
  CobolSyntaxError,
  CobolUnsupportedError,
  readFixedFormat,
  tokenize,
} from "./source";
export { CobolRuntimeError, Machine } from "./machine";
export type { RunResult, RunOptions, Value } from "./machine";
export { parseUnit } from "./program";
export type { Program, Unit, FileControlEntry } from "./program";
export { parsePicture, storageLength } from "./picture";
export type { Picture, Usage } from "./picture";
export { parseDataEntries, flatten } from "./data";
export type { Field } from "./data";

import { Machine, type RunOptions, type RunResult } from "./machine";
import { parseUnit } from "./program";
import { CompilerInvariant } from "../../diagnostics/src/errors";

export interface RunRequest extends RunOptions {
  /**
   * Every program the run may reach.
   *
   * The generated program first, then whatever it calls. A `CALL` to a program
   * that is not here fails by name rather than being skipped, because a ledger
   * call that quietly does nothing is a run that reports balanced books it
   * never posted.
   */
  sources: string[];
  /** The program to enter. Defaults to the first one in the first source. */
  entry?: string;
}

export function runCobol(request: RunRequest): RunResult {
  const units = request.sources.map((source) => parseUnit(source));
  const entry = request.entry ?? units[0]?.programs[0]?.name;
  if (!entry) {
    throw new CompilerInvariant("No program to run.");
  }
  return new Machine(units).run(entry, {
    files: request.files,
    storage: request.storage,
    stepLimit: request.stepLimit,
  });
}

/* ------------------------------------------------------------------ *
 * Reading what the reference runtime left behind.
 * ------------------------------------------------------------------ */

/** The filenames `runtime/BANKLEDG.cbl` and `runtime/BANKAUDT.cbl` write. */
export const LEDGER_JOURNAL = "ledger-journal.txt";
export const LEDGER_BALANCES = "ledger-balances.txt";
export const AUDIT_LOG = "audit-log.txt";

function linesOf(result: RunResult, file: string): string[] {
  return (result.files.get(file) ?? []).map((record) =>
    new TextDecoder().decode(record).trimEnd(),
  );
}

/** One line per ledger call, in the order the program made them. */
export function journalOf(result: RunResult): string[] {
  return linesOf(result, LEDGER_JOURNAL);
}

/** Closing balance per account, as the reference ledger holds it. */
export function balancesOf(result: RunResult): Map<string, string> {
  const balances = new Map<string, string>();
  for (const line of linesOf(result, LEDGER_BALANCES)) {
    // Split on the last space, and skip a line with no account name. Both
    // rules match `readBalances` in `tools/conformance.ts` exactly, because
    // the two are compared against each other and a difference in how the file
    // is *read* would be reported as a difference in what the program did.
    const at = line.lastIndexOf(" ");
    if (at > 0) {
      balances.set(line.slice(0, at).trim(), line.slice(at + 1));
    }
  }
  return balances;
}

/** `event correlationKey` per audit call, in order. */
export function auditOf(result: RunResult): string[] {
  return linesOf(result, AUDIT_LOG);
}
