import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * `xml <text> processing { element "ID" into account.id; }` — `XML PARSE`.
 *
 * COBOL's XML reader is event-driven: it calls a procedure once per token of
 * the document — a start tag, its content, an end tag — and the procedure works
 * out what to keep by reading the `XML-EVENT` and `XML-TEXT` special registers.
 * There is no form that fills a record, in Enterprise COBOL or in GnuCOBOL.
 *
 * Writing that state machine by hand is where an XML reader goes wrong: forget
 * to clear the remembered element at the end tag and a parent's whitespace is
 * filed under the child that just closed. So the bindings are declared and the
 * compiler writes the machine.
 */

const PREAMBLE = `module Ingest;

record Account {
  accountId: string<8>;
  balance: decimal<9, 2>;
  idempotencyKey: string<36>;
}

record Message {
  body: string<200>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/** Every xml parse warns, so the interesting question is what else it said. */
function errors(result: {
  diagnostics: { id: string; severity: string }[];
}): string[] {
  return result.diagnostics
    .filter((entry) => entry.severity !== "warning")
    .map((entry) => entry.id);
}

function program(bindings: string, tail = ""): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction ingest(account: Account, message: Message) {
  xml message.body processing {
${bindings}
  }${tail};
  audit("INGESTED", account.idempotencyKey);
}`);
}

const BINDINGS = `    element "ID" into account.accountId;
    element "BAL" into account.balance;`;

describe("the statement", () => {
  const result = program(BINDINGS);

  it("compiles", () => {
    expect(errors(result)).toEqual([]);
  });

  it("names a processing procedure", () => {
    expect(result.cobol).toContain("XML PARSE BODY OF MESSAGE-FLD");
    expect(result.cobol).toContain("PROCESSING PROCEDURE BANK-XML-1");
    expect(result.cobol).toContain("END-XML");
  });

  it("takes a failure handler", () => {
    const handled = program(
      BINDINGS,
      ` on error {
    returnCode = 12;
  }`,
    );

    expect(errors(handled)).toEqual([]);
    expect(handled.cobol).toContain("ON EXCEPTION");
    expect(handled.cobol).toContain("MOVE 12 TO BANK-RETURN-CODE");
  });

  /** The handler is ordinary code, so the banking checks have to see into it. */
  it("has a failure handler the analyzer can see into", () => {
    const result = program(
      BINDINGS,
      ` on error {
    debit("SUSPENSE", 1.00);
  }`,
    );

    expect(ids(result)).toContain("BANK-LED-001");
  });
});

describe("the generated handler", () => {
  const result = program(BINDINGS);

  /**
   * A section, and placed after the last `GOBACK`: one in the flow of control
   * would be run again on the way past. `XML PARSE` enters it and nothing else
   * does.
   */
  it("is a section outside the flow of control", () => {
    const text = result.cobol ?? "";

    expect(text).toContain("BANK-XML-1 SECTION.");
    expect(text.indexOf("GOBACK.")).toBeLessThan(
      text.indexOf("BANK-XML-1 SECTION."),
    );
  });

  /** The content arrives after the start tag, so the name has to be kept. */
  it("remembers the element a start tag opened", () => {
    expect(result.cobol).toContain("EVALUATE XML-EVENT");
    expect(result.cobol).toContain('WHEN "START-OF-ELEMENT"');
    expect(result.cobol).toContain("MOVE XML-TEXT TO BANK-XML-1-ELEM");
    expect(result.cobol).toContain("01  BANK-XML-1-ELEM      PIC X(30).");
  });

  /**
   * And forgets it at the end tag. Without this, content belonging to a parent
   * is filed under the child that just closed — the defect a hand-written
   * handler usually has.
   */
  it("forgets it at the end tag", () => {
    expect(result.cobol).toContain('WHEN "END-OF-ELEMENT"');
    expect(result.cobol).toContain("MOVE SPACES TO BANK-XML-1-ELEM");
  });

  it("moves text straight into an alphanumeric field", () => {
    expect(result.cobol).toContain(
      "MOVE BANK-XML-1-BUF TO ACCOUNT-ID OF ACCOUNT",
    );
  });

  /**
   * A number cannot be moved from characters: `MOVE` would read the digits
   * positionally against the picture and put the decimal point in the wrong
   * place. `NUMVAL` reads them as a number.
   */
  it("converts text into a number", () => {
    expect(flowed(result.cobol)).toContain(
      flowed("COMPUTE BALANCE OF ACCOUNT = FUNCTION NUMVAL(BANK-XML-1-BUF)"),
    );
  });

  /** Two statements need two handlers, or they would share one element register. */
  it("gets its own name per statement", () => {
    const twice = compile(`${PREAMBLE}
entry transaction ingest(account: Account, message: Message) {
  xml message.body processing {
    element "ID" into account.accountId;
  };
  xml message.body processing {
    element "BAL" into account.balance;
  };
  audit("INGESTED", account.idempotencyKey);
}`);

    expect(twice.cobol).toContain("BANK-XML-1 SECTION.");
    expect(twice.cobol).toContain("BANK-XML-2 SECTION.");
    expect(twice.cobol).toContain("PROCESSING PROCEDURE BANK-XML-2");
  });
});

describe("what it will take", () => {
  it("parses text", () => {
    expect(
      errors(program('    element "ID" into account.balance;')),
    ).not.toContain("BANK-TYPE-003");
    expect(
      errors(
        compile(`${PREAMBLE}
entry transaction ingest(account: Account, message: Message) {
  xml account.balance processing {
    element "ID" into account.accountId;
  };
  audit("INGESTED", account.idempotencyKey);
}`),
      ),
    ).toContain("BANK-TYPE-003");
  });

  /** A statement that binds nothing reads nothing, which is never meant. */
  it("binds at least one element", () => {
    expect(errors(program(""))).toContain("BANK-TYPE-026");
  });

  /** One element goes to one field; the second binding would never be reached. */
  it("rejects an element bound twice", () => {
    expect(
      errors(
        program(`    element "ID" into account.accountId;
    element "ID" into account.balance;`),
      ),
    ).toContain("BANK-TYPE-026");
  });

  /** COBOL hands the content over as characters. */
  it("reads into something text can go into", () => {
    const result = compile(`${PREAMBLE}
record Flags {
  active: bool;
}

entry transaction ingest(account: Account, message: Message, flags: Flags) {
  xml message.body processing {
    element "ACTIVE" into flags.active;
  };
  audit("INGESTED", account.idempotencyKey);
}`);

    expect(errors(result)).toContain("BANK-TYPE-026");
  });
});

/**
 * GnuCOBOL compiles `XML PARSE` and its special registers, warns that it is not
 * implemented, and then does nothing — no field is filled, and neither the
 * exception nor the not-exception branch is taken, so a document that failed
 * looks exactly like one that worked.
 *
 * The precompiler now rewrites the statement into a loop over `BANKXML`, so the
 * local build enters the handler and fills the fields
 * (`tests/parse-shims.test.ts` runs one). The warning stays, because that stub
 * is a scan and IBM's parser is not.
 */
describe("it cannot be checked locally", () => {
  it("warns on every statement", () => {
    const warning = program(BINDINGS).diagnostics.find(
      (entry) => entry.id === "BANK-TYPE-025",
    );

    expect(warning?.severity).toBe("warning");
    // The precompiler drives the handler from BANKXML, so the local build does
    // enter it. What the warning is about is the distance between that scan and
    // what IBM's parser reports.
    expect(warning?.hint).toContain("BANKXML");
    expect(warning?.hint).toContain("not IBM's parser");
  });

  /**
   * What can be checked is that the COBOL is accepted, which is not nothing:
   * the handler is a section in the right place, the registers are the ones
   * COBOL defines, and the conversions are legal.
   */
  it("still produces COBOL a compiler accepts", () => {
    const available =
      spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
    if (!available) {
      return;
    }

    const result = program(BINDINGS);
    const dir = mkdtempSync(join(tmpdir(), "bankc-xmlparse-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");

    const built = spawnSync(
      "cobc",
      ["-fsyntax-only", "-fixed", "program.cbl"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );

    expect(built.status, built.stderr).toBe(0);
    expect(built.stderr).not.toContain("error:");
    // The only thing it should say is that it will not run it.
    expect(built.stderr).toContain("XML PARSE is not implemented");
  });
});

/**
 * Character content that arrives in pieces.
 *
 * IBM is explicit that "splits in character content might occur at arbitrary
 * points in the XML data stream, even with unsegmented input", and that the
 * register signalling it "may be required for any and all attribute values and
 * element character content". So this is not an edge case for large documents —
 * it is the ordinary behaviour of the parser.
 *
 * Moving each fragment straight to its field keeps the last one and loses the
 * rest, which is a short but entirely plausible value: an account id of
 * "ACC-000000000042" arriving in two pieces lands as "0042" and nothing
 * reports it.
 *
 * XML-INFORMATION is 2 while the content continues into a later event and 1 on
 * the final piece, so the field is assigned only once the value is whole.
 */
describe("content split across events", () => {
  const cobol = program(BINDINGS).cobol ?? "";

  it("accumulates the fragments rather than overwriting", () => {
    expect(cobol).toContain(
      "STRING XML-TEXT DELIMITED BY SIZE INTO BANK-XML-1-BUF",
    );
    expect(cobol).toContain("WITH POINTER BANK-XML-1-PTR");
  });

  it("assigns the field only when the parser says the value is complete", () => {
    expect(cobol).toContain("IF XML-INFORMATION NOT = 2");
    expect(cobol.indexOf("IF XML-INFORMATION NOT = 2")).toBeLessThan(
      cobol.indexOf("MOVE BANK-XML-1-BUF TO ACCOUNT-ID OF ACCOUNT"),
    );
  });

  /** A new element starts a new value, with nothing of the last left to join. */
  it("resets the buffer at the start of each element", () => {
    const start = cobol.indexOf('WHEN "START-OF-ELEMENT"');
    const content = cobol.indexOf('WHEN "CONTENT-CHARACTERS"');
    const between = cobol.slice(start, content);

    expect(between).toContain("MOVE SPACES TO BANK-XML-1-BUF");
    expect(between).toContain("MOVE 1 TO BANK-XML-1-PTR");
  });

  /**
   * Where the register is not set at all the test is simply never 2, so each
   * append is followed by an assignment — which still ends up holding
   * everything that was appended.
   */
  it("declares the buffer well past any field that can receive one", () => {
    expect(cobol).toContain("01  BANK-XML-1-BUF       PIC X(4096).");
  });
});
