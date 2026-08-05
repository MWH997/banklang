import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

const PREAMBLE = `module Online;

type BDT = currency<"BDT", 18, 2>;

record Row {
  rowId: string<16>;
  rowBalance: BDT;
}

record Request {
  accountId: string<16>;
  idempotencyKey: string<36>;
}
`;

const SELECT = `sql fetchAccount(keyId: string<16>): Row {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowId, :rowBalance
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyId
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("SQL declarations", () => {
  it("emits EXEC SQL with rewritten host variables", () => {
    const result = compile(`${PREAMBLE}\n${SELECT}
transaction t(request: Request, row: Row) {
  execute fetchAccount(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("EXEC SQL INCLUDE SQLCA END-EXEC.");
    expect(result.cobol).toContain("EXEC SQL");
    expect(result.cobol).toContain("END-EXEC");
    // Parameters bind to dedicated host storage; result fields to the record.
    expect(result.cobol).toContain("WHERE ACCOUNT_ID = :FETCH-ACCOUNT-H1");
    expect(result.cobol).toContain(":ROW-ID OF ROW");
  });

  it("reports the Db2 precompiler as a backend requirement", () => {
    const result = compile(`${PREAMBLE}\n${SELECT}
transaction t(request: Request, row: Row) {
  execute fetchAccount(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(result.backendRequirements).toEqual(["db2-precompiler"]);
  });

  it("reports BANK-SQL-001 when SQLCODE is never checked", () => {
    const result = compile(`${PREAMBLE}\n${SELECT}
transaction t(request: Request, row: Row) {
  execute fetchAccount(request.accountId) into row;
  audit("DONE", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-SQL-001");
  });

  it("reports BANK-SQL-002 for dynamic SQL", () => {
    const result = compile(`${PREAMBLE}
sql dyn(keyId: string<16>): Row {
  EXECUTE IMMEDIATE :keyId
}

transaction t(request: Request, row: Row) {
  execute dyn(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-002");
  });

  it("reports BANK-SQL-003 for an unresolvable host variable", () => {
    const result = compile(`${PREAMBLE}
sql bad(keyId: string<16>): Row {
  SELECT ACCOUNT_ID INTO :notAField FROM ACCOUNT WHERE ACCOUNT_ID = :keyId
}

transaction t(request: Request, row: Row) {
  execute bad(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-003");
  });

  it("reports BANK-SQL-003 when a host variable is both input and output", () => {
    const result = compile(`${PREAMBLE}
sql ambiguous(rowId: string<16>): Row {
  SELECT ACCOUNT_ID INTO :rowId FROM ACCOUNT WHERE ACCOUNT_ID = :rowId
}

transaction t(request: Request, row: Row) {
  execute ambiguous(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-003");
    expect(result.diagnostics[0].message).toContain("both a parameter");
  });

  it("reports BANK-SQL-003 when the result is discarded", () => {
    const result = compile(`${PREAMBLE}\n${SELECT}
transaction t(request: Request, row: Row) {
  execute fetchAccount(request.accountId);
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", request.idempotencyKey);
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-003");
  });

  it("rejects an unknown SQL statement", () => {
    const result = compile(`${PREAMBLE}
transaction t(request: Request, row: Row) {
  execute missing(request.accountId) into row;
  audit("DONE", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-001");
  });
});

describe("CICS transactions", () => {
  const CICS = `${PREAMBLE}
cics transaction enquiry(request: Request, row: Row) {
`;

  it("emits DFHCOMMAREA, EXEC CICS, and RETURN", () => {
    const result = compile(`${CICS}
  link "AUDITLOG" commarea row resp linkResp;
  if linkResp == 0 {
    audit("OK", request.idempotencyKey);
  } else {
    audit("FAILED", request.idempotencyKey);
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("LINKAGE SECTION.");
    expect(result.cobol).toContain("01  DFHCOMMAREA.");
    expect(flowed(result.cobol)).toContain(
      flowed(
        'EXEC CICS LINK PROGRAM("AUDITLOG") COMMAREA(ROW) RESP(LINK-RESP) END-EXEC',
      ),
    );
    // RETURN and then GOBACK, which is how the CICS Application Programming
    // Guide's own sample ends: ending the task is something CICS does, not
    // something COBOL does, so without the GOBACK the paragraph falls through
    // into the next one.
    expect(result.cobol).toContain(
      "           EXEC CICS RETURN END-EXEC\n           GOBACK.",
    );
  });

  it("reports the CICS translator as a backend requirement", () => {
    const result = compile(`${CICS}
  link "AUDITLOG" commarea row resp linkResp;
  if linkResp == 0 {
    audit("OK", request.idempotencyKey);
  } else {
    audit("FAILED", request.idempotencyKey);
  }
}`);

    expect(result.backendRequirements).toEqual(["cics-translator"]);
  });

  it("reports BANK-CICS-001 when a response code is not captured", () => {
    const result = compile(`${CICS}
  link "AUDITLOG" commarea row;
  audit("OK", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-CICS-001");
  });

  it("reports BANK-CICS-002 outside a CICS transaction", () => {
    const result = compile(`${PREAMBLE}
transaction plain(request: Request, row: Row) {
  link "AUDITLOG" commarea row resp linkResp;
  audit("OK", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-CICS-002");
  });

  it("reports BANK-CICS-003 for a syncpoint inside a loop", () => {
    const result = compile(`${CICS}
  let counter: decimal<4, 0> = 0;
  while counter < 5 limit 5 {
    syncpoint resp commitResp;
    counter = counter + 1;
  }
  audit("OK", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-CICS-003");
  });

  it("emits SYNCPOINT and SYNCPOINT ROLLBACK", () => {
    const result = compile(`${CICS}
  link "AUDITLOG" commarea row resp linkResp;
  if linkResp == 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }
  audit("OK", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("EXEC CICS SYNCPOINT RESP(COMMIT-RESP)");
    expect(result.cobol).toContain(
      "EXEC CICS SYNCPOINT ROLLBACK RESP(ROLLBACK-RESP)",
    );
  });

  it("keeps a non-CICS transaction on GOBACK", () => {
    const result = compile(`${PREAMBLE}
transaction plain(request: Request) {
  audit("OK", request.idempotencyKey);
}`);

    expect(result.cobol).toContain("GOBACK.");
    expect(result.cobol).not.toContain("EXEC CICS RETURN");
    expect(result.backendRequirements).toEqual([]);
  });
});

describe("combined SQL and CICS", () => {
  it("reports both backend requirements", () => {
    const result = compile(`${PREAMBLE}\n${SELECT}
cics transaction enquiry(request: Request, row: Row) {
  execute fetchAccount(request.accountId) into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      link "AUDITLOG" commarea row resp linkResp;
    } else {
      audit("MISSING", request.idempotencyKey);
    }
  }
  audit("DONE", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.backendRequirements).toEqual([
      "db2-precompiler",
      "cics-translator",
    ]);
  });
});
