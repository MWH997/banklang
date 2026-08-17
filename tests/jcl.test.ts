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

function jclFor(
  source: string,
  options: Parameters<typeof emitJcl>[1] = {},
): string {
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
  return emitJcl(ir.program, options).jcl;
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

  if sqlcode < 0 {
    audit("DB2_FAILED", idempotencyKey);
  } else {
    if sqlcode == 0 {
      audit("FOUND", idempotencyKey);
    } else {
      audit("MISSING", idempotencyKey);
    }
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
  /**
   * What a shop submits: IBM's own cataloged procedure, with only the DDs its
   * parameter list documents as the caller's. Every STEPLIB, all sixteen work
   * files, both LE link libraries and `REGION=0M` come from the procedure, so
   * none of them can be forgotten here.
   */
  it("compiles and link-edits through IBM's cataloged procedure", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).toContain("//COMPILE  EXEC IGYWCL,");
    expect(jcl).toContain("//             LNGPRFX='IGY.V6R4M0',LIBPRFX='CEE',");
    expect(jcl).toContain(
      "//COBOL.SYSIN    DD DISP=SHR,DSN=BANKLANG.COBOL(PLAINBAT)",
    );
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
      "//             PGMLIB='BANKLANG.LOADLIB',GOPGM=PLAINBAT",
    );
    expect(jcl).toContain("//RUN      EXEC PGM=PLAINBAT");
  });

  /**
   * A load module written to a library the run step cannot see is a job that
   * compiles, links, and then ends S806, module not found, with nothing in
   * the log to say the build was fine.
   */
  it("puts the library it just wrote to on the run step's search order", () => {
    const jcl = jclFor(PLAIN);
    const run = jcl.slice(jcl.indexOf("//RUN "));

    expect(run).toContain("//STEPLIB  DD DISP=SHR,DSN=BANKLANG.LOADLIB");
    expect(run).toContain("//         DD DISP=SHR,DSN=CEE.SCEERUN");
    expect(run).toContain("//         DD DISP=SHR,DSN=CEE.SCEERUN2");
  });

  /**
   * A step with no REGION runs in whatever the installation's default is, and
   * the compiler is not a small program. IGYWCL states `REGION=0M` on both of
   * its steps for that reason, and so does every step this emitter writes.
   */
  it("states a region on the job and on every step it writes", () => {
    for (const source of [PLAIN, WITH_FILES, WITH_SQL, WITH_CICS]) {
      const jcl = jclFor(source);
      for (const line of jcl.split("\n")) {
        if (/^\/\/\w+\s+EXEC PGM=/.test(line)) {
          expect(`${line} in\n${jcl}`).toContain("REGION=0M");
        }
      }
    }
  });

  /**
   * A dataset name is at most 44 characters and each qualifier at most 8. The
   * emitter used to build one from the build path, so
   * `dist/cobol/BATCH-INTEREST-ACCRUAL.cbl` became
   * `DIST.COBOL.BATCHINTERESTACCRUAL`, a 20-character qualifier, and a JCL
   * error before the compiler was ever reached.
   */
  it("writes dataset names z/OS accepts", () => {
    for (const source of [PLAIN, WITH_FILES, WITH_SQL, WITH_CICS]) {
      const jcl = jclFor(source);
      for (const [, dsn = ""] of jcl.matchAll(
        /DSN(?:AME)?=([A-Z0-9.@#$&]+)/g,
      )) {
        // `&&NAME` is a temporary dataset, which the system names itself.
        if (dsn.startsWith("&&")) continue;
        const name = dsn.replace(/\(.*/, "");
        expect(`${name} in\n${jcl}`).toSatisfy(() => name.length <= 44);
        for (const qualifier of name.split(".")) {
          expect(`${qualifier} of ${name}`).toSatisfy(
            () => qualifier.length > 0 && qualifier.length <= 8,
          );
        }
      }
    }
  });
});

/**
 * The expanded form, for a site with no IGYWCL installed and for a program that
 * cannot use it. Every DD comes from the procedure's printed text rather than
 * from this emitter's memory of it, which is the only way the two forms can be
 * held to describing the same build.
 */
describe("the expanded compile and link-edit", () => {
  it("writes the compiler's own libraries and all sixteen work files", () => {
    const jcl = jclFor(PLAIN, { mode: "expanded" });

    expect(jcl).toContain("//COBOL    EXEC PGM=IGYCRCTL,REGION=0M");
    expect(jcl).toContain("//STEPLIB  DD DISP=SHR,DSN=IGY.V6R4M0.SIGYCOMP");
    for (let index = 1; index <= 15; index += 1) {
      expect(jcl).toContain(`//SYSUT${index}`);
    }
    expect(jcl).toContain("//SYSMDECK DD UNIT=SYSALLDA,SPACE=(CYL,(1,1))");
  });

  /**
   * `COND=(8,LT,COBOL)`, not `(4,LT)`: a compile that only warned returns 4 and
   * its object module is still worth binding. IGYWCL says so itself.
   */
  it("binds an object module the compiler only warned about", () => {
    expect(jclFor(PLAIN, { mode: "expanded" })).toContain(
      "//LKED     EXEC PGM=IEWBLINK,REGION=0M,COND=(8,LT,COBOL)",
    );
  });

  /**
   * Every `CALL "BANKLEDG"` is static under the default NODYNAM, so the binder
   * resolves it by searching SYSLIB. Without the object library there the load
   * module is short of every routine it calls and fails at bind.
   */
  it("gives the binder somewhere to resolve the static calls from", () => {
    const jcl = jclFor(PLAIN, { mode: "expanded" });
    const lked = jcl.slice(jcl.indexOf("//LKED "));

    expect(lked).toContain("//SYSLIB   DD DISP=SHR,DSN=BANKLANG.OBJLIB");
    expect(lked).toContain("//         DD DISP=SHR,DSN=CEE.SCEELKEX");
    expect(lked).toContain("//         DD DISP=SHR,DSN=CEE.SCEELKED");
  });

  /**
   * A program whose source has to be read by a translator or a precompiler
   * first cannot use the cataloged procedure at all: those steps run ahead of
   * the compiler, and a procedure has no step to put one in.
   */
  it("is what a program with a precompiler gets, whatever the caller asked", () => {
    const jcl = jclFor(WITH_SQL, { mode: "cataloged" });

    expect(jcl).toContain("//COBOL    EXEC PGM=IGYCRCTL");
    expect(jcl).not.toContain("//COMPILE  EXEC IGYWCL");
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
      "//POSTINGO DD DSN=BANKLANG.POSTINGO,DISP=(NEW,CATLG,DELETE),",
    );
  });

  it("allocates an output file and shares an input one", () => {
    const jcl = jclFor(WITH_FILES);

    // An input dataset already exists; an output dataset is created.
    expect(jcl).toMatch(/\/\/ACCOUNTI DD DISP=SHR/);
    expect(jcl).toMatch(/\/\/POSTINGO DD DSN=[^,]+,DISP=\(NEW,CATLG,DELETE\)/);
  });

  /**
   * The abnormal disposition is the one that matters. A step that dies halfway
   * through writing has produced a partial dataset, and cataloguing it invites
   * the next job in the chain to read it as though it were a complete day.
   */
  it("deletes a half-written output dataset rather than cataloguing it", () => {
    expect(jclFor(WITH_FILES)).not.toMatch(/DISP=\(NEW,CATLG\)/);
  });

  /**
   * An updated file is read and rewritten in place, so it exists already: NEW
   * would allocate an empty one and the program would find nothing in it.
   */
  it("gives an updated file the dataset it is meant to update", () => {
    const jcl = jclFor(`module UpdateBatch;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

file master indexed update record Account key accountId status masterStatus;

entry transaction settle(account: Account) {
  audit("SETTLED", account.idempotencyKey);
}`);

    expect(jcl).toContain("//MASTER   DD DISP=OLD,DSN=BANKLANG.MASTER");
  });
});

/**
 * A step that runs after a step that failed is the way a broken build reaches
 * production: the compile fails, the link-edit is bypassed, and the run step
 * executes whatever load module the library already held, the previous
 * version, under a return code that says the job worked.
 */
describe("what happens after a step fails", () => {
  it("bypasses the run step", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).toContain("//RUN      EXEC PGM=PLAINBAT,");
    expect(jcl).toContain("//             REGION=0M,COND=(4,LT)");
  });

  /**
   * Every step after the first carries a condition. The link-edit's is
   * `(8,LT,COBOL)`, IGYWCL's own, because a compile that only warned still
   * produced an object module; the rest are `(4,LT)`.
   */
  it("bypasses every step after the first", () => {
    const jcl = jclFor(WITH_SQL);
    const steps = jcl
      .split("\n")
      .flatMap((line, index) =>
        /^\/\/\w+\s+EXEC PGM=/.test(line)
          ? [`${line}${jcl.split("\n")[index + 1] ?? ""}`]
          : [],
      );

    expect(steps.length).toBeGreaterThan(1);
    for (const step of steps.slice(1)) {
      expect(step).toMatch(/COND=\(4,LT\)|COND=\(8,LT,COBOL\)/);
    }
  });
});

/**
 * An abend with no dump leaves the return code as the only evidence. Both DDs
 * are conventional on a batch run step for that reason.
 */
describe("diagnosing a run that died", () => {
  it("gives the run step somewhere to write a dump", () => {
    const run = jclFor(PLAIN).slice(jclFor(PLAIN).indexOf("//RUN "));

    expect(run).toContain("//CEEDUMP  DD SYSOUT=*");
    expect(run).toContain("//SYSUDUMP DD SYSOUT=*");
  });
});

/**
 * The sort product spills to work datasets, and three is the customary
 * allocation. A merge needs none, because its inputs already arrive in order, so this
 * is keyed on a real SORT rather than on "the program sorts or merges".
 */
describe("a job whose program sorts", () => {
  const SORTING = `module SortBatch;

record Posting {
  branchId: string<8>;
  accountId: string<16>;
  idempotencyKey: string<36>;
}

file rawPostings sequential input record Posting status rawStatus;
file otherPostings sequential input record Posting status otherStatus;
file sortedPostings sequential output record Posting status sortedStatus;

entry transaction order(posting: Posting) {
  OPERATION
  audit("ORDERED", posting.idempotencyKey);
}`;

  it("allocates sort work datasets", () => {
    const jcl = jclFor(
      SORTING.replace(
        "OPERATION",
        "sort rawPostings into sortedPostings on branchId;",
      ),
    );

    expect(jcl).toContain("//SORTWK01 DD UNIT=SYSALLDA");
    expect(jcl).toContain("//SORTWK03 DD UNIT=SYSALLDA");
  });

  it("allocates none for a merge", () => {
    const jcl = jclFor(
      SORTING.replace(
        "OPERATION",
        "merge rawPostings, otherPostings into sortedPostings on branchId;",
      ),
    );

    expect(jcl).not.toContain("SORTWK");
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
    expect(jcl.indexOf("PGM=IEWBLINK")).toBeGreaterThan(0);
    expect(jcl.indexOf("PGM=IEWBLINK")).toBeLessThan(
      jcl.indexOf("PGM=IKJEFT01"),
    );
    expect(jcl).toContain("BIND PACKAGE(BANKLANG) MEMBER(SQLBATCH)");
  });

  /**
   * A package cannot be run. RUN names a plan, and a plan is what the package
   * has to be listed in, because binding only the package leaves the program with
   * nothing to run under, which shows up at execution rather than at bind.
   */
  it("binds a plan as well as the package", () => {
    expect(jclFor(WITH_SQL)).toContain(
      "BIND PLAN(SQLBATCH) PKLIST(BANKLANG.*)",
    );
  });

  /**
   * A program with embedded SQL cannot be started by EXEC PGM=. It needs a
   * thread to Db2, and what establishes one is the DSN command processor: the
   * step runs TSO in batch and DSN RUN attaches the program to the subsystem
   * under its plan. Started directly it has no thread and fails on its first
   * SQL statement, which reads, from the job log, as a database problem.
   */
  it("runs the program under the DSN command processor", () => {
    const jcl = jclFor(WITH_SQL);
    const run = jcl.slice(jcl.indexOf("//RUN "));

    expect(run).toContain("//RUN      EXEC PGM=IKJEFT1B");
    expect(run).not.toContain("//RUN      EXEC PGM=SQLBATCH");
    expect(run).not.toContain("//RUN      EXEC PGM=IKJEFT01");
    expect(run).toContain("  DSN SYSTEM(DSN)");
    expect(run).toContain("  RUN PROGRAM(SQLBATCH) PLAN(SQLBATCH) -");
    expect(run).toContain("      LIB('BANKLANG.LOADLIB')");
  });

  /** DD * runs to its delimiter, so anything after it is command input. */
  it("puts the command input last in the step", () => {
    const jcl = jclFor(WITH_SQL);
    const run = jcl.slice(jcl.indexOf("//RUN "));

    expect(run.indexOf("//SYSOUT")).toBeLessThan(run.indexOf("//SYSTSIN"));
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

/**
 * Which TSO entry point runs the program, which is not a cosmetic choice.
 *
 * Both return the program's code, since DSN puts the highest value from the RUN
 * subcommand in register 15, and terminates if the program gives a non-zero one
 * subcommand in register 15, but they differ on an abend. Under IKJEFT01 an abending program does not
 * abend the step: TSO catches it and the step ends *normally* with condition
 * code 12. A step that ended normally takes the normal disposition, so the
 * DELETE on the output datasets is never honoured and the half-written dataset
 * is catalogued after all. IKJEFT1B terminates the step with X'04C', which is
 * what makes a conditional disposition mean anything.
 *
 * The bind step keeps IKJEFT01 for the opposite reason: a BIND that only warns
 * returns 4, and IKJEFT1B stops the moment anything returns non-zero, so the
 * plan would go unbound because the package warned.
 */
describe("the TSO entry point", () => {
  const SQL_WITH_FILE = `module SqlFileBatch;

record AccountRow {
  rowAccountId: string<16>;
}

file postingOutput sequential output record AccountRow status postingStatus;

sql fetchAccount(keyAccountId: string<16>): AccountRow {
  SELECT ACCOUNT_ID INTO :rowAccountId FROM ACCOUNT WHERE ACCOUNT_ID = :keyAccountId
}

entry transaction settle(row: AccountRow, idempotencyKey: string<36>) {
  execute fetchAccount("ACC-1") into row;
  if sqlcode < 0 {
    audit("DB2_FAILED", idempotencyKey);
  } else {
    if sqlcode == 0 {
      audit("FOUND", idempotencyKey);
    } else {
      audit("MISSING", idempotencyKey);
    }
  }
}`;

  it("runs the program under the entry point that abends the step", () => {
    const jcl = jclFor(SQL_WITH_FILE);
    const run = jcl.slice(jcl.indexOf("//RUN "));

    expect(run).toContain("PGM=IKJEFT1B");
    expect(run).toContain("DISP=(NEW,CATLG,DELETE)");
  });

  it("binds under the one that tolerates a warning", () => {
    const jcl = jclFor(SQL_WITH_FILE);
    const bind = jcl.slice(jcl.indexOf("//BIND "), jcl.indexOf("//RUN "));

    expect(bind).toContain("PGM=IKJEFT01");
  });
});

/**
 * Language Environment run-time options.
 *
 * A step that states none runs on whatever the installation's defaults are,
 * which is not something a job's behaviour should depend on silently. Two are
 * emitted by default and are about whether a bad night can be diagnosed at
 * all; the rest is a site's, because a long-running batch's heap and stack
 * depend on the region and the data rather than on anything the compiler sees.
 */
describe("the run-time options a step states", () => {
  it("asks for a dump and for LE to be in the path to produce one", () => {
    const jcl = jclFor(PLAIN);

    expect(jcl).toContain("//CEEOPTS  DD *");
    expect(jcl).toContain("  TERMTHDACT(UADUMP)");
    expect(jcl).toContain("  TRAP(ON)");
  });

  it("writes what the project states instead", () => {
    const jcl = jclFor(PLAIN, {
      runtimeOptions: ["HEAP(4M,1M,ANYWHERE,KEEP)", "STACK(1M,1M,ANYWHERE)"],
    });

    expect(jcl).toContain("  HEAP(4M,1M,ANYWHERE,KEEP)");
    expect(jcl).toContain("  STACK(1M,1M,ANYWHERE)");
    expect(jcl).not.toContain("TERMTHDACT");
  });
});
