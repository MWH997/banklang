import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * CICS beyond LINK, SYNCPOINT, and ROLLBACK.
 *
 * Three commands is not an online program. A real one reaches a dataset through
 * CICS rather than through COBOL file control, passes state through temporary
 * storage, and ends its task naming what runs next — which is what makes a
 * pseudo-conversation possible at all.
 */

const PREAMBLE = `module Online;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record Request {
  accountId: string<16>;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
cics transaction enquire(request: Request, row: AccountRow) {
${body}
  audit("ENQUIRED", request.idempotencyKey);
}`);
}

describe("file commands", () => {
  /**
   * There is no OPEN, no CLOSE, and no FD: the region owns the dataset and the
   * program only asks. That is what makes a CICS file command a different thing
   * from COBOL file control, not a synonym for it.
   */
  it("reads a record by key", () => {
    const result = txn(
      '  readFile "ACCTFILE" into row key request.accountId resp readResp;',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'EXEC CICS READ FILE("ACCTFILE") INTO(ACCOUNT-ROW) RIDFLD(ACCOUNT-ID OF REQUEST) RESP(READ-RESP) END-EXEC',
    );
  });

  it("writes a record by key", () => {
    const result = txn(
      '  writeFile "ACCTFILE" from row key request.accountId resp writeResp;',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'EXEC CICS WRITE FILE("ACCTFILE") FROM(ACCOUNT-ROW) RIDFLD(ACCOUNT-ID OF REQUEST) RESP(WRITE-RESP) END-EXEC',
    );
  });

  /**
   * A rewrite updates the record the preceding read is holding, so naming a key
   * would describe a different operation.
   */
  it("rewrites without a key", () => {
    const result = txn('  rewriteFile "ACCTFILE" from row resp writeResp;');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'EXEC CICS REWRITE FILE("ACCTFILE") FROM(ACCOUNT-ROW) RESP(WRITE-RESP) END-EXEC',
    );
    expect(result.cobol).not.toContain(
      'REWRITE FILE("ACCTFILE") FROM(ACCOUNT-ROW) RIDFLD',
    );
  });

  it("requires the key a read or write addresses", () => {
    expect(ids(txn('  readFile "ACCTFILE" into row resp readResp;'))).toContain(
      "BANK-CICS-002",
    );
  });
});

describe("temporary storage", () => {
  it("writes and reads a queue", () => {
    const result = txn(`  writeQueue "ENQLOG" from row resp writeResp;
  readQueue "ENQLOG" into row resp readResp;`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'EXEC CICS WRITEQ TS QUEUE("ENQLOG") FROM(ACCOUNT-ROW) RESP(WRITE-RESP) END-EXEC',
    );
    expect(result.cobol).toContain(
      'EXEC CICS READQ TS QUEUE("ENQLOG") INTO(ACCOUNT-ROW) RESP(READ-RESP) END-EXEC',
    );
  });

  /** A queue command is ordinary work, not a commit boundary. */
  it("allows a queue write inside a loop", () => {
    const result = compile(`${PREAMBLE}
cics transaction enquire(request: Request, row: AccountRow) {
  let index: decimal<4, 0> = 0;

  while index < 3 limit 10 {
    writeQueue "ENQLOG" from row resp writeResp;
    index = index + 1;
  }

  audit("ENQUIRED", request.idempotencyKey);
}`);

    expect(ids(result)).not.toContain("BANK-CICS-003");
  });
});

describe("returning to CICS", () => {
  /**
   * How a pseudo-conversation continues: CICS frees the program between the
   * halves and starts the named transaction when the terminal replies.
   */
  it("ends the task naming what runs next", () => {
    const result = txn('  returnTransid "ENQ2" commarea request;');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'EXEC CICS RETURN TRANSID("ENQ2") COMMAREA(REQUEST) END-EXEC',
    );
  });

  /** A second RETURN would be unreachable and would read as a mistake. */
  it("does not append a second RETURN after one", () => {
    const cobol =
      compile(`${PREAMBLE}
cics transaction enquire(request: Request, row: AccountRow) {
  audit("ENQUIRED", request.idempotencyKey);
  returnTransid "ENQ2" commarea request;
}`).cobol ?? "";

    expect(cobol.match(/EXEC CICS RETURN/g)).toHaveLength(1);
  });

  /** It ends the task, so there is no response to come back to. */
  it("needs no response code", () => {
    expect(ids(txn('  returnTransid "ENQ2" commarea request;'))).not.toContain(
      "BANK-CICS-001",
    );
  });
});

describe("every other command captures its outcome", () => {
  it("reports a file command with no response code", () => {
    const result = txn('  readFile "ACCTFILE" into row key request.accountId;');

    expect(ids(result)).toContain("BANK-CICS-001");
  });

  it("reports a queue command with no response code", () => {
    expect(ids(txn('  writeQueue "ENQLOG" from row;'))).toContain(
      "BANK-CICS-001",
    );
  });

  it("still requires a CICS transaction", () => {
    const result = compile(`${PREAMBLE}
entry transaction enquire(request: Request, row: AccountRow) {
  readQueue "ENQLOG" into row resp readResp;
  audit("ENQUIRED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-CICS-002");
  });
});
