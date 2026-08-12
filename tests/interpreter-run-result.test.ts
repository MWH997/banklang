import { describe, expect, it } from "vitest";

import { CompilerInvariant } from "../packages/diagnostics/src/errors";
import {
  AUDIT_LOG,
  LEDGER_BALANCES,
  LEDGER_JOURNAL,
  auditOf,
  balancesOf,
  journalOf,
  runCobol,
} from "../packages/cobol-runtime/src/index";

/**
 * The entry point of the interpreter, and the three readers beside it.
 *
 * `packages/cobol-runtime/src/index.ts` scored 35.71% the first time anything
 * measured it. The reason is plain once looked at: `journalOf`, `balancesOf` and
 * `auditOf` had no test at all. `tools/interpret.ts` was their only caller, and
 * a tool is not a test — nothing failed when they were wrong.
 *
 * They are worth holding because of what reads them. The conformance check
 * compares what this interpreter says a program posted against what `cobc` says,
 * and `balancesOf` here has to match `readBalances` in `tools/conformance.ts`
 * exactly. A difference in how the *file is read* would be reported as a
 * difference in what the program *did* — the comparison would fail, and it would
 * point at the compiler.
 */

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A program that runs and touches nothing, so the seeded files come back. */
const NOOP = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOOP.
       PROCEDURE DIVISION.
       MAIN.
           DISPLAY "HI"
           GOBACK.
`;

describe("choosing the program to enter", () => {
  it("defaults to the first program in the first source", () => {
    expect(runCobol({ sources: [NOOP] }).sysout).toEqual(["HI"]);
  });

  it("enters the program named instead when one is given", () => {
    expect(runCobol({ sources: [NOOP], entry: "NOOP" }).sysout).toEqual(["HI"]);
  });

  /**
   * Nothing to enter is a compiler invariant, not a run that produces nothing.
   *
   * A run that returns an empty result here would look exactly like a program
   * that did nothing — which is the answer a caller would then report.
   */
  it("refuses a request with no program in it", () => {
    expect(() => runCobol({ sources: [] })).toThrow(CompilerInvariant);
    expect(() => runCobol({ sources: [] })).toThrow(/No program to run/);
  });
});

describe("reading what the reference runtime left behind", () => {
  /** One run, seeded with the three files the reference programs write. */
  function seeded() {
    return runCobol({
      sources: [NOOP],
      files: new Map([
        [LEDGER_JOURNAL, [encode("DEBIT ACC-ONE 100   ")]],
        [
          LEDGER_BALANCES,
          [
            encode("ACC ONE 250   "),
            // No space at all, and a space at position zero. Both must be
            // skipped rather than becoming an entry keyed on "".
            encode("nospaceanywhere"),
            encode(" 5"),
          ],
        ],
        [AUDIT_LOG, [encode("TRANSFER_POSTED KEY-1  ")]],
      ]),
    });
  }

  it("returns one journal line per ledger call, trailing blanks removed", () => {
    expect(journalOf(seeded())).toEqual(["DEBIT ACC-ONE 100"]);
  });

  it("returns one audit line per audit call", () => {
    expect(auditOf(seeded())).toEqual(["TRANSFER_POSTED KEY-1"]);
  });

  /**
   * A balance line splits on its *last* space, so an account name may contain
   * spaces and still be read whole. Splitting on the first would key this entry
   * on `ACC` and report the balance as `ONE 250`.
   */
  it("splits a balance line on the last space", () => {
    expect([...balancesOf(seeded())]).toEqual([["ACC ONE", "250"]]);
  });

  /** A file the run never produced reads as nothing, not as a failure. */
  it("reads an absent file as no lines", () => {
    const result = runCobol({ sources: [NOOP] });
    expect(journalOf(result)).toEqual([]);
    expect(auditOf(result)).toEqual([]);
    expect([...balancesOf(result)]).toEqual([]);
  });
});
