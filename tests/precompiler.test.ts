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
      'CALL "DSNHLI" USING SQLCA, ROW-BAL OF ROW-REC, H1',
    );
    // The original statement stays visible for review.
    expect(result.cobol).toContain("*>   SELECT BALANCE");
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
    expect(result.cobol).toContain('CALL "DFHEI1" USING REPLY-REC, LINK-RESP');
    // The quoted program name is a literal, not a data item.
    expect(result.cobol).not.toContain("AUDITLOG,");
  });

  it("handles a CICS command with no data operands", () => {
    const result = precompile("           EXEC CICS RETURN END-EXEC\n");

    expect(result.cobol).toContain('CALL "DFHEI1"');
    expect(result.cobol).not.toContain("USING");
  });

  /**
   * `END-EXEC.` terminates the COBOL sentence. Dropping the period would leave
   * the paragraph without a terminator, which the compiler rejects.
   */
  it("preserves a terminating period", () => {
    const terminated = precompile("           EXEC CICS RETURN END-EXEC.\n");
    const unterminated = precompile("           EXEC CICS RETURN END-EXEC\n");

    expect(terminated.cobol).toContain('CALL "DFHEI1".');
    expect(unterminated.cobol).not.toContain('CALL "DFHEI1".');
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

    expect(result.cobol).toContain('               CALL "DFHEI1" USING R1');
  });
});
