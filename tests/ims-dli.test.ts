import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol, unpadded } from "./helpers";

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
  it("takes its PCBs on the PROCEDURE DIVISION", () => {
    expect(result.cobol).toContain(
      "PROCEDURE DIVISION USING IO-PCB ACCOUNT-DB-PCB.",
    );
    expect(result.cobol).toContain("01  ACCOUNT-DB-PCB.");
    expect(unpadded(result.cobol)).toContain(
      "05 ACCOUNT-DB-PCB-STATUS PIC X(2).",
    );
  });

  /**
   * The I/O PCB comes first, always. A batch program needs it for system
   * service calls, so `CMPAT=YES` is what IBM says to specify — and with it the
   * region passes the I/O PCB ahead of every database PCB.
   *
   * Omitting it does not fail to compile. It shifts every database PCB by one,
   * so the program reads the I/O PCB as its first database and works on
   * whatever that storage holds. This test is here because that is exactly what
   * the first version of this feature did.
   */
  it("puts the I/O PCB first", () => {
    const text = result.cobol ?? "";

    expect(text).toContain("01  IO-PCB.");
    expect(unpadded(text)).toContain("05 IO-PCB-LTERM PIC X(8).");
    expect(text.indexOf("01  IO-PCB.")).toBeLessThan(
      text.indexOf("01  ACCOUNT-DB-PCB."),
    );
  });

  /**
   * "The mask must contain the same fields, in the same order, as the I/O PCB."
   *
   * In DB batch only the status code is populated, so a mask that stopped at
   * the userid read the status correctly and nothing noticed. But a PCB mask is
   * a description of storage the region owns, not a list of the fields this
   * program happens to read: a short one stops being true the moment anything
   * is added to the end of it.
   *
   * The trailing group is the extended time stamp, whose time is twelve packed
   * digits carrying no sign and whose UTC offset is four bits of attributes
   * ahead of a packed value — neither is a COBOL numeric picture.
   */
  it("describes the whole I/O PCB, not the part it reads", () => {
    const text = result.cobol ?? "";

    expect(unpadded(text)).toContain("05 IO-PCB-GROUP-NAME PIC X(8).");
    expect(unpadded(text)).toContain("10 IO-PCB-TS-DATE PIC S9(7) COMP-3.");
    expect(unpadded(text)).toContain("10 IO-PCB-TS-TIME PIC X(6).");
    expect(unpadded(text)).toContain("10 IO-PCB-TS-UTC PIC X(2).");
    expect(unpadded(text)).toContain("05 IO-PCB-USER-IND PIC X(1).");
  });

  it("declares the function code it uses, and only that one", () => {
    expect(unpadded(result.cobol)).toContain(
      '01 DLI-GU PIC X(4) VALUE "GU  ".',
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

    expect(unpadded(text)).toContain('05 FILLER PIC X(8) VALUE "ACCTSEG ".');
    expect(unpadded(text)).toContain('05 FILLER PIC X(1) VALUE "(".');
    expect(unpadded(text)).toContain('05 FILLER PIC X(8) VALUE "ACCTID  ".');
    expect(unpadded(text)).toContain('05 FILLER PIC X(2) VALUE " =".');
    expect(unpadded(text)).toContain("05 ACCOUNT-DB-SSA-VALUE PIC X(10).");
    expect(unpadded(text)).toContain('05 FILLER PIC X(1) VALUE ")".');
  });

  it("calls DL/I and reads the status back", () => {
    expect(flowed(result.cobol)).toContain(
      flowed(
        'CALL "CBLTDLI" USING DLI-GU, ACCOUNT-DB-PCB, ACCOUNT-SEGMENT, ACCOUNT-DB-SSA',
      ),
    );
    expect(result.cobol).toContain("MOVE ACCOUNT-DB-PCB-STATUS TO DB-STATUS");
  });
});

describe("each operation is its own function code", () => {
  const cases: [string, string][] = [
    ['  getUnique accountDb into segment key "1";', "DLI-GU"],
    ["  getNext accountDb into segment;", "DLI-GN"],
    ['  getHoldUnique accountDb into segment key "1";', "DLI-GHU"],
    ["  getHoldNext accountDb into segment;", "DLI-GHN"],
    ["  insertSegment accountDb from segment;", "DLI-ISRT"],
    [
      `  getHoldNext accountDb into segment;
  replaceSegment accountDb from segment;`,
      "DLI-REPL",
    ],
    [
      `  getHoldNext accountDb into segment;
  deleteSegment accountDb;`,
      "DLI-DLET",
    ],
  ];

  for (const [source, code] of cases) {
    it(`emits ${code}`, () => {
      const result = program(source);

      expect(result.diagnostics).toEqual([]);
      expect(result.cobol).toContain(`CALL "CBLTDLI" USING ${code},`);
    });
  }

  /**
   * A unique read is qualified — segment, field, value. A next read and an
   * insert take an *unqualified* argument naming the segment: without one, `GN`
   * returns the next segment of any type in hierarchical order, and `ISRT` has
   * nothing telling DL/I what to insert. Only `REPL` and `DLET` take none,
   * because they act on what the get-hold held.
   */
  it("passes the search argument each call actually needs", () => {
    // The trailing space is the assertion: `ACCOUNT-DB-SSA` is a prefix of
    // `ACCOUNT-DB-SSA-U`, so without it a qualified argument would satisfy a
    // test written to prove the call carries the unqualified one.
    expect(
      flowed(program('  getUnique accountDb into segment key "1";').cobol),
    ).toContain("ACCOUNT-SEGMENT, ACCOUNT-DB-SSA ");
    expect(
      flowed(program("  getNext accountDb into segment;").cobol),
    ).toContain("ACCOUNT-SEGMENT, ACCOUNT-DB-SSA-U ");
    expect(
      flowed(program("  insertSegment accountDb from segment;").cobol),
    ).toContain("ACCOUNT-SEGMENT, ACCOUNT-DB-SSA-U ");
    expect(
      flowed(
        program(`  getHoldNext accountDb into segment;
  deleteSegment accountDb;`).cobol,
      ),
    ).toContain(
      'CALL "CBLTDLI" USING DLI-DLET, ACCOUNT-DB-PCB, ACCOUNT-SEGMENT ',
    );
  });

  /** Nine bytes: eight of segment name and a space. */
  it("builds the unqualified argument to DL/I's layout", () => {
    const text = program("  getNext accountDb into segment;").cobol ?? "";

    expect(text).toContain("01  ACCOUNT-DB-SSA-U.");
    expect(unpadded(text)).toContain('05 FILLER PIC X(8) VALUE "ACCTSEG ".');
    expect(unpadded(text)).toContain('05 FILLER PIC X(1) VALUE " ".');
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

  /**
   * DL/I will not update a segment the program has not held: it answers `DJ`
   * and the update does not happen, which the program only notices if it tests
   * the status.
   */
  it("needs a get-hold before a replace", () => {
    expect(ids(program("  replaceSegment accountDb from segment;"))).toContain(
      "BANK-DLI-002",
    );
  });

  it("needs a get-hold before a delete", () => {
    expect(ids(program("  deleteSegment accountDb;"))).toContain(
      "BANK-DLI-002",
    );
  });

  it("accepts a hold earlier in the same block", () => {
    expect(
      ids(
        program(`  getHoldUnique accountDb into segment key "1";
  replaceSegment accountDb from segment;`),
      ),
    ).toEqual([]);
  });

  /** Every path through a branch has already passed a hold before it. */
  it("accepts a hold in the enclosing block", () => {
    expect(
      ids(
        program(`  getHoldUnique accountDb into segment key "1";
  if dbStatus == "  " {
    replaceSegment accountDb from segment;
  }`),
      ),
    ).toEqual([]);
  });

  /** The path that skipped the branch reaches the update unheld. */
  it("rejects a hold that only happens in a branch", () => {
    expect(
      ids(
        program(`  if dbStatus == "  " {
    getHoldUnique accountDb into segment key "1";
  }
  replaceSegment accountDb from segment;`),
      ),
    ).toContain("BANK-DLI-002");
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

  const DRIVER = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. DRIVER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  IO-PCB.
           05  IO-LTERM       PIC X(8)  VALUE "LTERM01".
           05  FILLER         PIC XX    VALUE SPACES.
           05  IO-STATUS      PIC XX    VALUE SPACES.
           05  IO-DATE        PIC S9(7) COMP-3 VALUE 0.
           05  IO-TIME        PIC S9(6)V9 COMP-3 VALUE 0.
           05  IO-MSG-SEQ     PIC S9(7) COMP VALUE 0.
           05  IO-MOD-NAME    PIC X(8)  VALUE SPACES.
           05  IO-USER-ID     PIC X(8)  VALUE SPACES.
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
           CALL "ACCOUNTI" USING IO-PCB DB-PCB
           STOP RUN.
`;

  function run(script: string | null): string {
    const result =
      program(`  getHoldUnique accountDb into segment key "0000000001";
  if dbStatus == "  " {
    log "FOUND";
  } else {
    log "STATUS ", dbStatus;
  }`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-dli-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );
    writeFileSync(join(dir, "driver.cob"), DRIVER, "utf8");
    if (script !== null) {
      writeFileSync(join(dir, "dli-outcomes.txt"), script, "utf8");
    }

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
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
