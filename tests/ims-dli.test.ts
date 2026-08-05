import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * IMS DL/I: `CALL "CBLTDLI"` with a function code.
 *
 * An IMS program does not open a database or read it with file control. The
 * region hands it a PCB, and every operation is a call carrying a function
 * code, that PCB, a segment area, and — for a qualified read — a search
 * argument built to a fixed byte layout.
 *
 * The two characters DL/I leaves in the PCB are the whole error model. That is
 * why the status field is required rather than optional: without it a
 * `getUnique` that found nothing is indistinguishable from one that worked.
 */

const PREAMBLE = `module AccountIms;

record AccountSegment {
  acctId: string<10>;
  balance: decimal<9, 2>;
}
`;

const DATABASE = `database accountDb pcb segment "ACCTSEG" key "ACCTID" record AccountSegment status dbStatus;`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(
  body: string,
  database = DATABASE,
): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
${database}

entry transaction lookup(segment: AccountSegment, idempotencyKey: string<36>) {
${body}
  audit("LOOKED", idempotencyKey);
}`);
}

describe("the program the region enters", () => {
  const result = program(
    '  getUnique accountDb into segment key "0000000001";',
  );

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /** The region passes the PCB; the program never allocates one. */
  it("takes its PCB on the PROCEDURE DIVISION", () => {
    expect(result.cobol).toContain("PROCEDURE DIVISION USING ACCOUNT-DB-PCB.");
    expect(result.cobol).toContain("01  ACCOUNT-DB-PCB.");
    expect(result.cobol).toContain("05  ACCOUNT-DB-PCB-STATUS    PIC XX.");
  });

  it("declares the function code it uses, and only that one", () => {
    expect(result.cobol).toContain(
      '01  DLI-GU               PIC X(4) VALUE "GU  ".',
    );
    expect(result.cobol).not.toContain("DLI-DLET");
  });

  /**
   * A search argument is a fixed byte layout, not a string the program builds:
   * eight bytes of segment name, `(`, eight of field name, the operator, the
   * value, `)`. The value is its own field so a key can be moved in without
   * rebuilding the rest.
   */
  it("builds the search argument to DL/I's layout", () => {
    const text = result.cobol ?? "";

    expect(text).toContain(
      '05  FILLER               PIC X(8) VALUE "ACCTSEG ".',
    );
    expect(text).toContain('05  FILLER               PIC X VALUE "(".');
    expect(text).toContain(
      '05  FILLER               PIC X(8) VALUE "ACCTID  ".',
    );
    expect(text).toContain('05  FILLER               PIC XX VALUE " =".');
    expect(text).toContain("05  ACCOUNT-DB-SSA-VALUE PIC X(10).");
    expect(text).toContain('05  FILLER               PIC X VALUE ")".');
  });

  it("calls DL/I and reads the status back", () => {
    expect(result.cobol).toContain(
      'CALL "CBLTDLI" USING DLI-GU, ACCOUNT-DB-PCB, ACCOUNT-SEGMENT, ACCOUNT-DB-SSA',
    );
    expect(result.cobol).toContain("MOVE ACCOUNT-DB-PCB-STATUS TO DB-STATUS");
  });
});

describe("each operation is its own function code", () => {
  const cases: [string, string][] = [
    ['  getUnique accountDb into segment key "1";', "DLI-GU"],
    ["  getNext accountDb into segment;", "DLI-GN"],
    ["  insertSegment accountDb from segment;", "DLI-ISRT"],
    ["  replaceSegment accountDb from segment;", "DLI-REPL"],
    ["  deleteSegment accountDb;", "DLI-DLET"],
  ];

  for (const [source, code] of cases) {
    it(`emits ${code}`, () => {
      const result = program(source);

      expect(result.diagnostics).toEqual([]);
      expect(result.cobol).toContain(`CALL "CBLTDLI" USING ${code},`);
    });
  }

  /**
   * A next read walks from wherever the last call left the position, which is
   * the whole point of it, so it passes no search argument.
   */
  it("qualifies only the unique read", () => {
    const next = program("  getNext accountDb into segment;");

    expect(next.cobol).toContain(
      'CALL "CBLTDLI" USING DLI-GN, ACCOUNT-DB-PCB, ACCOUNT-SEGMENT\n',
    );
  });
});

describe("what it will take", () => {
  it("needs a declared database", () => {
    expect(
      ids(program('  getUnique missingDb into segment key "1";')),
    ).toContain("BANK-DLI-001");
  });

  /**
   * The status is the entire error model. Without it, a read that found
   * nothing is indistinguishable from one that worked.
   */
  it("needs somewhere to read the status", () => {
    expect(
      ids(
        program(
          "  getNext accountDb into segment;",
          `database accountDb pcb segment "ACCTSEG" key "ACCTID" record AccountSegment;`,
        ),
      ),
    ).toContain("BANK-DLI-001");
  });

  /** A search argument carries eight bytes of name. */
  it("rejects a segment name DL/I cannot carry", () => {
    expect(
      ids(
        program(
          "  getNext accountDb into segment;",
          `database accountDb pcb segment "ACCOUNTSEGMENT" key "ACCTID" record AccountSegment status dbStatus;`,
        ),
      ),
    ).toContain("BANK-DLI-001");
  });

  it("reads into the record the database declares", () => {
    const result = compile(`${PREAMBLE}
record Other {
  something: string<4>;
}

${DATABASE}

entry transaction lookup(other: Other, idempotencyKey: string<36>) {
  getNext accountDb into other;
  audit("LOOKED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-DLI-001");
  });

  it("looks for a key that is text", () => {
    expect(ids(program("  getUnique accountDb into segment key 1;"))).toContain(
      "BANK-DLI-001",
    );
  });
});

/**
 * Run against `runtime/CBLTDLI.cbl`, which is **not IMS** — it evaluates no
 * database and holds no segments. What running establishes is that the program
 * reaches its calls in order, and that the branch guarded by the PCB status is
 * taken when an outcome is scripted. It establishes nothing about what IMS
 * would return.
 *
 * The driver stands in for the region: it allocates a PCB and calls the program
 * with it, which is how an IMS program is entered and why it cannot be run
 * standalone.
 */
describe("executed against the reference DL/I runtime", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  const DRIVER = `IDENTIFICATION DIVISION.
PROGRAM-ID. DRIVER.
DATA DIVISION.
WORKING-STORAGE SECTION.
01  DB-PCB.
    05  PCB-DBD-NAME   PIC X(8)  VALUE "ACCTDB".
    05  PCB-SEG-LEVEL  PIC XX    VALUE "01".
    05  PCB-STATUS     PIC XX    VALUE SPACES.
    05  PCB-PROC-OPTS  PIC X(4)  VALUE "A".
    05  FILLER         PIC S9(5) COMP VALUE 0.
    05  PCB-SEG-NAME   PIC X(8)  VALUE SPACES.
    05  PCB-KEY-LENGTH PIC S9(5) COMP VALUE 0.
    05  PCB-SENSEG     PIC S9(5) COMP VALUE 1.
    05  PCB-KEY-FB     PIC X(64) VALUE SPACES.
PROCEDURE DIVISION.
    CALL "ACCOUNT-IMS" USING DB-PCB
    STOP RUN.
`;

  function run(script: string | null): string {
    const result = program(`  getUnique accountDb into segment key "0000000001";
  if dbStatus == "  " {
    log "FOUND";
  } else {
    log "STATUS ", dbStatus;
  }`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-dli-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");
    writeFileSync(join(dir, "driver.cob"), DRIVER, "utf8");
    if (script !== null) {
      writeFileSync(join(dir, "dli-outcomes.txt"), script, "utf8");
    }

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-free",
        "driver.cob",
        "program.cbl",
        join(process.cwd(), "runtime/CBLTDLI.cbl"),
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "driver",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./driver", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    return ran.stdout;
  }

  it.skipIf(!available)("takes the found branch when the call succeeds", () => {
    expect(run(null)).toContain("FOUND");
  });

  /** `GE` is what DL/I reports when the segment is not there. */
  it.skipIf(!available)("takes the not-found branch when scripted", () => {
    const output = run("0001 GE\n");

    expect(output).toContain("STATUS GE");
    expect(output).not.toContain("FOUND");
  });
});
