import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { withoutCompilerOptions } from "../packages/precompiler/src/index";
import { localCobol } from "./helpers";

/**
 * Every construct the language has, compiled under GnuCOBOL.
 *
 * The emitted COBOL is meant to work on Enterprise COBOL *and* GnuCOBOL, and
 * until this existed that was an assumption rather than a check: the validator
 * defaulted to one example, and per-construct coverage was whatever individual
 * tests happened to invoke `cobc` for. A `varying` whose length field sat inside
 * its own record emitted COBOL neither compiler accepts, and nothing noticed.
 *
 * Constructs GnuCOBOL compiles but does not implement are named below rather
 * than skipped silently. Two of them are translated by the precompiler so the
 * local build can execute them; what is left is the inventory of where the two
 * targets genuinely diverge, and it is one entry long.
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
  // The table has to be last, and nothing here compiled it until a record with
  // a field after the table turned out to be COBOL neither compiler accepts.
  [
    "occurs-depending",
    `module M;\nrecord E { kind: string<6>; }\nrecord D { idempotencyKey: string<36>; n: binary<4>; rows: E[8] depending on n; }\nentry transaction t(d: D) { d.n = 3; audit("A", d.idempotencyKey); }`,
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
    // The record is not called `V`. `RECORDING MODE IS V` is on the FD of
    // every QSAM file, and GnuCOBOL will not then accept `V` as a data name in
    // the same program — Enterprise COBOL will, `V` being nowhere in its
    // reserved word table, so this is the local compiler being the stricter of
    // the two rather than a construct the target refuses.
    "varying",
    `module M;\nrecord Vary { text: string<80>; }\nfile f sequential output record Vary varying 1 to 80 length vlen status fs;\nentry transaction t(v: Vary, idempotencyKey: string<36>) { open f; vlen = 5; write f from v; close f; audit("A", idempotencyKey); }`,
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
 * Statements GnuCOBOL 3.2.0 compiles, warns it has not implemented, and then
 * does nothing about at run time — which the precompiler rewrites into calls
 * so the local build can execute them, exactly as it does for `EXEC SQL` and
 * `EXEC CICS`. What ships to z/OS keeps the statement.
 */
const TRANSLATED = new Set(["json-parse", "xml-parse"]);

/**
 * What is left that the local target genuinely does differently.
 *
 * `national` is not a missing statement and no shim reaches it: GnuCOBOL
 * allocates four bytes per character inside a group where Enterprise COBOL
 * allocates two, so every field after one sits somewhere else. An allocator is
 * not something emitted COBOL can change, which is why this one is a warning on
 * the program rather than a translation.
 *
 * This list is expected to be exactly this. A construct joining it should be a
 * deliberate decision.
 */
const DIVERGENT = new Set(["national"]);

/** Constructs whose COBOL has to go through the precompiler to be executed. */
const NEEDS_PRECOMPILE = /EXEC\s+(?:CICS|SQL)\b|^\s*(?:JSON|XML)\s+PARSE\b/im;

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
      // Always translated, not only when a statement needs it: every artifact
      // opens with the `CBL` statement naming its compiler options, which IBM
      // reads and GnuCOBOL cannot.
      const file = join(dir, `${name}.cbl`);
      writeFileSync(file, localCobol(result.cobol), "utf8");

      const built = spawnSync("cobc", ["-x", "-fixed", "-fsyntax-only", file], {
        encoding: "utf8",
      });
      const output = `${built.stdout}${built.stderr}`;

      expect(output, output).not.toMatch(/ error: /);

      // A construct that still warns once translated is a genuine divergence,
      // or it is new and wants deciding about.
      if (!DIVERGENT.has(name)) {
        expect(output, output).not.toMatch(/warning:/);
      }
    });
  }

  /**
   * The artifact itself, untranslated, is what z/OS gets. Every construct that
   * warns here is one the local compiler does not implement — and each has to
   * be accounted for: either the precompiler rewrites it, or it is on the
   * divergence list with a reason.
   */
  it.skipIf(!available)("warns in exactly the places accounted for", () => {
    const warned = new Set<string>();
    for (const [name, source] of cases) {
      // Only the compiler-option statement is taken out. Translating the rest
      // would answer a different question — the point here is which constructs
      // GnuCOBOL does not implement in the artifact as it ships.
      const cobol = withoutCompilerOptions(compile(source).cobol ?? "");
      const file = join(dir, `check-${name}.cbl`);
      writeFileSync(file, cobol, "utf8");
      const built = spawnSync("cobc", ["-x", "-fixed", "-fsyntax-only", file], {
        encoding: "utf8",
      });
      if (/warning:/.test(`${built.stdout}${built.stderr}`)) {
        warned.add(name);
      }
    }

    expect([...warned].sort()).toEqual([...DIVERGENT, ...TRANSLATED].sort());
  });
});
