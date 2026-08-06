import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { flowed, localCobol, parmDriver } from "./helpers";

/**
 * `JSON PARSE` and `XML PARSE`, executed.
 *
 * Enterprise COBOL implements both. GnuCOBOL 3.2.0 compiles either, warns it
 * has not implemented it, and then does nothing at run time — the record is
 * left untouched, no exception is raised, and a program reading a payload runs
 * clean and processes an empty record. That is the worst shape a divergence can
 * take, because every local signal says the program worked, and it is why both
 * statements sat on the divergence list as a caveat rather than a check.
 *
 * They are now routed the way `EXEC SQL` and `EXEC CICS` already were: the
 * precompiler rewrites them into calls on `BANKJSON` and `BANKXML`, and what
 * ships to z/OS keeps the statement it was written with. The tests below run
 * the result, because a translation that compiles proves nothing about whether
 * the record was filled.
 *
 * What this establishes is control flow and population, not vendor behaviour:
 * `runtime/README.md` says what the stubs are and are not.
 */

const available =
  spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

const RECORD = `record Row {
  rowId: string<16>;
  amount: zoned<9, 2>;
  shown: edited<decimal<9, 2>, "plain">;
  idempotencyKey: string<36>;
}`;

function program(body: string): ReturnType<typeof compile> {
  return compile(`module Parsed;

${RECORD}

entry transaction load1(row: Row, doc: string<200>) {
${body}
  row.shown = row.amount;
  log "ID=", row.rowId;
  log "AMT=", row.shown;
  audit("PARSED", row.idempotencyKey);
}`);
}

/** Compile the translated program against the stubs and run it. */
function run(result: ReturnType<typeof compile>, runtimes: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "bankc-parse-"));
  writeFileSync(
    join(dir, "program.cbl"),
    localCobol(precompile(result.cobol ?? "").cobol),
    "utf8",
  );
  // The document is an entry parameter, so the program reads it from the job's
  // PARM and takes `PROCEDURE DIVISION USING`. An executable cannot have one,
  // so the driver is the entry point and supplies the parameter list.
  writeFileSync(join(dir, "driver.cbl"), parmDriver(result.program!), "utf8");

  const built = spawnSync(
    "cobc",
    [
      "-x",
      "-fixed",
      "-Wcolumn-overflow",
      "driver.cbl",
      "program.cbl",
      ...runtimes.map((name) => join(process.cwd(), `runtime/${name}.cbl`)),
      join(process.cwd(), "runtime/BANKAUDT.cbl"),
      "-o",
      "program",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);

  return spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
}

describe("what the precompiler writes for a JSON parse", () => {
  const result = program(`  doc = "{'ROW-ID':'AC0001','AMOUNT':42.50}";
  json doc into row on error { log "BAD DOCUMENT"; };`);

  it("asks the runtime for each item of the record by name", () => {
    const translated = flowed(precompile(result.cobol ?? "").cobol);

    // The record is the schema in both directions, so the expansion asks the
    // same question the statement does: one call per item, named.
    expect(translated).toContain('MOVE "ROW-ID" TO BANK-JSON-NAME');
    expect(translated).toContain('MOVE "AMOUNT" TO BANK-JSON-NAME');
    expect(translated).toContain(
      'CALL "BANKJSON" USING LOAD-1-P2, BANK-JSON-DOC-LEN, BANK-JSON-NAME, BANK-JSON-VALUE, BANK-JSON-FOUND',
    );
    // Characters have to be converted into a number rather than moved into one.
    expect(translated).toContain(
      "COMPUTE AMOUNT OF ROW = FUNCTION NUMVAL(BANK-JSON-VALUE)",
    );
  });

  /** The shipped artifact is the one z/OS compiles, and it is untouched. */
  it("leaves the statement alone in the artifact itself", () => {
    expect(result.cobol).toContain("JSON PARSE LOAD-1-P2 INTO ROW");
  });

  it.skipIf(!available)("fills the record from the document", () => {
    const ran = run(result, ["BANKJSON"]);

    expect(ran.stdout).toContain("ID=AC0001");
    expect(ran.stdout).toContain("AMT=     42.50");
    expect(ran.stdout).not.toContain("BAD DOCUMENT");
  });

  /**
   * IBM's reason code 1: "One or more data items had no matching JSON
   * name/value pair, and thus were not changed." The record above declares an
   * idempotency key the document does not carry, so the parse is exactly the
   * half-populated one the compiler's own `JSON-STATUS` test exists to report —
   * and now that test is reached with a value it did not invent.
   */
  it.skipIf(!available)("reports a record the document did not fill", () => {
    const ran = run(result, ["BANKJSON"]);

    expect(ran.stdout).toContain("JSON PARSE INCOMPLETE JSON-STATUS");
  });

  /**
   * JSON-CODE 101: "The JSON text was zero-length, or consisted only of
   * whitespace." An exception condition, so the handler the program wrote runs
   * — which under GnuCOBOL alone it never did, for any document at all.
   */
  it.skipIf(!available)("takes the failure path on an empty document", () => {
    const ran = run(
      program(`  json doc into row on error { log "BAD DOCUMENT"; };`),
      ["BANKJSON"],
    );

    expect(ran.stdout).toContain("BAD DOCUMENT");
  });
});

describe("what the precompiler writes for an XML parse", () => {
  const result = program(`  doc = "<R><ID>AC0001</ID><AMT>42.50</AMT></R>";
  xml doc processing {
    element "ID" into row.rowId;
    element "AMT" into row.amount;
  };`);

  /**
   * `XML PARSE` calls the handler once per event, and a subprogram cannot
   * `PERFORM` a section in its caller — so the loop stays in the program and
   * the runtime is one step of it. That is the statement's own control flow,
   * which is what makes running it worth anything.
   */
  it("drives the generated handler from a loop over the runtime", () => {
    const translated = flowed(precompile(result.cobol ?? "").cobol);

    expect(translated).toContain('PERFORM UNTIL BANK-XML-END = "Y"');
    expect(translated).toContain(
      'CALL "BANKXML" USING LOAD-1-P2, BANK-XML-DOC-LEN, BANK-XML-POS, BANK-XML-EVENT, BANK-XML-TEXT, BANK-XML-TEXT-LEN, BANK-XML-INFO, BANK-XML-END',
    );
    expect(translated).toContain("PERFORM BANK-XML-1");
  });

  /**
   * GnuCOBOL reserves the registers but only a real `XML PARSE` sets them:
   * `XML-TEXT` is a zero-length register and a `MOVE` to it ends the run with a
   * segmentation fault. The handler is pointed at fields of the translator's
   * own, reference-modified by the length of the event — otherwise a `STRING
   * ... DELIMITED BY SIZE` would append a thousand spaces per fragment.
   */
  it("points the handler at its own fields rather than the registers", () => {
    const translated = precompile(result.cobol ?? "").cobol;

    expect(translated).toContain("EVALUATE BANK-XML-EVENT");
    expect(translated).toContain("BANK-XML-TEXT(1:BANK-XML-TEXT-LEN)");
    expect(translated).toContain("IF BANK-XML-INFO NOT = 2");
    // The length field holds the register's name as a substring, and rewriting
    // that would leave the expansion pointing at a field that does not exist.
    expect(translated).toContain("BANK-XML-TEXT-LEN    PIC S9(9) COMP-5");
  });

  it("leaves the statement alone in the artifact itself", () => {
    expect(flowed(result.cobol)).toContain(
      flowed("XML PARSE LOAD-1-P2 PROCESSING PROCEDURE BANK-XML-1"),
    );
    expect(result.cobol).toContain("EVALUATE XML-EVENT");
  });

  it.skipIf(!available)("fills the record from the document", () => {
    const ran = run(result, ["BANKXML"]);

    expect(ran.stdout).toContain("ID=AC0001");
    expect(ran.stdout).toContain("AMT=     42.50");
  });

  /**
   * A document opening with an XML declaration is the ordinary case, and the
   * first version of the runtime reported the skipped declaration as the end of
   * the document — so the handler was never entered and the record came out
   * empty, which is the very thing this exists to stop.
   */
  it.skipIf(!available)("reads past an XML declaration", () => {
    const ran = run(
      program(`  doc = "<?xml version='1.0'?><R><ID>AC0002</ID></R>";
  xml doc processing {
    element "ID" into row.rowId;
  };`),
      ["BANKXML"],
    );

    expect(ran.stdout).toContain("ID=AC0002");
  });
});
