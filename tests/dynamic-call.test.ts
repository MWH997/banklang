import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * `call <name> using <record> on error { ... };` and `cancel <name>;`
 *
 * A dynamic `CALL`: the module is named by a value, not written into the
 * source. That is how a bank dispatches — a product code selects the module
 * that prices it, and a new product ships as a new load module without
 * relinking anything that calls it.
 *
 * `ON EXCEPTION` is the whole safety story. A static call that cannot be
 * resolved fails at link time, where somebody sees it; a dynamic one fails in
 * the middle of a batch, and without a handler that is an abend rather than a
 * rejected record.
 */

const PREAMBLE = `module Dispatch;

record Request {
  productModule: string<8>;
  idempotencyKey: string<36>;
}

record Payload {
  event: string<32>;
  correlation: string<64>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function errors(result: {
  diagnostics: { id: string; severity: string }[];
}): string[] {
  return result.diagnostics
    .filter((entry) => entry.severity !== "warning")
    .map((entry) => entry.id);
}

function program(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction price(request: Request, payload: Payload) {
${body}
  audit("PRICED", request.idempotencyKey);
}`);
}

const GUARDED = `  call request.productModule using payload on error {
    returnCode = 12;
  };`;

describe("calling a module named by a value", () => {
  const result = program(GUARDED);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("becomes a dynamic CALL", () => {
    expect(result.cobol).toContain(
      "CALL PRODUCT-MODULE OF REQUEST USING PAYLOAD",
    );
    expect(result.cobol).toContain("END-CALL");
  });

  it("carries the failure path", () => {
    expect(result.cobol).toContain("ON EXCEPTION");
    expect(result.cobol).toContain("MOVE 12 TO BANK-RETURN-CODE");
  });

  it("takes a literal name too", () => {
    const result = program(`  call "BANKAUDT" using payload on error {
    returnCode = 12;
  };`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('CALL "BANKAUDT" USING PAYLOAD');
  });

  it("hands over nothing when there is nothing to hand over", () => {
    const result = program(`  call "BANKAUDT" on error {
    returnCode = 12;
  };`);

    expect(result.diagnostics).toEqual([]);
    // The audit event's own call to BANKAUDT does pass a record, so the check
    // is on the line this statement wrote rather than on the program as a whole.
    expect(result.cobol).toContain('CALL "BANKAUDT"\n');
  });

  /** The handler is ordinary code, so the banking checks have to see into it. */
  it("has a handler the analyzer sees into", () => {
    const result = program(`  call "BANKAUDT" using payload on error {
    debit("SUSPENSE", 1.00);
  };`);

    expect(ids(result)).toContain("BANK-LED-001");
  });
});

describe("cancel", () => {
  /** Drops the module so the next call gets its storage as the compiler left it. */
  it("becomes CANCEL", () => {
    const result = program(`${GUARDED}
  cancel request.productModule;`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("CANCEL PRODUCT-MODULE OF REQUEST");
  });

  /** Nothing is being entered, so there is no failure path to take. */
  it("takes no handler", () => {
    expect(
      ids(
        program("  cancel request.productModule on error { returnCode = 1; };"),
      ),
    ).toContain("BANK-SYN-001");
  });
});

describe("what it will take", () => {
  it("names a program with text", () => {
    expect(
      errors(
        program(`  call request.productModule using payload on error {
    returnCode = 12;
  };`),
      ),
    ).toEqual([]);
  });

  /**
   * A load module name is eight characters. A longer field is truncated to a
   * name that does not exist, and the failure arrives as a missing module
   * rather than as a length.
   */
  it("rejects a name field longer than a load module name", () => {
    const result = compile(`${PREAMBLE}
record Wide {
  moduleName: string<20>;
}

entry transaction price(request: Request, payload: Payload, wide: Wide) {
  call wide.moduleName using payload on error {
    returnCode = 12;
  };
  audit("PRICED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-029");
  });

  it("rejects a number as a program name", () => {
    const result = compile(`${PREAMBLE}
record Codes {
  productCode: binary<4>;
}

entry transaction price(request: Request, payload: Payload, codes: Codes) {
  call codes.productCode using payload on error {
    returnCode = 12;
  };
  audit("PRICED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-029");
  });

  it("hands over a record, not a field", () => {
    expect(
      ids(
        program(`  call "BANKAUDT" using request.idempotencyKey on error {
    returnCode = 12;
  };`),
      ),
    ).toContain("BANK-TYPE-029");
  });

  /**
   * The compiler cannot know whether the module is there — that is the nature
   * of a dynamic call — so it insists the program says what to do when it is
   * not.
   */
  it("warns about a call with no failure path", () => {
    const result = program("  call request.productModule using payload;");
    const warning = result.diagnostics.find(
      (entry) => entry.id === "BANK-TYPE-029",
    );

    expect(warning?.severity).toBe("warning");
    expect(errors(result)).toEqual([]);
  });
});

/**
 * A dispatch that silently does nothing looks exactly like one that worked, so
 * this is run: one module that exists and one that does not.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("calls what is there and survives what is not", () => {
    const result = program(`  request.productModule = "BANKAUDT";
  payload.event = "PRICED";
  payload.correlation = "KEY-1";
  call request.productModule using payload on error {
    log "MISSING FIRST";
  };
  log "CALLED";
  request.productModule = "NOSUCH";
  call request.productModule using payload on error {
    log "MISSING SECOND";
  };
  cancel request.productModule;`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-dyncall-"));
    writeFileSync(join(dir, "program.cbl"), localCobol(result.cobol ?? ""), "utf8");

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
    // Surviving the missing module is the claim: without ON EXCEPTION this
    // would abend rather than exit zero.
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("CALLED");
    expect(ran.stdout).toContain("MISSING SECOND");
    expect(ran.stdout).not.toContain("MISSING FIRST");
  });
});
