import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { emitCobol } from "../packages/cobol-backend/src/index";
import { RUNTIME_INTERFACES } from "../packages/cobol-backend/src/index";
import { emitZunit, zunitModuleName } from "../packages/zunit/src/index";
import { runBankc } from "../packages/bankc-cli/src/index";
import type { IRProgram } from "../packages/ir/src/index";

/**
 * The zUnit generator.
 *
 * The 2026-08-05 audit's §4.5, and the last of its seven missing features to be
 * built. It was documented as blocked for a while on not having IBM's schema,
 * and the block was real: an artifact that looks like a zUnit test case and is
 * not one is worse than none, because somebody uploads it and submits it.
 *
 * What unblocked it was test cases IBM's own generator produced, published in
 * public repositories. Every assertion here that fixes a shape — the namespace,
 * the element order, the attribute names, the entry point naming, the call to
 * `BZUASSRT` — is checking this generator against those, and
 * `docs/zunit.md` cites each one.
 */

const PROGRAM = `module AccountPosting;

type BDT = currency<"BDT", 18, 2>;

entry transaction postTransfer(idempotencyKey: string<36>) {
  debit("0001234567890123", 100.00);
  credit("SUSPENSE", 100.00);
  audit("TRANSFER_POSTED", idempotencyKey);
}

test postsBothLegs for postTransfer {
  given idempotencyKey = "IDEM-0001";
  expect debit("0001234567890123", 100.00);
  expect credit("SUSPENSE", 100.00);
  expect audit("TRANSFER_POSTED", "IDEM-0001");
}
`;

function programOf(source: string): IRProgram {
  const result = compile(source);
  const errors = result.diagnostics.filter(
    (entry) => entry.severity === "error",
  );
  expect(errors.map((entry) => `${entry.id} ${entry.message}`)).toEqual([]);
  if (!result.program) {
    throw new Error("the program did not compile");
  }
  return result.program;
}

function ids(source: string): string[] {
  return compile(source).diagnostics.map((entry) => entry.id);
}

const GENERATED = emitZunit(programOf(PROGRAM));

describe("the configuration", () => {
  /**
   * The namespace is the version, and a runner reading one it does not know
   * rejects the file. Two independently produced cases carry 4.0.0.0.
   */
  it("names the runner namespace the observed cases carry", () => {
    expect(GENERATED.configuration).toContain(
      'xmlns:runner="http://www.ibm.com/zUnit/4.0.0.0/TestRunner"',
    );
    expect(GENERATED.configuration).toContain("<runner:RunnerConfiguration ");
  });

  it("writes the elements in the order the observed cases use", () => {
    const order = GENERATED.configuration
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("<"))
      .map((line) => line.replace("<", "").split(/[ >]/)[0]);

    expect(order).toEqual([
      "?xml",
      "runner:RunnerConfiguration",
      "runner:options",
      "runner:testCase",
      "test",
      "/runner:testCase",
      "runner:intercept",
      "runner:intercept",
      "runner:intercept",
      "runner:playback",
      "runner:fileAttributes",
      "/runner:RunnerConfiguration",
    ]);
  });

  it("names the entry point the driver declares", () => {
    expect(GENERATED.configuration).toContain(
      'name="POSTSBOTHLEGS" entry="TEST_POSTSBOTHLEGS"',
    );
    expect(GENERATED.driver).toContain("PROGRAM-ID. 'TEST_POSTSBOTHLEGS'.");
  });

  it("starts the case as a batch step", () => {
    expect(GENERATED.configuration).toContain('type="BTCH"');
  });

  /**
   * A stub's `lengths` is the byte count of what it is passed, and nothing at
   * run time checks it. The interfaces are described once for that reason, and
   * this is what ties the number to the picture the program actually emits.
   */
  it("states each stub's parameter length in bytes", () => {
    expect(GENERATED.configuration).toContain(
      'module="BANKLEDG" stub="true" lengths="48"',
    );
    expect(GENERATED.configuration).toContain(
      'module="BANKAUDT" stub="true" lengths="96"',
    );

    const cobol = emitCobol(programOf(PROGRAM)).cobol;
    for (const runtimeInterface of RUNTIME_INTERFACES) {
      for (const field of runtimeInterface.fields) {
        expect(cobol).toContain(`${field.name.padEnd(24)} ${field.picture}.`);
      }
    }
  });

  /**
   * The configuration's id and the driver's `BZU_INIT` have to answer with the
   * same value, and the same program has to produce the same file twice.
   */
  it("derives one identity, and the same one every time", () => {
    const match = GENERATED.configuration.match(/ id="([^"]+)"/);
    expect(match?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(GENERATED.driver).toContain(`VALUE '${match?.[1]}'`);
    expect(emitZunit(programOf(PROGRAM)).configuration).toBe(
      GENERATED.configuration,
    );
  });
});

describe("the driver", () => {
  it("compiles with the options the interception needs", () => {
    expect(GENERATED.driver.split("\n")[0]).toBe(
      "       PROCESS NODLL,NODYNAM,TEST(NOSEP),NOCICS,NOSQL,PGMN(LU),NOSEQ",
    );
  });

  it("enters the program under test through BZUGETEP", () => {
    expect(GENERATED.driver).toContain(
      "CALL BZUGETEP USING BY REFERENCE PROGRAM-NAME AZ-CSECT",
    );
    expect(GENERATED.driver).toContain(
      "SET ADDRESS OF AZ-PROC-PTR TO AZ-EP-PTR",
    );
    expect(GENERATED.driver).toContain("CALL AZ-PROC-PTR USING BANK-PARM");
  });

  it("builds the PARM the step is started with", () => {
    // 36 characters of idempotency key, and the halfword is not part of it.
    expect(GENERATED.driver).toContain("MOVE 36 TO BANK-PARM-LENGTH");
    expect(GENERATED.driver).toContain(
      "MOVE 'IDEM-0001' TO BANK-PARM-IDEMPOTENCY-KEY",
    );
  });

  it("raises a failure the way the runner records one", () => {
    expect(GENERATED.driver).toContain(
      "CALL BZUASSRT USING BZ-P1 BZ-P2 BZ-P3 BZ-ASSERT",
    );
    expect(GENERATED.driver).toContain("PIC S9(9) COMP-4 VALUE 2001");
  });

  it("declares a stub for each module the test expects a call to", () => {
    expect(GENERATED.driver).toContain("PROGRAM-ID. 'PGM_BANKLEDG'.");
    expect(GENERATED.driver).toContain("ENTRY 'PGM_INPT_BANKLEDG' USING");
    expect(GENERATED.driver).toContain("PROGRAM-ID. 'PGM_BANKAUDT'.");
    expect(GENERATED.driver).toContain("ENTRY 'PGM_INPT_BANKAUDT' USING");
  });

  /** The order is the point: a debit then a credit is not a credit then a debit. */
  it("checks each call against the expectation of that position", () => {
    const ledger = GENERATED.driver
      .split("PROGRAM-ID. 'PGM_BANKLEDG'.")[1]
      .split("END PROGRAM")[0];

    expect(ledger).toMatch(
      /WHEN 1[\s\S]*BANK-LEDGER-OPERATION = 'DEBIT'[\s\S]*WHEN 2[\s\S]*BANK-LEDGER-OPERATION = 'CREDIT'/,
    );
  });

  /**
   * A call that never arrives has to fail the test. Counting only inside the
   * stub cannot see that, because a stub that is never entered runs no code —
   * so the driver reads the count after the program returns.
   */
  it("refuses a run that made fewer calls than the test expected", () => {
    expect(GENERATED.driver).toContain("PERFORM CHECK-BANKLEDG-CALLS");
    expect(GENERATED.driver).toContain("IF AZ-CALL-COUNT NOT EQUAL 2");
    expect(GENERATED.driver).toContain("'EXPECTED 2 CALLS TO BANKLEDG, GOT'");
  });

  it("refuses a run that made more", () => {
    expect(GENERATED.driver).toContain(
      "'MORE THAN 2 CALLS TO BANKLEDG, AT CALL'",
    );
  });

  /**
   * The driver is its own compilation unit and declares no SPECIAL-NAMES, so
   * `DECIMAL-POINT IS COMMA` in the program under test does not reach it. That
   * is why the emitter takes no decimal-point option: a comma written into a
   * literal here would be read as a separator by the compilation that reads it.
   */
  it("writes its literals with a full stop, and declares no convention", () => {
    expect(GENERATED.driver).toContain("BANK-LEDGER-AMOUNT = 100.00");
    expect(GENERATED.driver).not.toContain("SPECIAL-NAMES");
    expect(GENERATED.driver).not.toContain("DECIMAL-POINT");
  });

  /**
   * A test name of all spaces tallies zero, and `AZ-TEST(1:0)` is a reference
   * modification of no characters — an abend under SSRANGE and undefined
   * without it. IBM's own generated cases carry the same exposure; this one
   * does not.
   */
  it("never reference-modifies zero characters of the test name", () => {
    const guards = GENERATED.driver
      .split("\n")
      .filter((line) => line.includes("IF AZ-TEST-LEN = 0")).length;
    const uses = GENERATED.driver
      .split("\n")
      .filter((line) => line.includes("INSPECT AZ-TEST TALLYING")).length;

    expect(guards).toBe(uses);
    expect(guards).toBeGreaterThan(0);
  });

  it("fits reference format", () => {
    for (const line of GENERATED.driver.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(72);
    }
  });
});

describe("the job", () => {
  it("runs the case through the procedure the pipeline uses", () => {
    expect(GENERATED.jcl).toContain("EXEC PROC=EQAPPLAY");
    expect(GENERATED.jcl).toContain("PRM='STOP=E,REPORT=XML'");
    expect(GENERATED.jcl).toContain("BZUCFG=");
    expect(GENERATED.jcl).toContain("BZULOD=");
    expect(GENERATED.jcl).toContain("BZURPT DD");
  });

  /**
   * The interception is the z/OS Debugger's, so the program under test has to
   * carry its hooks. A program compiled without `TEST` runs and calls the real
   * ledger — the failure this line exists to prevent is a test that passes by
   * posting to production.
   */
  it("says the program under test needs TEST", () => {
    expect(GENERATED.jcl).toContain("compiled with TEST");
  });

  it("fits a JCL statement", () => {
    for (const line of GENERATED.jcl.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(71);
    }
    expect(GENERATED.jcl).toContain("EXEC IGYWCL");
  });
});

describe("the program it tests", () => {
  /**
   * A `test` declaration compiles to nothing. If it changed the program by so
   * much as a byte, the artifact that ships would depend on the tests written
   * against it.
   */
  it("is byte for byte what it is without the tests", () => {
    const withTests = emitCobol(programOf(PROGRAM)).cobol;
    const withoutTests = emitCobol(
      programOf(PROGRAM.split("test postsBothLegs")[0]),
    ).cobol;

    expect(withTests).toBe(withoutTests);
  });
});

describe("what a test may say", () => {
  const PREAMBLE = `module Checks;

entry transaction go(idempotencyKey: string<36>) {
  audit("X", idempotencyKey);
}
`;

  it("refuses a test on something that is not the entry transaction", () => {
    expect(
      ids(`${PREAMBLE}
transaction other(key: string<36>) {
  audit("Y", key);
}

test t for other {
  expect audit("Y", "K");
}`),
    ).toContain("BANK-TEST-001");
  });

  it("refuses a test on a name that is not a transaction at all", () => {
    expect(
      ids(`${PREAMBLE}
test t for missing {
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-001");
  });

  /**
   * A CICS transaction is started by a transaction identifier with a COMMAREA,
   * which is a `type="CICS"` case and a running region.
   */
  it("refuses a batch case for a CICS transaction", () => {
    expect(
      ids(`module Online;

record Enquiry {
  accountId: string<16>;
}

entry cics transaction enquire(commarea: Enquiry) {
  audit("ENQUIRED", commarea.accountId);
}

test t for enquire {
  expect audit("ENQUIRED", "0001");
}`),
    ).toContain("BANK-TEST-002");
  });

  it("refuses a `given` that names no parameter", () => {
    expect(
      ids(`${PREAMBLE}
test t for go {
  given nothing = "X";
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-003");
  });

  /** A record parameter is a buffer the program fills, not an input. */
  it("refuses a `given` on a record", () => {
    expect(
      ids(`module Records;

record Account {
  accountId: string<16>;
}

entry transaction go(account: Account, key: string<36>) {
  audit("X", key);
}

test t for go {
  given account = "X";
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-003");
  });

  it("refuses a value that is not a constant", () => {
    expect(
      ids(`${PREAMBLE}
test t for go {
  given idempotencyKey = "A" + "B";
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-004");
  });

  it("refuses a value wider than the field it is compared against", () => {
    expect(
      ids(`${PREAMBLE}
test t for go {
  expect audit("AN EVENT NAME LONGER THAN THIRTY-TWO CHARACTERS", "K");
}`),
    ).toContain("BANK-TEST-004");
  });

  it("refuses an amount finer than the ledger carries", () => {
    expect(
      ids(`${PREAMBLE}
test t for go {
  expect debit("0001", 100.0001);
}`),
    ).toContain("BANK-TEST-004");
  });

  it("refuses two tests with one name", () => {
    expect(
      ids(`${PREAMBLE}
test t for go {
  expect audit("X", "K");
}

test T for go {
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-005");
  });

  it("refuses a name that will not survive being generated", () => {
    expect(
      ids(`${PREAMBLE}
test aNameFarTooLongToBeAGeneratedCobolWord for go {
  expect audit("X", "K");
}`),
    ).toContain("BANK-TEST-006");
  });

  /**
   * A configuration naming no test is one the runner ends having done nothing,
   * with a return code that reads as success — which is what a green pipeline
   * is built out of. Nothing is written for one.
   */
  it("refuses a case for a program that declares no tests", () => {
    const program = programOf(PREAMBLE);
    const refused = emitZunit(program).diagnostics;

    expect(refused.map((entry) => entry.id)).toContain("BANK-TEST-007");
    expect(refused.every((entry) => entry.severity === "error")).toBe(true);
  });

  it("accepts the test that started all this", () => {
    expect(ids(PROGRAM)).toEqual([]);
  });
});

describe("bankc zunit", () => {
  it("writes the three artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "bankc-zunit-"));
    const projectRoot = join(dir, "project");
    const source = join(projectRoot, "src", "main.bank.ts");
    spawnSync("mkdir", ["-p", join(projectRoot, "src")]);
    writeFileSync(source, PROGRAM, "utf8");

    const result = runBankc(["zunit", projectRoot, "--out", join(dir, "out")]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("TACCOUNT.bzucfg");
    expect(result.stdout).toContain("TACCOUNT.cbl");
    expect(result.stdout).toContain("TACCOUNT.jcl");
  });

  it("writes nothing for a project with no tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "bankc-zunit-empty-"));
    const projectRoot = join(dir, "project");
    spawnSync("mkdir", ["-p", join(projectRoot, "src")]);
    writeFileSync(
      join(projectRoot, "src", "main.bank.ts"),
      PROGRAM.split("test postsBothLegs")[0],
      "utf8",
    );

    const result = runBankc(["zunit", projectRoot, "--out", join(dir, "out")]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("BANK-TEST-007");
    expect(existsSync(join(dir, "out", "zunit"))).toBe(false);
  });

  it("names the module the way IBM's editor does", () => {
    expect(zunitModuleName(programOf(PROGRAM))).toBe("TACCOUNT");
    expect(zunitModuleName(programOf(PROGRAM)).length).toBeLessThanOrEqual(8);
  });
});

/**
 * A compiler accepting the driver.
 *
 * Narrower evidence than the rest of this repository's compiled grade, and the
 * difference is worth being plain about: `COPY EQAITERC` resolves here to a
 * stand-in declaring the two fields the driver names, because IBM's own
 * copybook is not here. What this establishes is that the driver's syntax is
 * accepted and every name in it resolves. It establishes nothing about the info
 * block's layout, and the driver has never been run — see divergence D20.
 */
describe("GnuCOBOL", () => {
  it("accepts the generated driver", () => {
    const available =
      spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
    if (!available) {
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "bankc-zunit-cobc-"));
    writeFileSync(join(dir, "driver.cbl"), GENERATED.driver, "utf8");
    copyFileSync("runtime/zunit/EQAITERC.cpy", join(dir, "EQAITERC.cpy"));

    for (const dialect of [
      ["-fsyntax-only", "-fixed", "-I.", "driver.cbl"],
      [
        "-fsyntax-only",
        "-fixed",
        "-conf=" + join(process.cwd(), "tools/banklang-ibm.conf"),
        "-I.",
        "driver.cbl",
      ],
    ]) {
      const built = spawnSync("cobc", dialect, { cwd: dir, encoding: "utf8" });

      expect(built.status, built.stderr).toBe(0);
      expect(built.stderr).not.toContain("error:");
      // The one thing it says: `PROCESS` is IBM's compiler-directing statement
      // and GnuCOBOL has no equivalent, so it reads it and moves on.
      expect(built.stderr).toContain("ignoring unknown directive");
    }
  });
});
