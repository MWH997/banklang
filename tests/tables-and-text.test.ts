import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * `INSPECT`, `UNSTRING`, and `SEARCH` — the three the string and table work
 * left out.
 *
 * Each does something a program could only fake before: counting or replacing
 * characters without a loop, taking a composite key apart, and finding a row
 * without walking the whole table and forgetting the not-found case.
 */

const PREAMBLE = `module Text;

record Entry {
  entryKind: string<6>;
  amount: decimal<18, 2>;
}

record Statement1 {
  lines: Entry[100];
  narrative: string<60>;
  reference: string<16>;
  branch: string<8>;
  found: string<6>;
  commas: decimal<9, 0>;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction inspect1(st: Statement1) {
${body}
  audit("INSPECTED", st.idempotencyKey);
}`);
}

describe("INSPECT", () => {
  it("counts occurrences without a loop", () => {
    const result = txn('  st.commas = countOf(st.narrative, ",");');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE 0 TO COMMAS OF STATEMENT1");
    expect(flowed(result.cobol)).toContain(
      flowed(
        'INSPECT NARRATIVE OF STATEMENT1 TALLYING COMMAS OF STATEMENT1 FOR ALL ","',
      ),
    );
  });

  it("converts characters in place", () => {
    const result = txn('  st.branch = replaceChars(st.branch, " ", "0");');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'INSPECT BRANCH OF STATEMENT1 CONVERTING " " TO "0"',
    );
  });

  /**
   * `INSPECT CONVERTING` maps character to character, so the two sets have to
   * be the same size. Anything else is a substitution, which COBOL has no
   * single statement for.
   */
  it("rejects a conversion between different-sized sets", () => {
    const result = txn('  st.branch = replaceChars(st.branch, " ", "00");');

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("UNSTRING", () => {
  it("takes a composite key apart at a delimiter", () => {
    const result = txn('  split st.reference by "-" into st.branch, st.found;');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'UNSTRING REFERENCE-FLD OF STATEMENT1 DELIMITED BY "-"',
    );
    expect(result.cobol).toContain(
      "INTO BRANCH OF STATEMENT1 FOUND OF STATEMENT1",
    );
  });

  it("writes strings, not numbers", () => {
    const result = txn('  split st.reference by "-" into st.commas;');

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  /**
   * UNSTRING stops "when all the characters in the sending field have been
   * transferred", so a receiver it never reaches keeps what it already held.
   * Nothing in the statement clears one. In a read loop that value belongs to
   * a record already processed: split `AAA-BBB-CCC` and then `XXX-YYY` into
   * three fields, and the third still reads CCC.
   */
  it("clears the receivers, so a short value leaves none of the last one", () => {
    const result = txn('  split st.reference by "-" into st.branch, st.found;');

    expect(result.diagnostics).toEqual([]);
    const text = flowed(result.cobol);
    expect(text).toContain(
      flowed("MOVE SPACES TO BRANCH OF STATEMENT1 FOUND OF STATEMENT1"),
    );
    expect(text.indexOf("MOVE SPACES TO BRANCH")).toBeLessThan(
      text.indexOf("UNSTRING"),
    );
  });
});

describe("SEARCH", () => {
  /**
   * COBOL's SEARCH walks an index rather than a subscript, so every OCCURS
   * carries one. It costs nothing when nothing searches the table.
   */
  it("declares an index on the table", () => {
    expect(txn("").cobol).toContain("INDEXED BY LINES-FLD-IDX.");
  });

  /**
   * The index is set to 1 first: SEARCH begins wherever it happens to be
   * pointing, and a stale one silently skips the front of the table.
   */
  it("resets the index, then searches", () => {
    const result =
      txn(`  search row in st.lines where row.entryKind == "DEBIT" {
    st.found = row.entryKind;
  } else {
    st.found = "NONE";
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("SET LINES-FLD-IDX TO 1");
    expect(result.cobol).toContain("SEARCH LINES-FLD OF STATEMENT1");
  });

  /** The element name stands for the entry the index is pointing at. */
  it("binds the element to the subscripted entry", () => {
    const result =
      txn(`  search row in st.lines where row.entryKind == "DEBIT" {
    st.found = row.entryKind;
  } else {
    st.found = "NONE";
  }`);

    expect(flowed(result.cobol)).toContain(
      flowed(
        'WHEN ENTRY-KIND OF LINES-FLD OF STATEMENT1 (LINES-FLD-IDX) = "DEBIT"',
      ),
    );
  });

  /**
   * `AT END` comes before the `WHEN`, which is the order COBOL requires and
   * also the order that makes the not-found case impossible to leave out.
   */
  it("emits AT END before the match", () => {
    const cobol =
      txn(`  search row in st.lines where row.entryKind == "DEBIT" {
    st.found = row.entryKind;
  } else {
    st.found = "NONE";
  }`).cobol ?? "";

    expect(cobol.indexOf("AT END")).toBeLessThan(cobol.indexOf("WHEN "));
    expect(cobol).toContain("END-SEARCH");
  });

  it("requires the not-found branch", () => {
    const result =
      txn(`  search row in st.lines where row.entryKind == "DEBIT" {
    st.found = row.entryKind;
  }`);

    expect(ids(result)).toContain("BANK-SYN-001");
  });

  it("searches a table, not a scalar", () => {
    const result =
      txn(`  search row in st.narrative where row.entryKind == "DEBIT" {
    st.found = "X";
  } else {
    st.found = "NONE";
  }`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("requires a bool condition", () => {
    const result = txn(`  search row in st.lines where row.entryKind {
    st.found = "X";
  } else {
    st.found = "NONE";
  }`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});
