import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { FEATURES } from "../packages/migration-analysis/src/features";
import { interpretedVerbs } from "../tools/interpreter-coverage";
import {
  CAPABILITIES,
  SUPPORT_RULES,
  supportFor,
} from "../packages/horizontal-validation/src/index";

/**
 * The compiler against what the validator believes about the compiler.
 *
 * These exist because of one bug. The representability rules said `inspect` was
 * `unsupported-not-yet-implemented` with the note "No BankTS syntax" — while
 * `countOf` lowered to `INSPECT ... TALLYING` and `replaceChars` to `INSPECT
 * ... CONVERTING`, and had done throughout. Correcting one word moved 182 of
 * X-COBOL's 5,195 files, without adding a line of compiler capability.
 *
 * Nothing could have caught it. The compiler's capability lived in `case`
 * labels across the typechecker and the backend; the validator's belief about
 * that capability lived in a hand-written table; and the two had no
 * relationship beyond somebody remembering to update both.
 *
 * So each capability is now a claim that gets executed: a BankTS program, the
 * COBOL it must produce, and the corpus feature that construct corresponds to.
 * The test that matters is the last one — a feature a BankTS construct
 * demonstrably emits cannot be classified `unsupported`.
 */

/** The emitted COBOL with runs of whitespace collapsed, so a wrap cannot hide it. */
function flowed(cobol: string | null): string {
  return (cobol ?? "").replace(/\s+/g, " ");
}

describe("every capability's probe", () => {
  for (const capability of CAPABILITIES) {
    it(`compiles: ${capability.bankts}`, () => {
      const result = compile(capability.probe, {
        sourceFile: `${capability.bankts}.bank.ts`,
      });
      const errors = result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      expect(
        errors.map((diagnostic) => `${diagnostic.id}: ${diagnostic.message}`),
        `the probe for ${capability.bankts} no longer compiles, so the capability claim cannot be checked`,
      ).toEqual([]);
      expect(result.cobol).not.toBeNull();
    });

    it(`lowers to the COBOL it claims: ${capability.bankts}`, () => {
      // The claim about the backend. A row asserting a lowering the emitter
      // does not perform is exactly as wrong as a rule denying one it does.
      const result = compile(capability.probe, {
        sourceFile: `${capability.bankts}.bank.ts`,
      });
      expect(
        flowed(result.cobol),
        `${capability.bankts} is registered as emitting ${capability.emits} and does not`,
      ).toContain(capability.emits);
    });
  }
});

describe("the validator against the compiler", () => {
  it("names only features the analyser can detect", () => {
    const known = new Set(FEATURES.map((feature) => feature.name));
    const unknown = CAPABILITIES.map((capability) => capability.feature)
      .filter((name): name is string => name !== null)
      .filter((name) => !known.has(name));
    expect(
      unknown,
      "a capability names a corpus feature that no detector produces",
    ).toEqual([]);
  });

  /**
   * The regression this whole file exists for.
   *
   * A construct BankTS demonstrably emits cannot be classified as something
   * BankTS has no way to say. `adaptation` remains available and is often
   * right — `substring` takes constant bounds where COBOL takes computed ones,
   * so a program using the computed form still has to be restructured — but
   * `unsupported-not-yet-implemented` and `unsupported-by-design` are claims
   * about absence, and the probe above is evidence of presence.
   */
  it("never calls a feature unsupported when BankTS emits it", () => {
    const contradictions: string[] = [];
    for (const capability of CAPABILITIES) {
      if (!capability.feature) {
        continue;
      }
      const rule = supportFor(capability.feature);
      if (!rule) {
        contradictions.push(
          `${capability.feature} has no representability rule, but \`${capability.bankts}\` emits ${capability.emits}`,
        );
        continue;
      }
      if (rule.support.startsWith("unsupported")) {
        contradictions.push(
          `${capability.feature} is ${rule.support}, but \`${capability.bankts}\` compiles and emits ${capability.emits}`,
        );
      }
    }
    expect(contradictions).toEqual([]);
  });

  it("has a probe for every feature classified as supported", () => {
    /*
     * The other direction, and the weaker one.
     *
     * A rule saying `supported` is a claim that BankTS has the construct, and a
     * claim nobody exercises is how the line-sequential row came to say
     * `supported` on the strength of COBOL only the hand-written reference
     * modules contained. Features whose support is *structural* rather than a
     * named construct are listed here rather than probed — `move` is
     * assignment, `conditional` is `if` — because a probe for them would assert
     * that BankTS has statements.
     */
    const structural = new Set([
      "move",
      "arithmetic-verbs",
      "conditional",
      "initialize",
      "file-verbs",
      "file-status",
      "file-sequential",
      "perform-varying",
      "compute",
      "rounded",
      "on-size-error",
      "accept-display",
      "evaluate",
      "occurs",
      "occurs-depending-on",
      "redefines",
      "renames",
      "comp-3",
      "comp-binary",
      "sign-separate",
      "national",
      "linkage-section",
      "local-storage",
      "intrinsic-function",
      "declaratives",
      "call-static",
      "call-dynamic",
      "start-browse",
      "report-writer",
      "linage",
      "exec-sql",
      "exec-cics",
      "cbltdli",
      "mq",
      "copy",
      "nested-program",
      "continuation",
    ]);
    const probed = new Set(
      CAPABILITIES.map((capability) => capability.feature).filter(
        (name): name is string => name !== null,
      ),
    );
    const unprobed = SUPPORT_RULES.filter(
      (rule) => rule.support === "supported",
    )
      .map((rule) => rule.feature)
      .filter((name) => !structural.has(name) && !probed.has(name));
    expect(
      unprobed,
      "these are claimed supported with no capability probe and no structural exemption",
    ).toEqual([]);
  });

  it("keeps the rules previous phases got wrong", () => {
    // Named explicitly, because each was corrected in the direction of
    // whatever the last person assumed, and a regression would be silent.
    expect(supportFor("inspect")?.support).toBe("adaptation");
    expect(supportFor("file-line-sequential")?.support).toBe("supported");
    expect(supportFor("file-relative")?.support).toBe("adaptation");
  });
});

/**
 * "The compiler supports it" and "both engines agree about it" are different
 * claims, and conflating them is how `SORT` came to be a registered capability
 * while three benchmark tasks passed under `cobc` alone with no comparison at
 * all.
 *
 * So each row says how far it has been executed, and a `differential` claim is
 * held to the interpreter's own dispatch table — the same source
 * `pnpm interpreter:coverage` reads, so a verb the interpreter loses stops
 * being a differential claim without anybody editing this file.
 */
describe("how far each capability has been executed", () => {
  const interpreted = interpretedVerbs();

  it("reads the interpreter's dispatch rather than a list", () => {
    expect(interpreted.size).toBeGreaterThan(20);
    expect(interpreted.has("SORT")).toBe(true);
  });

  for (const capability of CAPABILITIES) {
    it(`is honest for ${capability.bankts}`, () => {
      const result = compile(capability.probe, { sourceFile: "probe.bank.ts" });
      const cobol = (result.cobol ?? "").replace(/\s+/g, " ");

      // Every COBOL verb the probe's own program emits. A `differential` row
      // whose program emits a verb the interpreter cannot execute is a row
      // claiming a comparison that cannot happen.
      const emitted = new Set(
        [...cobol.matchAll(/\b([A-Z][A-Z-]{2,})\b/g)].map(
          (match) => match[1] as string,
        ),
      );
      const unrunnable = ["SORT", "MERGE", "RELEASE", "RETURN", "GENERATE"]
        .filter((verb) => emitted.has(verb))
        .filter((verb) => !interpreted.has(verb));

      if (capability.execution === "differential") {
        expect(
          unrunnable,
          `${capability.bankts} claims a differential result and emits a verb the interpreter cannot execute`,
        ).toEqual([]);
      }
    });
  }

  it("records SORT and MERGE as differentially validated", () => {
    for (const name of ["sort", "merge"]) {
      const row = CAPABILITIES.find((capability) => capability.bankts === name);
      expect(row?.execution, name).toBe("differential");
    }
  });
});
