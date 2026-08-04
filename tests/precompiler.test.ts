import { describe, expect, it } from "vitest";

import { precompile } from "../packages/precompiler/src/index";

describe("precompiler", () => {
  it("expands INCLUDE SQLCA into the SQLCA structure", () => {
    const result = precompile(
      "       WORKING-STORAGE SECTION.\n           EXEC SQL INCLUDE SQLCA END-EXEC.\n",
    );

    expect(result.cobol).toContain("01  SQLCA.");
    expect(result.cobol).toContain("05  SQLCODE       PIC S9(9) COMP-5.");
    expect(result.cobol).not.toContain("INCLUDE SQLCA END-EXEC");
  });

  it("translates a multi-line EXEC SQL block into a runtime call", () => {
    const result = precompile(`           EXEC SQL
               SELECT BALANCE
               INTO :ROW-BAL OF ROW-REC
               FROM ACCOUNT
               WHERE ID = :H1
           END-EXEC
`);

    expect(result.sqlBlocks).toBe(1);
    expect(result.cobol).toContain(
      'CALL "DSNHLI" USING SQLCA, SQL-STMT-NUMBER, ROW-BAL OF ROW-REC, H1',
    );
    // The original statement stays visible for review.
    expect(result.cobol).toContain("*>   SELECT BALANCE");
  });

  /**
   * Db2 passes a descriptor identifying the statement being executed, which is
   * how DSNHLI knows what it was asked to run. Without it the runtime cannot
   * tell one call site from another, and cannot report anything but success.
   */
  it("numbers each SQL statement for the runtime", () => {
    const result = precompile(`       WORKING-STORAGE SECTION.
           EXEC SQL SELECT A INTO :F1 END-EXEC
           EXEC SQL SELECT B INTO :F2 END-EXEC
`);

    expect(result.cobol).toContain("01  SQL-STMT-NUMBER     PIC 9(4).");
    expect(result.cobol).toContain("MOVE 0001 TO SQL-STMT-NUMBER");
    expect(result.cobol).toContain("MOVE 0002 TO SQL-STMT-NUMBER");
  });

  it("passes host variables so the compiler still checks the names", () => {
    const result = precompile(
      "           EXEC SQL SELECT A INTO :FIELD-A OF REC WHERE K = :KEY-1 END-EXEC\n",
    );

    expect(result.cobol).toContain("FIELD-A OF REC");
    expect(result.cobol).toContain("KEY-1");
  });

  it("translates EXEC CICS and keeps its data references", () => {
    const result = precompile(
      '           EXEC CICS LINK PROGRAM("AUDITLOG") COMMAREA(REPLY-REC) RESP(LINK-RESP) END-EXEC\n',
    );

    expect(result.cicsBlocks).toBe(1);
    expect(result.cobol).toContain(
      'CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND, REPLY-REC',
    );
    // The quoted program name is a literal, not a data item.
    expect(result.cobol).not.toContain("AUDITLOG,");
  });

  /**
   * A command does not return its response in an operand. CICS leaves it in
   * EIBRESP and the translator copies it out, which is the only reason a
   * generated program's error branch can be reached at all.
   */
  it("copies EIBRESP into whatever the RESP option named", () => {
    const result = precompile(
      "       WORKING-STORAGE SECTION.\n           EXEC CICS SYNCPOINT RESP(LINK-RESP) END-EXEC\n",
    );

    expect(result.cobol).toContain("05  EIBRESP       PIC S9(8) COMP.");
    expect(result.cobol).toContain("MOVE EIBRESP TO LINK-RESP");
    // The response field is not an operand: CICS never reads it.
    expect(result.cobol).not.toContain("DFHEIV-COMMAND, LINK-RESP");
  });

  it("names the command, which no operand reveals", () => {
    const syncpoint = precompile(
      "           EXEC CICS SYNCPOINT RESP(R1) END-EXEC\n",
    );
    const rollback = precompile(
      "           EXEC CICS SYNCPOINT ROLLBACK RESP(R1) END-EXEC\n",
    );
    const link = precompile(
      '           EXEC CICS LINK PROGRAM("AUDITLOG") RESP(R1) END-EXEC\n',
    );

    expect(syncpoint.cobol).toContain('MOVE "SYNCPOINT" TO DFHEIV-COMMAND');
    expect(rollback.cobol).toContain(
      'MOVE "SYNCPOINT ROLLBACK" TO DFHEIV-COMMAND',
    );
    expect(link.cobol).toContain('MOVE "LINK" TO DFHEIV-COMMAND');
  });

  it("handles a CICS command with no data operands", () => {
    const result = precompile("           EXEC CICS RETURN END-EXEC\n");

    expect(result.cobol).toContain(
      'CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND',
    );
  });

  /**
   * `END-EXEC.` terminates the COBOL sentence. Dropping the period would leave
   * the paragraph without a terminator, which the compiler rejects.
   */
  it("preserves a terminating period", () => {
    const terminated = precompile("           EXEC CICS RETURN END-EXEC.\n");
    const unterminated = precompile("           EXEC CICS RETURN END-EXEC\n");

    expect(terminated.cobol).toContain(
      'CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND.',
    );
    expect(unterminated.cobol).not.toContain(
      'CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND.',
    );
  });

  /**
   * The period has to land on the last statement the block expands into, not on
   * the call, or the `MOVE` that follows it starts an unterminated sentence.
   */
  it("puts the terminating period after the response copy", () => {
    const result = precompile(
      "           EXEC CICS SYNCPOINT RESP(R1) END-EXEC.\n",
    );

    expect(result.cobol).toContain("MOVE EIBRESP TO R1.");
    expect(result.cobol).not.toContain("DFHEIV-COMMAND.");
  });

  it("leaves COBOL without embedded blocks untouched", () => {
    const source = "       MOVE 1 TO WS-A\n       GOBACK.\n";
    const result = precompile(source);

    expect(result.cobol).toBe(source);
    expect(result.sqlBlocks).toBe(0);
    expect(result.cicsBlocks).toBe(0);
  });

  it("counts several blocks in one program", () => {
    const result = precompile(`           EXEC SQL SELECT 1 END-EXEC
           EXEC CICS SYNCPOINT RESP(R1) END-EXEC
           EXEC CICS RETURN END-EXEC
`);

    expect(result.sqlBlocks).toBe(1);
    expect(result.cicsBlocks).toBe(2);
  });

  it("preserves the surrounding indentation", () => {
    const result = precompile(
      "               EXEC CICS SYNCPOINT RESP(R1) END-EXEC\n",
    );

    expect(result.cobol).toContain(
      '               CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND',
    );
  });
});
