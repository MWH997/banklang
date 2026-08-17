import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import {
  bankTsTypeForSql,
  importDclgen,
} from "../packages/copybook/src/dclgen";

/**
 * A DCLGEN member read into a BankTS record.
 *
 * The external audit lists DCLGEN import beside copybook import, on the "same
 * argument". A DCLGEN is Db2's own declarations generator: it writes the
 * `DECLARE ... TABLE` block from the catalogue and a COBOL host structure to
 * match, and shops keep the members in a library. It says two things a copybook
 * cannot: the column's real SQL type, and whether it may be null.
 *
 * The member carries IBM's own COBOL declaration for the same columns, so the
 * import is checked against it rather than against a table somebody typed here.
 */

const MEMBER = resolve(process.cwd(), "tests/inputs/dclgen/ACCOUNT.cpy");

describe("a DCLGEN member", () => {
  const imported = importDclgen(readFileSync(MEMBER, "utf8"));

  it("agrees with the COBOL declaration DCLGEN wrote beside it", () => {
    expect(imported.problems).toEqual([]);
  });

  it("names the table and the record", () => {
    expect(imported.table).toBe("BANKDB.ACCOUNT");
    expect(imported.recordName).toBe("AccountRow");
  });

  it("reads each column as the type Db2 says it is", () => {
    expect(imported.source).toContain("accountId: string<16>;");
    expect(imported.source).toContain("balance: decimal<15, 2>;");
    expect(imported.source).toContain("cycleDay: binary<4>;");
    expect(imported.source).toContain("postingCount: binary<9>;");
  });

  /**
   * The reason this is worth more than a copybook. A column with no `NOT NULL`
   * may hold one, and a program that reads it without checking is what
   * `BANK-TYPE-008` exists to refuse, and a copybook says nothing about it.
   */
  it("carries the nullability the catalogue states", () => {
    expect(imported.source).toContain(
      "overdraftLimit: nullable<decimal<15, 2>>;",
    );
    expect(imported.source).toContain("lastPosted: nullable<timestamp>;");
    expect(imported.source).not.toContain("nullable<string<16>>");
  });

  /**
   * Db2 hands a date to COBOL as a fixed-length character string, not as a
   * number. Reading it as BankTS's `date`, which is `PIC 9(8)`, would be two bytes
   * short and the wrong shape.
   */
  it("reads a DATE the way Db2 passes one", () => {
    expect(imported.source).toContain("openedOn: string<10>;");
  });
});

describe("what an SQL type becomes", () => {
  const cases: [string, string][] = [
    ["SMALLINT", "binary<4>"],
    ["INTEGER", "binary<9>"],
    ["BIGINT", "binary<18>"],
    ["DECIMAL(15, 2)", "decimal<15, 2>"],
    ["NUMERIC(9,0)", "decimal<9, 0>"],
    ["CHAR(16)", "string<16>"],
    ["DATE", "string<10>"],
    ["TIME", "string<8>"],
    ["TIMESTAMP", "timestamp"],
  ];

  for (const [sql, expected] of cases) {
    it(`reads ${sql} as ${expected}`, () => {
      expect(bankTsTypeForSql(sql)).toEqual({ text: expected });
    });
  }
});

describe("what the importer refuses", () => {
  it("a varying-length string, which is a group of two level-49 items", () => {
    expect(bankTsTypeForSql("VARCHAR(200)").problem).toContain("level-49");
  });

  it("floating point, which a bank's arithmetic is not", () => {
    expect(bankTsTypeForSql("DOUBLE").problem).toContain("Floating point");
  });

  it("more digits than the program is compiled for", () => {
    expect(bankTsTypeForSql("DECIMAL(31,2)").problem).toContain(
      "ARITH(COMPAT)",
    );
  });

  /**
   * The check that matters: DCLGEN wrote a picture for the column from the
   * catalogue, and this reads the same column from the SQL type. A
   * disagreement is this compiler being wrong about Db2.
   */
  it("a column whose picture disagrees with DCLGEN's own", () => {
    const imported = importDclgen(`           EXEC SQL DECLARE T TABLE
           ( AMOUNT DECIMAL(15, 2) NOT NULL
           ) END-EXEC.
       01  DCLT.
           10 AMOUNT               PIC S9(9)V9(2) USAGE COMP-3.
`);

    expect(imported.problems[0]!.message).toContain("DCLGEN declares");
  });
});

describe("bankc dclgen import", () => {
  it("writes the record", () => {
    const result = runBankc([
      "dclgen",
      "import",
      "tests/inputs/dclgen/ACCOUNT.cpy",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("record AccountRow {");
  });

  it("refuses a member it cannot read whole", () => {
    const result = runBankc(["dclgen", "import", "runtime/README.md"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});
