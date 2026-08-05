import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `search sorted` — COBOL `SEARCH ALL`, a binary search.
 *
 * A linear scan of a rate table with a thousand bands reads five hundred rows
 * to find one; bisecting reads ten. COBOL will do it only if the declaration
 * says the table is ordered, and only on equality against that key.
 *
 * The check matters more than a type error usually does. `SEARCH ALL` on a
 * table that is not actually sorted does not fall back to scanning it — it
 * returns the wrong row, or reports no match on a row that is there.
 */

const PREAMBLE = `module Bands;

record Band {
  upper: binary<4>;
  rate: decimal<9, 4>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(table: string, search: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record Book {
${table}
  found: decimal<9, 4>;
  idempotencyKey: string<36>;
}

entry transaction lookup(book: Book) {
${search}
  audit("LOOKED", book.idempotencyKey);
}`);
}

const SORTED_TABLE = "  bands: Band[4] ascending upper;";
const SEARCH = `  search sorted band in book.bands where band.upper == 30 {
    book.found = band.rate;
  } else {
    book.found = 0.0000;
  }`;

describe("a sorted table", () => {
  const result = program(SORTED_TABLE, SEARCH);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /** The promise that lets COBOL bisect, and it comes before INDEXED BY. */
  it("declares its order on the OCCURS", () => {
    expect(result.cobol).toContain("ASCENDING KEY IS UPPER");
    const text = result.cobol ?? "";
    expect(text.indexOf("ASCENDING KEY IS UPPER")).toBeLessThan(
      text.indexOf("INDEXED BY BANDS-IDX"),
    );
  });

  it("becomes SEARCH ALL", () => {
    expect(result.cobol).toContain("SEARCH ALL BANDS OF BOOK");
  });

  /**
   * `SEARCH ALL` bisects, so it sets the index itself. A `SET` before it would
   * be discarded, and writing one would suggest the starting point mattered.
   */
  it("does not set the index first", () => {
    expect(result.cobol).not.toContain("SET BANDS-IDX TO 1");
  });

  it("still requires the not-found branch", () => {
    expect(result.cobol).toContain("AT END");
  });
});

describe("a plain search is unchanged", () => {
  const result = program(
    "  bands: Band[4];",
    `  search band in book.bands where band.upper == 30 {
    book.found = band.rate;
  } else {
    book.found = 0.0000;
  }`,
  );

  it("walks the table", () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("SET BANDS-IDX TO 1");
    expect(result.cobol).toContain("SEARCH BANDS OF BOOK");
    expect(result.cobol).not.toContain("SEARCH ALL");
  });
});

describe("what a sorted search will take", () => {
  /** Bisecting an unsorted table returns a wrong answer, not a slow one. */
  it("needs the table to declare its order", () => {
    expect(ids(program("  bands: Band[4];", SEARCH))).toContain(
      "BANK-TYPE-028",
    );
  });

  /** Any other test has no ordering to cut in half. */
  it("needs equality on the key", () => {
    expect(
      ids(
        program(
          SORTED_TABLE,
          `  search sorted band in book.bands where band.upper > 30 {
    book.found = band.rate;
  } else {
    book.found = 0.0000;
  }`,
        ),
      ),
    ).toContain("BANK-TYPE-028");
  });

  it("needs the key the table is ordered by", () => {
    expect(
      ids(
        program(
          SORTED_TABLE,
          `  search sorted band in book.bands where band.rate == 0.0300 {
    book.found = band.rate;
  } else {
    book.found = 0.0000;
  }`,
        ),
      ),
    ).toContain("BANK-TYPE-028");
  });

  /** `ascending` and `sorted` are contextual, so both stay usable as names. */
  it("does not reserve the clause words", () => {
    const result = compile(`module Bands;

record Book {
  ascending: binary<4>;
  sorted: binary<4>;
  idempotencyKey: string<36>;
}

entry transaction lookup(book: Book) {
  book.ascending = book.sorted;
  audit("LOOKED", book.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });
});

/**
 * A binary search that lands on the wrong row still produces a number, so this
 * one is run: it asks for a band in the middle of the table and checks the rate
 * that comes back is the one that belongs to it.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("finds the row that matches the key", () => {
    const result = program(
      SORTED_TABLE,
      `  book.bands[1].upper = 10;
  book.bands[1].rate = 0.0100;
  book.bands[2].upper = 20;
  book.bands[2].rate = 0.0200;
  book.bands[3].upper = 30;
  book.bands[3].rate = 0.0300;
  book.bands[4].upper = 40;
  book.bands[4].rate = 0.0400;
${SEARCH}
  log "FOUND ", book.found;`,
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-bsearch-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    // Band 30 is the third row; a neighbouring row would give 0.0200 or 0.0400.
    expect(ran.stdout).toContain("0.0300");
  });
});
