import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { flowed } from "./helpers";

/**
 * The commarea a CICS transaction is passed, and the check that it is there.
 *
 * Three defects lived here together, and every test passed while they did.
 *
 * The transaction's first record parameter is working storage, and **nothing
 * moved the commarea into it** — the program read uninitialised bytes for its
 * input. Nothing moved it back either, so a caller expecting updated data got
 * whatever it sent. And there was no `EIBCALEN` test, so a call with no
 * commarea would have addressed storage belonging to something else, which is a
 * violation rather than an empty record.
 *
 * None of it failed locally because the reference CICS runtime passes no
 * commarea and the conformance assertions were about which branch ran.
 */

const SOURCE = `module Enquiry;

record Request {
  accountId: string<16>;
  idempotencyKey: string<36>;
}

cics transaction enquire(request: Request) {
  audit("ENQUIRED", request.idempotencyKey);
}`;

describe("a CICS transaction", () => {
  const result = compile(SOURCE);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * IBM's guidance is to test `EIBCALEN` first, always. A commarea that was not
   * passed is not an empty record: `DFHCOMMAREA` addresses whatever is there.
   *
   * And the rule is not "was one passed" but that the program verifies the
   * length "matches what the program expects", because a discrepancy risks a
   * storage violation. A caller passing ten bytes to a program whose record is
   * seventy-two leaves the MOVE reading sixty-two bytes of whatever follows the
   * commarea — somebody else's storage, read clean. Testing against the length
   * of the record covers the short commarea and the absent one together.
   */
  it("tests EIBCALEN before touching the commarea", () => {
    const text = result.cobol ?? "";

    expect(text).toContain("IF EIBCALEN < LENGTH OF DFHCOMMAREA");
    expect(text.indexOf("IF EIBCALEN < LENGTH OF DFHCOMMAREA")).toBeLessThan(
      text.indexOf("MOVE DFHCOMMAREA TO"),
    );
  });

  /**
   * No commarea where one is required is a broken contract, not an empty
   * request. Returning quietly would make it look like the transaction ran.
   */
  it("abends rather than continuing without one", () => {
    expect(result.cobol).toContain('EXEC CICS ABEND ABCODE("BKNC")');
  });

  it("reads the commarea into the record it was declared as", () => {
    expect(result.cobol).toContain("MOVE DFHCOMMAREA TO REQUEST");
  });

  /**
   * DFHCOMMAREA is the caller's own storage, so whatever the transaction
   * changed is what the caller expects to see when it gets control back.
   */
  it("writes the record back before returning", () => {
    const text = result.cobol ?? "";
    const body = text.slice(
      text.indexOf("\n       ENQUIRE.\n"),
      text.indexOf("\n       ENQUIRE-EXIT.\n"),
    );

    // The write-back is the last thing the transaction does. `EXEC CICS RETURN`
    // is `BANK-MAIN`'s, after the PERFORM, because `BANK-MAIN` is the only
    // paragraph that ends the program — so the two are ordered by control flow
    // rather than by which line of the file they sit on.
    expect(body).toContain("MOVE REQUEST TO DFHCOMMAREA");
    expect(text.indexOf("PERFORM ENQUIRE THRU ENQUIRE-EXIT")).toBeLessThan(
      text.indexOf("EXEC CICS RETURN"),
    );
  });

  it("leaves a non-CICS transaction alone", () => {
    const batch = compile(`module Batch;

record Request {
  accountId: string<16>;
  idempotencyKey: string<36>;
}

entry transaction run(request: Request) {
  audit("RAN", request.idempotencyKey);
}`);

    expect(batch.cobol).not.toContain("EIBCALEN");
    expect(batch.cobol).not.toContain("DFHCOMMAREA");
  });
});

/**
 * The translator supplies the EIB, and the reference CICS runtime writes into
 * it through a LINKAGE description of the same storage. The two have to agree
 * field for field: `EIBRESP` at the wrong offset means the runtime writes into
 * some other field and the program reads a response it was never given.
 *
 * That is not hypothetical. Growing the EIB to add `EIBCALEN` without growing
 * the runtime's copy made every CICS response read as zero, so a command that
 * failed looked like one that worked.
 */
describe("the EXEC interface block", () => {
  const { cobol } = precompile(compile(SOURCE).cobol ?? "");

  it("carries the fields a program reads", () => {
    expect(cobol).toContain("05  EIBCALEN");
    expect(cobol).toContain("05  EIBRESP ");
    expect(cobol).toContain("05  EIBRESP2");
    expect(cobol).toContain("05  EIBTRNID");
  });

  /**
   * Nothing local passes a commarea, so a zero here would abend every generated
   * CICS program on its own guard and no branch beyond it would run. The guard
   * is asserted against the generated source instead; on z/OS, CICS sets this.
   */
  it("presets EIBCALEN, because the block is simulated", () => {
    expect(cobol).toContain("EIBCALEN      PIC S9(4) COMP VALUE 9999.");
  });

  /** CICS establishes addressability before the program runs. Nothing here does. */
  it("points the commarea at storage the translator owns", () => {
    expect(cobol).toContain("01  DFHCOMMAREA-SIM");
    expect(cobol).toContain(
      "SET ADDRESS OF DFHCOMMAREA TO ADDRESS OF DFHCOMMAREA-SIM",
    );
  });

  /** A statement before the first paragraph label is not COBOL. */
  it("establishes it inside the first paragraph", () => {
    const division = cobol.indexOf("PROCEDURE DIVISION");
    const set = cobol.indexOf("SET ADDRESS OF DFHCOMMAREA");
    const label = cobol.indexOf("BANK-MAIN.");

    expect(label).toBeGreaterThan(division);
    expect(set).toBeGreaterThan(label);
  });
});

/**
 * Host variables must be declared in an SQL declare section. The markers are
 * not statements — Db2 removes them — so translating one into a call would put
 * an executable statement in the DATA DIVISION, where none may appear.
 */
describe("the SQL declare section", () => {
  const SQL_SOURCE = `module Enquiry;

record Row {
  rowAccountId: string<16>;
}

sql fetchAccount(wanted: string<16>): Row {
  SELECT ACCOUNT_ID INTO :rowAccountId FROM ACCOUNT WHERE ACCOUNT_ID = :wanted
}

entry transaction enquire(row: Row, idempotencyKey: string<36>) {
  execute fetchAccount(row.rowAccountId) into row;
  if sqlcode == 0 {
    audit("FOUND", idempotencyKey);
  } else {
    audit("MISSING", idempotencyKey);
  }
}`;

  it("surrounds the host variables", () => {
    const cobol = compile(SQL_SOURCE).cobol ?? "";

    expect(cobol).toContain("EXEC SQL BEGIN DECLARE SECTION END-EXEC.");
    expect(cobol).toContain("EXEC SQL END DECLARE SECTION END-EXEC.");
    expect(cobol.indexOf("BEGIN DECLARE SECTION")).toBeLessThan(
      cobol.indexOf("END DECLARE SECTION"),
    );
  });

  /** The SQLCA is not a host variable, and a declare section may not hold one. */
  it("leaves the SQLCA outside it", () => {
    const cobol = compile(SQL_SOURCE).cobol ?? "";

    expect(cobol.indexOf("INCLUDE SQLCA")).toBeLessThan(
      cobol.indexOf("BEGIN DECLARE SECTION"),
    );
  });

  it("is removed by the precompiler rather than translated", () => {
    const { cobol } = precompile(compile(SQL_SOURCE).cobol ?? "");

    expect(cobol).not.toContain("BEGIN DECLARE SECTION END-EXEC");
    expect(cobol).toContain("Declare section marker read by");
  });
});

/**
 * An `OPEN` that failed is not recoverable by carrying on: every read
 * afterwards fails too, and a batch that ignores it writes an empty output file
 * and returns zero — which looks exactly like a run that had nothing to do.
 *
 * The language already requires a file to declare a status field
 * (`BANK-FILE-001`) and then never tested it. Convention is to check after
 * every I/O and, for an `OPEN`, to abort.
 */
describe("opening a file", () => {
  const result = compile(`module Batch;

record Row {
  accountId: string<16>;
}

file feed sequential input record Row status feedStatus;

entry transaction run(row: Row, idempotencyKey: string<36>) {
  open feed;
  close feed;
  audit("RAN", idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("tests the status the file declared", () => {
    expect(result.cobol).toContain('IF FEED-STATUS(1:1) NOT = "0"');
  });

  /** Named, because a job log saying only "open failed" starts an investigation. */
  it("says which file and what the status was", () => {
    expect(flowed(result.cobol)).toContain(
      flowed('DISPLAY "OPEN FAILED feed STATUS " FEED-STATUS UPON SYSOUT'),
    );
  });

  /**
   * A zero return code on a failed open is what makes it invisible to the job.
   *
   * Leaving is a `GO TO` at the enclosing routine's exit rather than a `GOBACK`
   * written where the failure was found: the `GOBACK` sat inside a range the
   * caller had performed, so which paragraph a failure ended in decided whether
   * the transaction's `on failure` handler ran at all.
   */
  it("stops with a non-zero return code", () => {
    const text = result.cobol ?? "";
    const check = text.indexOf('IF FEED-STATUS(1:1) NOT = "0"');

    expect(text.slice(check)).toContain("MOVE 12 TO BANK-RETURN-CODE");
    expect(text.slice(check)).toMatch(/GO TO \S+-EXIT/);
  });
});

/**
 * The short commarea, which is the case the first version of this guard missed.
 *
 * `EIBCALEN = 0` catches a caller that passed nothing. It does not catch one
 * that passed less than the program expects, and that is the case IBM warns
 * produces a storage violation: the MOVE reads the whole record's length out of
 * an area that is shorter, and what it finds past the end belongs to something
 * else. Testing against the length of the record covers both.
 */
describe("a commarea shorter than the record", () => {
  it("is refused by the same guard that refuses an absent one", () => {
    const cobol =
      compile(`module Enquiry;

record Request {
  accountId: string<16>;
  idempotencyKey: string<36>;
}

cics transaction enquire(request: Request) {
  audit("ENQUIRED", request.idempotencyKey);
}`).cobol ?? "";

    // Against the record's own length rather than a number written here: the
    // record is what says how much storage the MOVE is going to read.
    expect(cobol).toContain("IF EIBCALEN < LENGTH OF DFHCOMMAREA");
    expect(cobol).not.toContain("IF EIBCALEN = 0");
  });
});
