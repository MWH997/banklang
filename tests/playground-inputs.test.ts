import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  buildRecord,
  encodeInputs,
  inputsFor,
  packDecimal,
  parmText,
  cursorRowsOf,
  type ProgramInputs,
} from "../packages/playground/src/inputs";
import { run } from "../packages/playground/src/run";
import { encodePacked } from "../tools/conformance";
import { exampleProjects } from "../tools/example-projects";
import { checked } from "./helpers";

/**
 * The Input panel, and what it makes the Run tab worth reading.
 *
 * Every program used to execute against zero-initialised storage, so
 * `account-posting`, the example whose whole subject is a balanced transfer,
 * posted 0.00 against 0.00 on the feature sold as "read the postings it made
 * rather than take the compiler's word for them".
 * The one case that proves nothing, on the landing page's primary call to
 * action.
 */

interface Prepared {
  cobol: string;
  inputs: ProgramInputs;
  outcome: ReturnType<typeof run>;
}

/** Everything a reader can see of a run, for comparing two of them. */
function fingerprint(outcome: ReturnType<typeof run>): string {
  return JSON.stringify([
    outcome.ok,
    outcome.refusal,
    outcome.returnCode,
    outcome.sysout,
    outcome.journal,
    outcome.balances,
    outcome.audit,
    outcome.datasets,
  ]);
}

/** One example, seeded the way the panel seeds it, and run. */
function prepared(example: string): Prepared {
  const compiled = compile(
    readFileSync(`${example}/src/main.bank.ts`, "utf8"),
    { sourceFile: "main.bank.ts" },
  );
  if (!compiled.program || !compiled.layout || !compiled.cobol) {
    throw new Error(`${example} no longer compiles.`);
  }
  const inputs = inputsFor(compiled.program, compiled.layout);
  const { storage, files } = encodeInputs(
    inputs.surfaces,
    compiled.layout,
    compiled.program,
  );
  return {
    cobol: compiled.cobol,
    inputs,
    outcome: run(compiled.cobol, {
      storage,
      files,
      parm: parmOf(inputs),
      cursorRows: cursorRowsOf(
        inputs.surfaces,
        compiled.layout,
        compiled.program,
      ),
    }),
  };
}

/** The PARM the panel holds, as the characters a step would pass. */
function parmOf(inputs: ProgramInputs): string | undefined {
  const surface = inputs.surfaces.find((each) => each.kind === "parm");
  return surface ? parmText(surface) : undefined;
}

/**
 * The encoder, held against the one CI executes with.
 *
 * `tools/conformance.ts` builds the packed-decimal records that GnuCOBOL reads
 * in the executed conformance lane. This one builds the same records for the
 * browser. Two encoders that disagree would have the playground and CI running
 * different programs while reporting the same thing, which is the quiet kind of
 * wrong, so they are compared rather than each trusted.
 */
describe("packed decimal, in the browser", () => {
  it.each([
    [1200.0, 2, 10],
    [-1200.0, 2, 10],
    [0, 2, 10],
    [0.05, 2, 3],
    [99999999999.99, 2, 10],
    [4.5, 4, 5],
  ])(
    "encodes %s the way the conformance harness does",
    (value, scale, bytes) => {
      expect([...packDecimal(value, scale, bytes)]).toEqual([
        ...encodePacked(value, scale, bytes),
      ]);
    },
  );
});

describe("a record built from the compiler's layout", () => {
  const compiled = compile(
    readFileSync("examples/account-posting/src/main.bank.ts", "utf8"),
    { sourceFile: "main.bank.ts" },
  );
  const layout = compiled.layout!.reports.find(
    (report) => report.recordName === "PostTransferRequest",
  )!;

  it("is exactly as long as the copybook says", () => {
    const record = buildRecord(layout, {});
    expect(record.length).toBe(layout.totalLength);
  });

  /** Spaces, not low values: an unwritten byte of a record area is a blank. */
  it("blank-fills a field nobody supplied", () => {
    expect([...buildRecord(layout, {})].every((byte) => byte === 0x20)).toBe(
      true,
    );
  });

  /**
   * The numeric path no example takes.
   *
   * Money is `COMP-3` and it has its own branch, so a `binary` or `zoned` field
   * is the only way into `packNumeric`, and no record in the corpus has one.
   * The guard on that branch was anchored as `/^[S9VP(),0-9]+$/`, which the
   * layout report's `PIC S9(9)` never matches, so the branch was unreachable
   * and such a field would have been written as characters into an item the
   * program reads as a number.
   */
  it("writes a binary field as bytes, not as characters", () => {
    const numeric = compile(
      `module BinaryInput;

record Counter {
  batchId: string<8>;
  lineCount: binary<9>;
  idempotencyKey: string<36>;
}

entry transaction count(counter: Counter) {
  audit("COUNTED", counter.idempotencyKey);
}
`,
      { sourceFile: "binary.bank.ts" },
    );
    const report = numeric.layout!.reports.find(
      (each) => each.recordName === "Counter",
    )!;
    const entry = report.entries.find((each) =>
      each.path.endsWith(".LINE-COUNT"),
    )!;
    const record = buildRecord(report, { "LINE-COUNT": "7" });

    expect(entry.usage).toBe("COMP");
    expect([
      ...record.subarray(entry.offset, entry.offset + entry.bytes),
    ]).toEqual([0, 0, 0, 7]);
  });

  it("writes each field at the offset the layout reports", () => {
    const record = buildRecord(layout, {
      "DEBIT-ACCOUNT": "ACC-0000000001",
      "CREDIT-ACCOUNT": "BRANCH-TILL",
      AMOUNT: "1200.00",
    });
    const debit = layout.entries.find((entry) =>
      entry.path.endsWith(".DEBIT-ACCOUNT"),
    )!;
    const amount = layout.entries.find((entry) =>
      entry.path.endsWith(".AMOUNT"),
    )!;

    expect(
      new TextDecoder().decode(
        record.subarray(debit.offset, debit.offset + debit.bytes),
      ),
    ).toBe("ACC-0000000001  ");
    expect([
      ...record.subarray(amount.offset, amount.offset + amount.bytes),
    ]).toEqual([...encodePacked(1200, 2, amount.bytes)]);
  });
});

/**
 * The finding itself, as a test.
 *
 * `account-posting` holds its request in WORKING-STORAGE and nothing in the
 * program fills it: on z/OS a caller, a PARM or a dataset does. The panel is
 * that caller, and this is the assertion the ticket asked for: a non-zero
 * journal that balances.
 */
describe("the example the audit ran", () => {
  const { outcome, inputs } = prepared("examples/account-posting");

  it("offers its request record as the thing to fill in", () => {
    expect(inputs.surfaces.map((surface) => surface.kind)).toEqual(["entry"]);
    expect(inputs.surfaces[0]!.name).toBe("POST-TRANSFER-REQUEST");
    expect(inputs.reason).toBeNull();
  });

  it("posts a transfer that is not zero", () => {
    expect(outcome.ok).toBe(true);
    expect(outcome.returnCode).toBe(0);
    expect(outcome.journal).toHaveLength(2);
    for (const line of outcome.journal) {
      expect(line, "a posting of zero is the defect this closes").not.toMatch(
        /\s0\.00$/,
      );
    }
  });

  it("posts a transfer that balances", () => {
    const total = outcome.balances.reduce(
      (sum, [, amount]) => sum + Number(amount),
      0,
    );
    expect(outcome.balances.length).toBe(2);
    expect(total).toBe(0);
  });

  it("names the accounts the panel supplied, not spaces", () => {
    for (const [account] of outcome.balances) {
      expect(account.trim()).not.toBe("");
    }
  });
});

/**
 * A dataset, read record by record.
 *
 * `withdrawal-with-recovery` is one of the three examples with hand-written
 * expected balances, and its input arrives the way a batch program's does: a
 * file the step allocates. The panel builds those records from the same layout
 * `tools/conformance.ts` builds them from for the GnuCOBOL lane.
 */
describe("a program that reads a dataset", () => {
  const { outcome, inputs } = prepared("examples/withdrawal-with-recovery");

  it("offers the dataset rather than the record behind it", () => {
    expect(inputs.surfaces.map((surface) => surface.kind)).toEqual(["dataset"]);
    expect(inputs.surfaces[0]!.name).toBe("REQUESTI");
  });

  it("reports nothing missing once the panel has filled it", () => {
    expect(outcome.missingInputs).toEqual([]);
  });

  /**
   * The same request the executed conformance suite runs under GnuCOBOL, and a
   * 1200.00 withdrawal from a 5000.00 balance with a 500.00 floor, which is
   * permitted, reaching the same journal in the browser. Two runtimes, one
   * program, one answer.
   */
  it("posts the withdrawal the conformance suite posts", () => {
    expect(outcome.ok).toBe(true);
    expect(outcome.journal).toContain("DEBIT ACC-0000000001 -1200.00");
    expect(outcome.journal.some((line) => line.startsWith("CREDIT"))).toBe(
      true,
    );
    expect(outcome.audit.some((line) => line.includes("POSTED"))).toBe(true);
  });
});

/**
 * A cursor that returns rows, and then ends.
 *
 * `runtime/DSNHLI.cbl` succeeds every call it has no script for, so an
 * unscripted FETCH always returned a row: `branch-accrual-cursor` ran to its
 * declared 5000-row bound and ended the step with return code 12. It also wrote
 * no host variables, so all 5000 rows were empty and the program accrued
 * nothing on every one. A reader opening the only Db2 example in the corpus saw
 * a program that looked broken.
 */
describe("what Db2 answers", () => {
  const { outcome, inputs } = prepared("examples/branch-accrual-cursor");
  const surface = inputs.surfaces.find((each) => each.kind === "sql")!;

  /**
   * In the order the `INTO` names them, which is the order the generated FETCH
   * passes them, the positions the row script is keyed by. Layout order would
   * be right only while the two happen to coincide.
   */
  it("offers the fields the cursor's INTO names, in that order", () => {
    expect(surface.name).toBe("accountsInBranch");
    expect(surface.fields.map((field) => field.name)).toEqual([
      "ROW-ACCOUNT-ID",
      "ROW-BALANCE",
      "ROW-STATUS",
    ]);
    expect(surface.records).toHaveLength(3);
  });

  it("ends the cursor instead of running it to the bound", () => {
    expect(outcome.ok).toBe(true);
    expect(outcome.returnCode).toBe(0);
    expect(outcome.sysout.join("\n")).not.toMatch(/CURSOR LIMIT/);
  });

  /**
   * The whole point of the surface: rows that reach the program. Three rows
   * seeded `OPEN` with a balance, at the seeded rate, is interest on each.
   */
  it("posts interest on the rows it was given", () => {
    expect(outcome.journal.length).toBeGreaterThan(0);
    for (const line of outcome.journal) {
      expect(line, "a posting of zero is a row that arrived empty").not.toMatch(
        /\s-?0\.00$/,
      );
    }
  });

  it("credits the accounts the rows named", () => {
    expect(outcome.journal.some((line) => line.includes("ACC-"))).toBe(true);
    expect(
      outcome.journal.some((line) => line.includes("INTEREST-EXPENSE")),
    ).toBe(true);
  });

  /** The branch the panel seeded, in the summary the program wrote. */
  it("carries the seeded request through to the summary", () => {
    const summary = outcome.datasets.find((each) => each.name === "SUMMARYO");
    expect(summary?.records[0]).toMatch(/^BRANCH-T/);
    expect(summary?.records[0]).toMatch(/IDEM-0001/);
  });
});

/**
 * A program with no input path says so, and says which kind of none it is.
 *
 * Their numbers being uninteresting is then a fact about the program rather
 * than about the browser, which is the distinction that matters here, and it
 * holds only while the sentence is true of that program. Every example without a surface
 * is listed here, because the one that was left out of this table was the one
 * being told something false: `account-transfer` declares a record and a
 * function and no transaction, and was informed that its transaction took no
 * record and that it computed from constants.
 */
describe("a program with nothing to fill in", () => {
  it.each([
    ["examples/online-enquiry", /accountEnquiry is a CICS transaction/],
    ["examples/mq-request-reply", /takes its input off a queue/],
    ["examples/account-transfer", /no transaction, so it has no entry point/],
    [
      "examples/batch-interest-accrual",
      /no transaction, so it has no entry point/,
    ],
  ])("says why: %s", (example, expected) => {
    const { inputs } = prepared(example);

    expect(inputs.surfaces).toEqual([]);
    expect(inputs.reason).toMatch(expected);
  });

  /** The table above is every one of them, not a sample of them. */
  it("is the complete list of examples with no input", () => {
    const bare = exampleProjects().filter(
      (example) => prepared(example).inputs.surfaces.length === 0,
    );
    expect(bare).toEqual([
      "examples/account-transfer",
      "examples/batch-interest-accrual",
      "examples/mq-request-reply",
      "examples/online-enquiry",
    ]);
  });
});

/**
 * The PARM, built from the emitter's own account of it.
 *
 * `batchParmFields` is the list `emitParmParagraph` generates the length check
 * and the MOVEs from. The panel offered one opaque `X(512)` seeded blank
 * instead, so all four PARM-driven examples reached their own length check on
 * the first statement, printed `PARM IS +0000 BYTES, n REQUIRED`, and ended
 * with return code 12, three of them without ever opening the dataset the
 * panel had seeded beside it.
 */
describe("the PARM", () => {
  const { inputs, outcome, cobol } = prepared("examples/parm-driven-batch");
  const surface = inputs.surfaces.find((each) => each.kind === "parm")!;

  it("is one field per parameter, named as the source names them", () => {
    expect(surface.fields.map((field) => field.name)).toEqual([
      "runDate",
      "branchId",
      "idempotencyKey",
    ]);
  });

  it("is exactly as wide as the program's length check demands", () => {
    const required = /PARM IS " [A-Z0-9-]+ " BYTES, (\d+) REQUIRED/.exec(
      cobol,
    )?.[1];
    expect(required).toBe("52");
    expect(parmText(surface)).toHaveLength(52);
  });

  it("writes a number as the zoned decimal the linkage group declares", () => {
    // `runDate` is `unsigned<8, 0>`, so PIC 9(8) and no sign to separate: the
    // eight characters an operator types, which is what `IS NUMERIC` passes.
    expect(parmText(surface).slice(0, 8)).toBe("20260807");
  });

  it("gets past the length check the empty PARM failed", () => {
    expect(outcome.ok).toBe(true);
    expect(outcome.sysout.join("\n")).not.toMatch(/BYTES, \d+ REQUIRED/);
    expect(outcome.returnCode).not.toBe(12);
  });

  it("reaches the dataset seeded beside it", () => {
    expect(outcome.journal.length).toBeGreaterThan(0);
  });

  /**
   * A signed amount carries its sign separately and its scale implied, which is
   * the one field shape a hand-written panel would have got wrong.
   */
  it("writes a signed amount with a leading sign and no point", () => {
    const posting = prepared("examples/zunit-tested-posting");
    const parm = parmOf(posting.inputs)!;
    expect(parm).toHaveLength(71);
    expect(parm.slice(16, 35)).toBe("+000000000000120000");
    expect(posting.outcome.returnCode).not.toBe(12);
  });
});

/**
 * Every example, seeded and run.
 *
 * The panel has to be right about what a program can be given for all of them,
 * not for the two this file names: a surface keyed by a DD the program does
 * not open is a panel a reader fills in and a program that ignores it.
 */
describe("every example", () => {
  const results = exampleProjects().map((example) => ({
    example,
    ...prepared(example),
  }));

  it("has an input surface, or a reason there is none", () => {
    let described = 0;
    for (const { example, inputs } of results) {
      if (inputs.surfaces.length === 0) {
        expect(inputs.reason, `${example} explains nothing`).not.toBeNull();
      }
      described += 1;
    }
    checked(described, 19, "examples");
  });

  it("supplies most of them with something", () => {
    const supplied = results.filter(
      ({ inputs }) => inputs.surfaces.length > 0,
    ).length;
    // This was zero before the Input panel existed, which was the whole defect.
    expect(supplied).toBeGreaterThan(results.length / 2);
  });

  it("keys every dataset by a DD the program actually opens", () => {
    let datasets = 0;
    for (const { example, cobol, inputs } of results) {
      for (const surface of inputs.surfaces) {
        if (surface.kind !== "dataset") {
          continue;
        }
        datasets += 1;
        expect(
          cobol.replace(/\s+/g, " "),
          `${example} has no SELECT assigning to ${surface.name}`,
        ).toContain(`ASSIGN TO ${surface.name}`);
      }
    }
    checked(datasets, 8, "seeded datasets");
  });

  /**
   * A field that changes nothing is a form the reader fills in and the program
   * ignores, which is the same defect as no form at all wearing better
   * clothes. Each surface is removed in turn and the run compared: if the two
   * agree byte for byte, the panel was offering something inert.
   *
   * This is the check that was missing. It finds, in one pass, everything the
   * Input panel shipped with: the PARM seeded blank so the program refused it, the MQ
   * request record the get overwrites, and `branch-accrual-cursor`, whose
   * cursor nothing bounded: every FETCH succeeded, the loop ran to its own
   * 5000-row limit and ended the step with return code 12, and the branch the
   * panel had seeded never reached the summary. There are no exemptions: every
   * surface the panel offers changes what the program does.
   */
  it("offers nothing that makes no difference to the run", () => {
    let compared = 0;

    for (const { example, cobol, inputs, outcome } of results) {
      // A program the interpreter refused never read anything, so every surface
      // would compare equal. `report-with-controls` uses Report Writer and
      // `end-of-day-settlement/report` has a LINAGE clause; both are limits of
      // the interpreter that the Run tab already states.
      if (!outcome.ok) {
        continue;
      }
      const compiled = compile(
        readFileSync(`${example}/src/main.bank.ts`, "utf8"),
        { sourceFile: "main.bank.ts" },
      );
      for (const surface of inputs.surfaces) {
        const others = inputs.surfaces.filter((each) => each !== surface);
        const withheld = run(cobol, {
          ...encodeInputs(others, compiled.layout!, compiled.program!),
          parm: parmOf({ surfaces: others, reason: null }),
          cursorRows: cursorRowsOf(others, compiled.layout!, compiled.program!),
        });
        const differs = fingerprint(withheld) !== fingerprint(outcome);
        compared += 1;
        expect(
          differs,
          `${example}: ${surface.kind} ${surface.name} changes nothing`,
        ).toBe(true);
      }
    }

    checked(compared, 18, "surfaces");
  });

  it("runs, or refuses with a reason", () => {
    let ran = 0;
    for (const { example, outcome } of results) {
      if (!outcome.ok) {
        expect(
          outcome.refusal,
          `${example} refused with no reason`,
        ).toBeTruthy();
        continue;
      }
      ran += 1;
    }
    checked(ran, 15, "executed examples");
  });
});
