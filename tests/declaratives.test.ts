import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `on error <file>` — COBOL's `DECLARATIVES` and `USE AFTER ERROR`.
 *
 * A file status check covers the statement that thought to look. This covers
 * the ones that did not, whatever the operation and wherever it was written,
 * which is what makes it the standard error path rather than a convenience.
 */

const PREAMBLE = `module Decl;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

file accountInput sequential input record Account status inStatus;
file postingOutput sequential output record Account status outStatus;
`;

const BODY = `entry transaction run1(account: Account) {
  open accountInput;
  read accountInput into account;
  close accountInput;

  debit(account.accountId, account.balance);
  credit("CASH", account.balance);
  audit("RAN", account.idempotencyKey);
}`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function withHandlers(handlers: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
${handlers}

${BODY}`);
}

const HANDLER = `on error accountInput {
  log "FILE ERROR ", inStatus;
  returnCode = 12;
}`;

describe("declaratives", () => {
  /**
   * DECLARATIVES come first and are the only thing allowed to precede the
   * program's own paragraphs.
   */
  it("emits a USE procedure before everything else", () => {
    const cobol = withHandlers(HANDLER).cobol ?? "";

    expect(cobol).toContain("DECLARATIVES.");
    expect(cobol).toContain("ACCOUNT-INPUT-ERROR-SECTION SECTION.");
    expect(cobol).toContain(
      "USE AFTER STANDARD ERROR PROCEDURE ON ACCOUNT-INPUT-FILE.",
    );
    expect(cobol).toContain("END DECLARATIVES.");
    expect(cobol.indexOf("DECLARATIVES.")).toBeLessThan(
      cobol.indexOf("BANK-MAIN."),
    );
  });

  /** Everything after DECLARATIVES has to be in a section of its own. */
  it("puts the program's paragraphs in a section", () => {
    const cobol = withHandlers(HANDLER).cobol ?? "";

    expect(cobol).toContain("BANK-BODY SECTION.");
    expect(cobol.indexOf("END DECLARATIVES.")).toBeLessThan(
      cobol.indexOf("BANK-BODY SECTION."),
    );
  });

  it("adds nothing when no file declares a handler", () => {
    const cobol = compile(`${PREAMBLE}\n${BODY}`).cobol ?? "";

    expect(cobol).not.toContain("DECLARATIVES");
    expect(cobol).not.toContain("BANK-BODY SECTION");
  });

  it("handles more than one file", () => {
    const cobol =
      withHandlers(
        `${HANDLER}\n\non error postingOutput {\n  returnCode = 8;\n}`,
      ).cobol ?? "";

    expect(cobol).toContain("ACCOUNT-INPUT-ERROR-SECTION SECTION.");
    expect(cobol).toContain("POSTING-OUTPUT-ERROR-SECTION SECTION.");
  });

  /** The handler sees the file's status, which is what it is there to report. */
  it("can read the file status", () => {
    const result = withHandlers(HANDLER);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'DISPLAY "FILE ERROR " IN-STATUS UPON SYSOUT',
    );
  });

  /** COBOL allows a file in one USE procedure. */
  it("rejects two handlers for one file", () => {
    expect(ids(withHandlers(`${HANDLER}\n\n${HANDLER}`))).toContain(
      "BANK-FILE-005",
    );
  });

  it("rejects a handler for a file that does not exist", () => {
    expect(
      ids(withHandlers("on error nowhere {\n  returnCode = 8;\n}")),
    ).toContain("BANK-TYPE-001");
  });
});
