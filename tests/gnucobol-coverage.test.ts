import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";

/**
 * Every construct the language has, compiled under GnuCOBOL.
 *
 * The emitted COBOL is meant to work on Enterprise COBOL *and* GnuCOBOL, and
 * until this existed that was an assumption rather than a check: the validator
 * defaulted to one example, and per-construct coverage was whatever individual
 * tests happened to invoke `cobc` for. A `varying` whose length field sat inside
 * its own record emitted COBOL neither compiler accepts, and nothing noticed.
 *
 * Three constructs compile under GnuCOBOL and do not behave the same there.
 * They are listed by name below rather than skipped silently, so the list is
 * the inventory of where the two targets genuinely diverge.
 */

const R = `record Row {
  rowId: string<16>;
  amount: decimal<15, 2>;
  idempotencyKey: string<36>;
}`;

const cases: [string, string][] = [
  [
    "plain",
    `module M;\n${R}\nentry transaction t(row: Row) { audit("A", row.idempotencyKey); }`,
  ],
  [
    "files",
    `module M;\n${R}\nfile f sequential input record Row status fs;\nentry transaction t(row: Row) { open f; read f into row; close f; audit("A", row.idempotencyKey); }`,
  ],
  [
    "indexed",
    `module M;\n${R}\nfile f indexed update record Row key rowId status fs;\nentry transaction t(row: Row) { open f; read f into row key "K"; rewrite f from row; close f; audit("A", row.idempotencyKey); }`,
  ],
  [
    "sort",
    `module M;\n${R}\nfile a sequential input record Row status as1;\nfile b sequential output record Row status bs;\nentry transaction t(row: Row) { sort a into b on rowId; audit("A", row.idempotencyKey); }`,
  ],
  [
    "sortproc",
    `module M;\n${R}\nfile a sequential input record Row status as1;\nfile b sequential output record Row status bs;\nentry transaction t(row: Row) { sort a into b on rowId input row { release row; } output row { write b from row; }; audit("A", row.idempotencyKey); }`,
  ],
  [
    "restart",
    `module M;\nrecord P { jobName: string<8>; last: string<16>; }\n${R}\nfile r indexed update record P key jobName status rs;\nentry transaction t(row: Row, p: P) { open r; p.jobName = "J"; restart r into p { log "R"; } else { log "F"; } checkpoint r from p every 10; close r; audit("A", row.idempotencyKey); }`,
  ],
  [
    "national",
    `module M;\nrecord N { nm: national<8>; idempotencyKey: string<36>; }\nentry transaction t(n: N) { audit("A", n.idempotencyKey); }`,
  ],
  [
    "sync",
    `module M;\nrecord S { a: string<1>; b: binary<9> sync; idempotencyKey: string<36>; }\nentry transaction t(s: S) { audit("A", s.idempotencyKey); }`,
  ],
  [
    "table",
    `module M;\nrecord B { u: decimal<9,0>; r: decimal<9,4>; }\nrecord T { bands: B[4] ascending u; found: decimal<9,4>; idempotencyKey: string<36>; }\nentry transaction t(t1: T) { search sorted band in t1.bands where band.u == 10 { t1.found = band.r; } else { t1.found = 0.0000; } audit("A", t1.idempotencyKey); }`,
  ],
  [
    "json-gen",
    `module M;\n${R}\nentry transaction t(row: Row, doc: string<200>) { json doc from row; audit("A", row.idempotencyKey); }`,
  ],
  [
    "json-parse",
    `module M;\n${R}\nentry transaction t(row: Row, doc: string<200>) { json doc into row; audit("A", row.idempotencyKey); }`,
  ],
  [
    "xml-parse",
    `module M;\n${R}\nentry transaction t(row: Row, doc: string<200>) { xml doc processing { element "ID" into row.rowId; }; audit("A", row.idempotencyKey); }`,
  ],
  [
    "dyncall",
    `module M;\n${R}\nentry transaction t(row: Row, m: string<8>) { call m using row on error { log "E"; }; cancel m; audit("A", row.idempotencyKey); }`,
  ],
  [
    "nested",
    `module M;\n${R}\nnested function f(x: decimal<15,2>): decimal<15,2> { return x + 1.00; }\nentry transaction t(row: Row) { row.amount = f(row.amount); audit("A", row.idempotencyKey); }`,
  ],
  [
    "varying",
    `module M;\nrecord V { text: string<80>; }\nfile f sequential output record V varying 1 to 80 length vlen status fs;\nentry transaction t(v: V, idempotencyKey: string<36>) { open f; vlen = 5; write f from v; close f; audit("A", idempotencyKey); }`,
  ],
  [
    "dli",
    `module M;\nrecord Seg { sid: string<10>; }\ndatabase db pcb segment "SEG" key "SID" record Seg status ds;\nentry transaction t(s: Seg, idempotencyKey: string<36>) { getHoldUnique db into s key "X"; replaceSegment db from s; audit("A", idempotencyKey); }`,
  ],
  [
    "intrinsics",
    `module M;\nrecord Q { rate: decimal<9,6>; n: decimal<9,0>; pay: decimal<15,2>; idempotencyKey: string<36>; }\nentry transaction t(q: Q) { q.pay = round(1000.00 * annuity(q.rate, q.n), "HALF_UP"); audit("A", q.idempotencyKey); }`,
  ],
];

/**
 * GnuCOBOL 3.2.0 compiles these and warns that it does not implement them, so
 * the program runs and the statement does nothing. Enterprise COBOL implements
 * all three. This is the divergence list, and it is expected to be exactly
 * this: a construct joining it should be a deliberate decision.
 */
const DIVERGENT = new Set(["national", "json-parse", "xml-parse"]);

const available =
  spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

describe("every construct, under GnuCOBOL", () => {
  const dir = available ? mkdtempSync(join(tmpdir(), "bankc-cover-")) : "";

  for (const [name, source] of cases) {
    it(`emits COBOL for ${name}`, () => {
      const result = compile(source);
      expect(
        result.diagnostics.filter((entry) => entry.severity === "error"),
      ).toEqual([]);
    });

    it.skipIf(!available)(`compiles ${name} with cobc`, () => {
      const result = compile(source);
      const cobol = result.cobol ?? "";
      const text =
        cobol.includes("EXEC CICS") || cobol.includes("EXEC SQL")
          ? precompile(cobol).cobol
          : cobol;
      const file = join(dir, `${name}.cbl`);
      writeFileSync(file, text, "utf8");

      const built = spawnSync("cobc", ["-x", "-fixed", "-fsyntax-only", file], {
        encoding: "utf8",
      });
      const output = `${built.stdout}${built.stderr}`;

      expect(output, output).not.toMatch(/ error: /);

      // A construct that GnuCOBOL merely warns about is one of the three known
      // divergences, or it is new and wants deciding about.
      if (!DIVERGENT.has(name)) {
        expect(output, output).not.toMatch(/warning:/);
      }
    });
  }

  it.skipIf(!available)("diverges in exactly the places recorded", () => {
    const warned = new Set<string>();
    for (const [name, source] of cases) {
      const cobol = compile(source).cobol ?? "";
      const file = join(dir, `check-${name}.cbl`);
      writeFileSync(file, cobol, "utf8");
      const built = spawnSync("cobc", ["-x", "-fixed", "-fsyntax-only", file], {
        encoding: "utf8",
      });
      if (/warning:/.test(`${built.stdout}${built.stderr}`)) {
        warned.add(name);
      }
    }

    expect([...warned].sort()).toEqual([...DIVERGENT].sort());
  });
});
