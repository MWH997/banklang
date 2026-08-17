import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { IRProgram } from "../packages/ir/src/index";
import { analyzeProgramSemantics } from "../packages/semantic-analyzer/src/index";

import { compileExample, compileSource, unpadded } from "./helpers";

const RECORD = `module Files;

type MoneyBDT = decimal<18, 2>;

record AccountRecord {
  accountId: string<16>;
  balance: MoneyBDT;
}
`;

describe("file declarations", () => {
  it("parses organization, mode, record type, and status", () => {
    const { parsed, typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord status accountInputStatus;`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
    expect(typechecked.files).toHaveLength(1);
    expect(typechecked.files[0]).toMatchObject({
      name: "accountInput",
      organization: "sequential",
      mode: "input",
      statusName: "accountInputStatus",
    });
  });

  it("parses a declaration with no status clause", () => {
    const { parsed, typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.files[0]!.statusName).toBeNull();
  });

  it("rejects an unknown record type", () => {
    const { typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record MissingRecord status s;`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-001",
    );
  });

  it("rejects an unknown file mode", () => {
    const { parsed } = compileSource(
      `${RECORD}
file accountInput sequential sideways record AccountRecord status s;`,
    );

    expect(parsed.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-SYN-001",
    );
  });

  it("keeps status, input, and output usable as field names", () => {
    const { parsed, typechecked } = compileSource(`module Naming;

record Flags {
  status: string<1>;
  input: string<1>;
  output: string<1>;
  sequential: string<1>;
}`);

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
  });
});

describe("file status diagnostics", () => {
  it("reports BANK-FILE-001 when a file has no status field", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-FILE-001",
    ]);
    expect(result.diagnostics[0]!.message).toContain(
      "File accountInput declares no file status field.",
    );
  });

  it("accepts a file with a status field", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord status accountInputStatus;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.fileCount).toBe(1);
  });

  it("reports one diagnostic per unstatused file", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;

file postingOutput sequential output record AccountRecord;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-FILE-001",
      "BANK-FILE-001",
    ]);
  });
});

describe("file COBOL emission", () => {
  it("emits the golden COBOL output for the account-file-batch example", () => {
    const { emit } = compileExample("examples/account-file-batch");
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/account-file-batch.cbl"),
      "utf8",
    );

    expect(emit.cobol).toBe(expected);
  });

  it("emits a FILE-CONTROL entry with the FILE STATUS clause", () => {
    const { emit } = compileExample("examples/account-file-batch");

    expect(emit.cobol).toContain(
      "SELECT ACCOUNT-INPUT-FILE ASSIGN TO ACCOUNTI",
    );
    expect(emit.cobol).toContain("FILE STATUS IS ACCOUNT-INPUT-STATUS.");
  });

  /**
   * The FD record carries the real field structure so per-field access works.
   * Field names are not prefixed: COBOL allows duplicate data names as long as
   * every reference is qualified, and a prefix would collide with the
   * conventional `<file>Status` name for the file status field.
   */
  it("emits a structured FD record", () => {
    const { emit } = compileExample("examples/account-file-batch");

    expect(emit.cobol).toContain("01  ACCOUNT-INPUT-RECORD.");
    expect(unpadded(emit.cobol)).toContain("05 ACCOUNT-ID PIC X(16).");
    expect(unpadded(emit.cobol)).toContain("05 BALANCE PIC S9(16)V99");
  });

  it("suffixes COBOL file names so they cannot collide with a record", () => {
    const { emit } = compileExample("examples/account-file-batch");

    expect(emit.cobol).toContain("FD  ACCOUNT-INPUT-FILE\n");
    expect(emit.cobol).toContain("SELECT ACCOUNT-INPUT-FILE");
    // The record type keeps the unsuffixed name, so the two cannot collide.
    expect(emit.cobol).toContain("01  ACCOUNT-RECORD.");
  });

  it("declares each file status field once in working storage", () => {
    const { emit } = compileExample("examples/account-file-batch");
    const occurrences = emit.cobol.split("01  ACCOUNT-INPUT-STATUS").length - 1;

    expect(occurrences).toBe(1);
  });

  /**
   * A failed second OPEN jumps past the source CLOSE for the first file. The
   * generated program has to remember the first one is live and close it from
   * BANK-MAIN; closing every declaration blindly would turn the unopened
   * second file into status 42 and hide the original failure.
   */
  it("closes only files still open when an early failure leaves the body", () => {
    const { emit } = compileExample("examples/account-file-batch");
    const cobol = emit.cobol;

    expect(unpadded(cobol)).toContain(
      '01 BANK-FILE-OPEN-1 PIC X(1) VALUE "N".',
    );
    expect(unpadded(cobol)).toContain(
      '01 BANK-FILE-OPEN-2 PIC X(1) VALUE "N".',
    );

    const body = cobol.slice(cobol.indexOf("       POST-ACCOUNTS."));
    expect(body.indexOf("OPEN INPUT ACCOUNT-INPUT-FILE")).toBeLessThan(
      body.indexOf('MOVE "Y" TO BANK-FILE-OPEN-1'),
    );
    expect(body.indexOf("CLOSE ACCOUNT-INPUT-FILE")).toBeLessThan(
      body.indexOf('MOVE "N" TO BANK-FILE-OPEN-1'),
    );

    const main = cobol.slice(
      cobol.indexOf("       BANK-MAIN."),
      cobol.indexOf("       BANK-ACCEPT-PARM."),
    );
    expect(main).toContain('IF BANK-FILE-OPEN-1 = "Y"');
    expect(main).toContain("CLOSE ACCOUNT-INPUT-FILE");
    expect(main).toContain('IF BANK-FILE-OPEN-2 = "Y"');
    expect(main).toContain("CLOSE POSTING-OUTPUT-FILE");
    expect(main.indexOf("CLOSE ACCOUNT-INPUT-FILE")).toBeLessThan(
      main.indexOf("MOVE BANK-RETURN-CODE TO RETURN-CODE"),
    );
    expect(main).toContain("IF BANK-FAILURE-CODE = SPACES");
  });
});

/**
 * `rewrite` and `delete` on a file the program reads sequentially.
 *
 * Both replace the record the last `read` returned, so on a sequentially
 * accessed file they need one. Without it the operation **is not performed and
 * the status is 92**: no abend, no exception, so a program that does not test
 * the status carries on believing it updated something.
 *
 * Only sequential and relative files: an indexed file is `ACCESS MODE IS
 * DYNAMIC`, where the record key in the record area says which record is meant.
 */
describe("updating a record nothing read", () => {
  const program = (
    decls: string,
    body: string,
  ): ReturnType<typeof compileSource> =>
    compileSource(`${RECORD}
${decls}

entry transaction settle(account: AccountRecord, idempotencyKey: string<36>) {
${body}
  audit("SETTLED", idempotencyKey);
}`);

  const ids = (result: ReturnType<typeof compileSource>): string[] =>
    result.typechecked.diagnostics.map((entry) => entry.id);

  it("rejects a rewrite with no read before it", () => {
    const result = program(
      "file feed sequential update record AccountRecord status feedStatus;",
      "  open feed;\n  rewrite feed from account;\n  close feed;",
    );

    expect(ids(result)).toContain("BANK-FILE-010");
  });

  it("accepts one the read reaches", () => {
    const result = program(
      "file feed sequential update record AccountRecord status feedStatus;",
      "  open feed;\n  read feed into account;\n  rewrite feed from account;\n  close feed;",
    );

    expect(ids(result)).not.toContain("BANK-FILE-010");
  });

  /**
   * A read inside a branch does not travel back out: the path that skipped the
   * branch reaches the update with nothing read.
   */
  it("does not count a read the update can be reached without", () => {
    const result = program(
      "file feed sequential update record AccountRecord status feedStatus;",
      `  open feed;
  if feedStatus == "00" {
    read feed into account;
  }
  rewrite feed from account;
  close feed;`,
    );

    expect(ids(result)).toContain("BANK-FILE-010");
  });

  /** A read in an enclosing block does cover a branch inside it. */
  it("counts a read the branch sits under", () => {
    const result = program(
      "file feed sequential update record AccountRecord status feedStatus;",
      `  open feed;
  read feed into account;
  if feedStatus == "00" {
    rewrite feed from account;
  }
  close feed;`,
    );

    expect(ids(result)).not.toContain("BANK-FILE-010");
  });

  /**
   * The branch shapes the walk used to skip.
   *
   * This check walks the body, and until 2026-08-07 it walked it with a list of
   * property names that did not include `otherwise`, a `switch`'s `else`
   * branch. An update in one was never examined, so the check reported nothing
   * and the program passed. That is the worse direction for a rule to be wrong
   * in: a missing diagnostic looks exactly like a clean program.
   *
   * Both are `switch` branches with no read on the path, so both must be
   * reported, in the same way the `if` above is.
   */
  it("sees an update inside a switch case", () => {
    const result = program(
      `enum EntryKind {
  DEBIT,
  CREDIT
}

file feed sequential update record AccountRecord status feedStatus;`,
      `  open feed;
  let kind: EntryKind = EntryKind.DEBIT;
  switch kind {
    case DEBIT {
      rewrite feed from account;
    }
    case CREDIT {
      close feed;
    }
  }`,
    );

    expect(ids(result)).toContain("BANK-FILE-010");
  });

  it("sees an update inside a switch else branch", () => {
    const result = program(
      `enum EntryKind {
  DEBIT,
  CREDIT
}

file feed sequential update record AccountRecord status feedStatus;`,
      `  open feed;
  let kind: EntryKind = EntryKind.DEBIT;
  switch kind {
    case DEBIT {
      close feed;
    }
    else {
      rewrite feed from account;
    }
  }`,
    );

    expect(ids(result)).toContain("BANK-FILE-010");
  });

  /** An indexed file is addressed by key, so it needs no prior read. */
  it("says nothing about an indexed file", () => {
    const result = program(
      "file feed indexed update record AccountRecord key accountId status feedStatus;",
      "  open feed;\n  rewrite feed from account;\n  close feed;",
    );

    expect(ids(result)).not.toContain("BANK-FILE-010");
  });
});

/**
 * Enterprise COBOL has no `DELETE` for a file with sequential organization: a
 * record is removed by leaving it out of the file the next program writes.
 *
 * GnuCOBOL compiles the statement, which is exactly why nothing local caught
 * it: the generated program passed every check here and would have been
 * rejected by IGYCRCTL.
 */
describe("deleting from a sequential file", () => {
  it("is rejected", () => {
    const result = compileSource(`${RECORD}
file feed sequential update record AccountRecord status feedStatus;

entry transaction settle(account: AccountRecord, idempotencyKey: string<36>) {
  open feed;
  read feed into account;
  delete feed;
  close feed;
  audit("SETTLED", idempotencyKey);
}`);

    expect(result.typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-FILE-011",
    );
  });

  it("is allowed on a relative file the program read", () => {
    const result = compileSource(`${RECORD}
file feed relative update record AccountRecord status feedStatus;

entry transaction settle(account: AccountRecord, idempotencyKey: string<36>) {
  open feed;
  read feed into account;
  delete feed;
  close feed;
  audit("SETTLED", idempotencyKey);
}`);

    expect(
      result.typechecked.diagnostics.map((entry) => entry.id),
    ).not.toContain("BANK-FILE-011");
  });
});
