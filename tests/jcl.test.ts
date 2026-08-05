import { describe, expect, it } from "vitest";

import { emitJcl } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * The generated job has to reflect what the program actually needs.
 *
 * A program with embedded SQL cannot be compiled by IGYCRCTL alone, and a job
 * that omits the precompile step is not an incomplete skeleton but a wrong one:
 * it describes a build that cannot succeed. The same goes for a batch program
 * whose datasets have no DD statements, and for a CICS program given a run step
 * it can never be started by.
 */

function jclFor(source: string): string {
  const parsed = parseBankTs(source, "main.bank.ts");
  const checked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(checked);
  if (!ir.program) {
    throw new Error(
      `Expected the source to compile: ${checked.diagnostics
        .map((entry) => entry.id)
        .join(", ")}`,
    );
  }
  return emitJcl(ir.program).jcl;
}

const PLAIN = `module PlainBatch;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

entry transaction settle(account: Account) {
  debit(account.accountId, account.balance);
  credit("CASH", account.balance);
  audit("SETTLED", account.idempotencyKey);
}`;

const WITH_FILES = `module FileBatch;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

file accountInput sequential input record Account status accountInputStatus;
file postingOutput sequential output record Account status postingOutputStatus;

entry transaction settle(account: Account) {
  open accountInput;
  read accountInput into account;
  close accountInput;

  debit(account.accountId, account.balance);
  credit("CASH", account.balance);

  open postingOutput;
  write postingOutput from account;
  close postingOutput;

  audit("SETTLED", account.idempotencyKey);
}`;

const WITH_SQL = `module SqlBatch;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

sql fetchAccount(keyAccountId: string<16>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAccountId
}

entry transaction settle(row: AccountRow, idempotencyKey: string<36>) {
  execute fetchAccount("ACC-1") into row;

  if sqlcode == 0 {
    audit("FOUND", idempotencyKey);
  } else {
    audit("MISSING", idempotencyKey);
  }
}`;

const WITH_CICS = `module CicsOnline;

record Request {
  requestId: string<16>;
  idempotencyKey: string<36>;
}

cics transaction enquire(request: Request) {
  syncpoint resp commitResp;

  if commitResp == 0 {
    audit("COMMITTED", request.idempotencyKey);
  } else {
    audit("FAILED", request.idempotencyKey);
  }
}`;

describe("a plain batch job", () => {
  it("compiles, link-edits, and runs the program", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).toContain("//COMPILE  EXEC PGM=IGYCRCTL");
    expect(jcl).toContain("//LKED     EXEC PGM=IEWL");
    expect(jcl).toContain("//RUN      EXEC PGM=PLAINBAT");
  });

  it("adds no Db2 or CICS step it does not need", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).not.toContain("DSNHPC");
    expect(jcl).not.toContain("DFHECP1$");
    expect(jcl).not.toContain("IKJEFT01");
  });

  /**
   * The load module name, the link-edit member, and what the run step executes
   * all have to be the same eight characters. A COBOL PROGRAM-ID need not be.
   */
  it("names the load module consistently", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).toContain(
      "//SYSLMOD  DD DISP=SHR,DSN=BANKLANG.LOADLIB(PLAINBAT)",
    );
    expect(jcl).toContain("//RUN      EXEC PGM=PLAINBAT");
  });
});

describe("a batch job with files", () => {
  /**
   * A batch program with no DD statements for its datasets is a job that
   * cannot run. The DD name is the one the generated SELECT assigns to.
   */
  it("names each declared file with the DD the program assigns to", () => {
    const jcl = jclFor(WITH_FILES);

    expect(jcl).toContain("//ACCOUNTI DD DISP=SHR,DSN=BANKLANG.ACCOUNTI");
    expect(jcl).toContain(
      "//POSTINGO DD DSN=BANKLANG.POSTINGO,DISP=(NEW,CATLG),",
    );
  });

  it("allocates an output file and shares an input one", () => {
    const jcl = jclFor(WITH_FILES);

    // An input dataset already exists; an output dataset is created.
    expect(jcl).toMatch(/\/\/ACCOUNTI DD DISP=SHR/);
    expect(jcl).toMatch(/\/\/POSTINGO DD DSN=[^,]+,DISP=\(NEW,CATLG\)/);
  });
});

describe("a Db2 job", () => {
  /**
   * Neither step is optional: without the precompile there is no DBRM, and
   * without the bind there is no package for the program to run against.
   */
  it("precompiles before compiling and binds after link-editing", () => {
    const jcl = jclFor(WITH_SQL);

    expect(jcl.indexOf("PGM=DSNHPC")).toBeLessThan(jcl.indexOf("PGM=IGYCRCTL"));
    expect(jcl.indexOf("PGM=IEWL")).toBeLessThan(jcl.indexOf("PGM=IKJEFT01"));
    expect(jcl).toContain("BIND PACKAGE(BANKLANG) MEMBER(SQLBATCH)");
  });

  it("feeds the precompiler's output to the compiler", () => {
    const jcl = jclFor(WITH_SQL);

    expect(jcl).toContain("//SYSCIN   DD DSN=&&PRECOUT,DISP=(NEW,PASS)");
    expect(jcl).toContain("//SYSIN    DD DSN=&&PRECOUT,DISP=(OLD,DELETE)");
  });

  it("puts the Db2 load library on the run step", () => {
    const jcl = jclFor(WITH_SQL);
    const run = jcl.slice(jcl.indexOf("//RUN "));

    expect(run).toContain("//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD");
  });
});

describe("a CICS job", () => {
  it("translates before anything else reads the source", () => {
    const jcl = jclFor(WITH_CICS);

    expect(jcl.indexOf("PGM=DFHECP1$")).toBeLessThan(
      jcl.indexOf("PGM=IGYCRCTL"),
    );
    expect(jcl).toContain("//SYSIN    DD DSN=&&TRANOUT,DISP=(OLD,DELETE)");
  });

  /**
   * A CICS program is started by a transaction identifier in a region, not by
   * EXEC PGM in a job. A run step here would describe something that cannot
   * happen.
   */
  it("has no run step, and says why", () => {
    const jcl = jclFor(WITH_CICS);

    expect(jcl).not.toContain("//RUN      EXEC");
    expect(jcl).toContain("//* No run step: a CICS program is started by");
  });
});
