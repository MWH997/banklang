import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * Writing into a table, and tables of tables.
 *
 * An element of a scalar table could not be assigned to at all: `rates[1] = x`
 * was "not an assignable target", so a table could be declared and read but
 * never filled, which is not a table worth having, since a rate matrix loaded
 * from a file is written a cell at a time.
 *
 * A table of tables is nested `OCCURS`, and COBOL puts every subscript on the
 * innermost data name (`RATES-ITEM (I, J)`, not `RATES (I) (J)`) so the inner
 * dimension needs a name of its own even though nothing in the source names it.
 */

const PREAMBLE = `module Rates;
`;

function program(record: string, body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record Book {
${record}
  idempotencyKey: string<36>;
}

entry transaction load(book: Book) {
${body}
  audit("LOADED", book.idempotencyKey);
}`);
}

describe("writing into a table", () => {
  it("assigns an element of a scalar table", () => {
    const result = program(
      "  rates: decimal<9, 4>[4];",
      "  book.rates[1] = 0.0500;",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE 0.0500 TO RATES OF BOOK (1)");
  });

  it("still assigns a field of an element", () => {
    const result = compile(`${PREAMBLE}
record Row {
  rate: decimal<9, 4>;
}

record Book {
  rows: Row[4];
  idempotencyKey: string<36>;
}

entry transaction load(book: Book) {
  book.rows[2].rate = 0.0600;
  audit("LOADED", book.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Every shape a value can be written into, in one place.
   *
   * The scalar-element case was missing for as long as tables existed, and
   * nothing noticed because the two neighbouring shapes, a local and a field
   * of an element, both worked. A list is how that stays fixed.
   */
  it("accepts every place a value can go", () => {
    const result = compile(`module Places;

record Row {
  rate: decimal<9, 4>;
}

record Book {
  single: decimal<9, 4>;
  flat: decimal<9, 4>[4];
  grid: decimal<9, 4>[2][3];
  rows: Row[4];
  idempotencyKey: string<36>;
}

entry transaction load(book: Book) {
  let local: decimal<9, 4> = 0.0000;
  local = 0.0100;
  book.single = 0.0200;
  book.flat[1] = 0.0300;
  book.grid[2][3] = 0.0400;
  book.rows[2].rate = 0.0500;
  audit("LOADED", book.idempotencyKey);
}`);

    expect(
      result.diagnostics.map((entry) => `${entry.id}: ${entry.message}`),
    ).toEqual([]);
  });

  it("still refuses something that is not a place", () => {
    expect(
      program("  rates: decimal<9, 4>[4];", "  1 + 1 = 2;").diagnostics.map(
        (entry) => entry.id,
      ),
    ).toContain("BANK-SYN-002");
  });
});

describe("a table of tables", () => {
  const result = program(
    "  rates: decimal<9, 4>[3][4];",
    `  book.rates[1][1] = 0.0500;
  book.rates[3][4] = 0.0725;`,
  );

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Three rows of four. Reading left to right, the first bound is the outer
   * `OCCURS`, and wrapping as each bracket is consumed would nest them the other
   * way round and silently transpose the table.
   */
  it("nests the OCCURS outermost-first", () => {
    const text = result.cobol ?? "";
    const outer = text.indexOf("OCCURS 3 TIMES");
    const inner = text.indexOf("OCCURS 4 TIMES");

    expect(outer).toBeGreaterThan(-1);
    expect(inner).toBeGreaterThan(outer);
  });

  /** COBOL subscripts the innermost name with every dimension at once. */
  it("puts both subscripts on the inner name", () => {
    expect(result.cobol).toContain("RATES-ITEM OF BOOK (1, 1)");
    expect(result.cobol).toContain("RATES-ITEM OF BOOK (3, 4)");
    expect(result.cobol).not.toContain("(1) (1)");
  });

  it("indexes each dimension", () => {
    expect(result.cobol).toContain("INDEXED BY RATES-IDX");
    expect(result.cobol).toContain("INDEXED BY RATES-ITEM-IDX");
  });

  it("counts the storage of every cell", () => {
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "Book",
    );
    const cells = report?.entries.find((entry) => entry.path.endsWith("RATES"));

    // Three rows of four cells, each a five-byte packed decimal.
    expect(cells?.length).toBe(3 * 4 * 5);
  });
});

/** The layout is the claim, so the cell that comes back has to be the one written. */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("reads back the cell it wrote", () => {
    const result = program(
      "  rates: decimal<9, 4>[3][4];",
      `  book.rates[1][1] = 0.0500;
  book.rates[3][4] = 0.0725;
  log "FIRST ", book.rates[1][1];
  log "LAST ", book.rates[3][4];`,
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-tables-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );

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

    // Two cells at opposite corners: if the dimensions were transposed, or the
    // subscripts written separately, these would collide or read as zero.
    expect(ran.stdout).toContain("0.0500");
    expect(ran.stdout).toContain("0.0725");
  });
});
