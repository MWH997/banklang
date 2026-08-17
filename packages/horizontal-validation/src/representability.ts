/**
 * Whether BankTS can express what a COBOL program does, decided by rule.
 *
 * This is the file that turns 5,195 real programs into a number, so it is also
 * the file where that number could most easily be made up. Three constraints
 * keep it honest.
 *
 * No model decides anything. The verdict for a program is a pure function of
 * the features `packages/migration-analysis` found in it, and the table below
 * is the whole policy. Anyone can disagree with a row and see exactly which
 * programs it moves.
 *
 * A verdict is about *language scope*, never about correctness. "Fully
 * representable" means every construct in the file has a BankTS equivalent,
 * not that a translation would compute the same answer, which nothing static
 * can establish and which this project does not claim.
 *
 * `unsupported-by-design` is not a synonym for "hard". It is reserved for
 * constructs BankTS refuses *because of what it is for*: a language that exists
 * to make banking arithmetic auditable does not get IEEE floating point, and a
 * language whose control flow must be reviewable does not get `ALTER`. Every
 * such row carries the reason, and `desirable` is answered honestly. Several
 * of these would be nice to have and are still excluded.
 */

import type { FeatureCounts } from "../../migration-analysis/src/features";

export type FeatureSupport =
  /** BankTS has a direct construct for it. */
  | "supported"
  /** Expressible, but the program has to be restructured to say it. */
  | "adaptation"
  /** Refused because of what BankTS is for. */
  | "unsupported-by-design"
  /** Nothing in principle stops it; nobody has built it. */
  | "unsupported-not-yet-implemented";

export interface SupportRule {
  feature: string;
  support: FeatureSupport;
  /** The BankTS construct, or the reason there is none. */
  note: string;
  /** Honest answer, independent of whether it is excluded. */
  desirable: boolean;
}

/**
 * The policy, one row per detectable feature.
 *
 * Every `supported` row names the BankTS syntax that carries it, so a reader
 * can check the claim against `docs/language/`. Every exclusion names what
 * would have to change.
 */
export const SUPPORT_RULES: SupportRule[] = [
  // ---- data ----------------------------------------------------------
  {
    feature: "comp-3",
    support: "supported",
    note: "`decimal<p,s>` is packed by default; this is the storage BankTS was built around.",
    desirable: true,
  },
  {
    feature: "comp-binary",
    support: "supported",
    note: "The `binary` usage modifier on a decimal field.",
    desirable: true,
  },
  {
    feature: "comp-float",
    support: "unsupported-by-design",
    note: "COMP-1 and COMP-2 are IEEE binary floating point, in which 0.1 has no exact value. A language whose reason to exist is auditable money arithmetic cannot offer a type where two correct programs disagree in the last penny.",
    desirable: false,
  },
  {
    feature: "redefines",
    support: "supported",
    note: "`redefines` on a record field; see docs/language/records.md.",
    desirable: true,
  },
  {
    feature: "occurs",
    support: "supported",
    note: "Fixed-length arrays on a record field.",
    desirable: true,
  },
  {
    feature: "occurs-depending-on",
    support: "supported",
    note: "`depending` on an array field, with the bound checked.",
    desirable: true,
  },
  {
    feature: "condition-names",
    support: "supported",
    note: "`enum` members lower to 88-level condition names.",
    desirable: true,
  },
  {
    feature: "renames",
    support: "supported",
    note: "`renames` over a run of fields.",
    desirable: true,
  },
  {
    feature: "usage-pointer",
    support: "unsupported-by-design",
    note: "Address arithmetic. BankTS has no pointer type and no `SET ... TO ADDRESS OF`: a language that refuses unchecked subscripts cannot then hand out raw addresses.",
    desirable: false,
  },
  {
    feature: "usage-index",
    support: "adaptation",
    note: "Array access is by expression rather than by a declared index register; a program written around `SET NI UP BY 1` becomes a `for each` loop.",
    desirable: true,
  },
  {
    feature: "sign-separate",
    support: "supported",
    note: "The `zoned` and `unsigned` usage modifiers cover the sign representations.",
    desirable: true,
  },
  {
    feature: "national",
    support: "supported",
    note: "`national<n>`, which lowers to PIC N.",
    desirable: true,
  },
  {
    feature: "linkage-section",
    support: "supported",
    note: "Entry parameters: a batch PARM, a CICS commarea, or a called module's arguments.",
    desirable: true,
  },
  {
    feature: "local-storage",
    support: "supported",
    note: "Emitted for recursive functions, which need per-invocation storage.",
    desirable: true,
  },
  {
    feature: "external-data",
    support: "unsupported-not-yet-implemented",
    note: "EXTERNAL and GLOBAL share storage between separately compiled programs. Nothing in BankTS's model forbids it; there is no syntax for it.",
    desirable: true,
  },

  // ---- procedure ------------------------------------------------------
  {
    feature: "move",
    support: "supported",
    note: "Assignment, with the type conversion checked rather than implied.",
    desirable: true,
  },
  {
    feature: "arithmetic-verbs",
    support: "supported",
    note: "Arithmetic expressions, which the backend lowers to COMPUTE or the individual verbs.",
    desirable: true,
  },
  {
    feature: "conditional",
    support: "supported",
    note: "`if` / `else`, as blocks with explicit ends.",
    desirable: true,
  },
  {
    feature: "initialize",
    support: "supported",
    note: "Record fields carry declared initial values, which is what INITIALIZE is used for.",
    desirable: true,
  },
  {
    feature: "file-verbs",
    support: "supported",
    note: "`readFile`, `writeFile` and `rewriteFile`, with the file status checked.",
    desirable: true,
  },
  {
    feature: "perform-thru",
    support: "adaptation",
    note: "The backend emits `PERFORM x THRU x-EXIT` for its own paragraphs, and BankTS cannot write a range across paragraphs it did not generate: a function is the unit instead.",
    desirable: false,
  },
  {
    feature: "perform-varying",
    support: "supported",
    note: "`while`, `for`, and `for each`.",
    desirable: true,
  },
  {
    feature: "go-to",
    support: "adaptation",
    note: "The backend emits `GO TO <paragraph>-EXIT` for an early return and nothing else. An arbitrary jump has no BankTS syntax, so a program built on them is restructured into functions and conditionals.",
    desirable: false,
  },
  {
    feature: "go-to-depending",
    support: "unsupported-by-design",
    note: "A computed jump into a list of labels. `switch` covers the intent with a form a reviewer can follow.",
    desirable: false,
  },
  {
    feature: "alter",
    support: "unsupported-by-design",
    note: "ALTER rewrites the destination of a GO TO while the program runs, so the program's control flow cannot be read from its text. Deleted from the standard in COBOL 85 and refused here for the same reason.",
    desirable: false,
  },
  {
    feature: "call-static",
    support: "supported",
    note: "`call` to a named program.",
    desirable: true,
  },
  {
    feature: "call-dynamic",
    support: "supported",
    note: "`call` through a variable target; see tests/dynamic-call.test.ts.",
    desirable: true,
  },
  {
    feature: "sort-merge",
    support: "supported",
    note: "`sort` and `merge`, with input and output procedures.",
    desirable: true,
  },
  {
    feature: "string-unstring",
    support: "adaptation",
    note: "`concat` lowers to STRING DELIMITED BY SIZE (973 corpus statements) and `split ... by ... into` to UNSTRING with one delimiter (262). The POINTER, OVERFLOW, multiple-delimiter and DELIMITED BY ALL forms have no BankTS equivalent.",
    desirable: true,
  },
  {
    feature: "inspect",
    support: "adaptation",
    /*
     * This row said `unsupported-not-yet-implemented` and "No BankTS syntax",
     * and both halves were wrong. `countOf(text, ch)` lowers to `INSPECT ...
     * TALLYING ... FOR ALL` and `replaceChars(text, from, to)` lowers to
     * `INSPECT ... CONVERTING`; both have been in the language and in
     * `docs/language/functions.md` throughout.
     *
     * `adaptation` rather than `supported`, from the measured forms in
     * `evidence/horizontal/xcobol-v2/string-usage.json`: 1,007 TALLYING and 105
     * CONVERTING statements are covered, and 780 REPLACING and 625 with a
     * BEFORE/AFTER range are not. A program using those has to be restructured
     * rather than translated, which is what `adaptation` means.
     *
     * The same class of error as the line-sequential row, in the other
     * direction: a rule written from the inside, understating the compiler
     * instead of flattering it. Both distort a published number.
     */
    note: "`countOf` lowers to INSPECT TALLYING FOR ALL and `replaceChars` to INSPECT CONVERTING. REPLACING, and the BEFORE/AFTER ranges, have no BankTS form: 780 and 625 statements in the corpus respectively.",
    desirable: true,
  },
  {
    feature: "reference-modification",
    support: "adaptation",
    note: "`substring(text, start, length)` takes constant bounds only, so every out-of-range constant is `BANK-TYPE-003` at compile time and a computed bound is refused outright. That covers 194 of the 661 corpus files using reference modification; the other 451 use at least one dynamic bound and have to be restructured.",
    desirable: true,
  },
  {
    feature: "intrinsic-function",
    support: "supported",
    note: "The date, numeric and string builtins lower to COBOL intrinsics.",
    desirable: true,
  },
  {
    feature: "evaluate",
    support: "supported",
    note: "`switch`.",
    desirable: true,
  },
  {
    feature: "search",
    support: "supported",
    note: "`search` and `search ... by` over a table.",
    desirable: true,
  },
  {
    feature: "declaratives",
    support: "supported",
    note: "Emitted for file error handling; see tests/declaratives.test.ts.",
    desirable: true,
  },
  {
    feature: "compute",
    support: "supported",
    note: "Arithmetic expressions, with scale tracked through every operation.",
    desirable: true,
  },
  {
    feature: "rounded",
    support: "supported",
    note: "`round(value, scale, mode)`, which is required rather than optional where scale is lost.",
    desirable: true,
  },
  {
    feature: "on-size-error",
    support: "supported",
    note: "Emitted around arithmetic that can overflow its target.",
    desirable: true,
  },
  {
    feature: "accept-display",
    support: "supported",
    note: "`log` for DISPLAY, and `accept` for the system date and time.",
    desirable: true,
  },
  {
    feature: "entry-point",
    support: "unsupported-by-design",
    note: "ENTRY gives one program several names to be called by, each with its own parameter list. One module is one program with one interface; see docs/adr/0004.",
    desirable: false,
  },

  // ---- input and output ------------------------------------------------
  {
    feature: "file-sequential",
    support: "supported",
    note: "Sequential files, fixed or variable length.",
    desirable: true,
  },
  {
    feature: "file-line-sequential",
    support: "supported",
    /*
     * Implemented 2026-08-08, and this row is the record of both halves.
     *
     * It said `supported` first on the strength of `LINE SEQUENTIAL` appearing
     * in this repository, in five hand-written reference modules under
     * `runtime/`, never from the emitter. Horizontal validation caught that by
     * trying to implement a CobolCodeBench task and finding nowhere to put the
     * input, and the row was corrected to `unsupported-not-yet-implemented`.
     *
     * It is now genuinely supported: `file f lineSequential input record R`
     * parses, typechecks under the restrictions Enterprise COBOL puts on the
     * organization, emits `ORGANIZATION IS LINE SEQUENTIAL`, allocates a z/OS
     * UNIX path in the generated JCL, and executes identically under `cobc` and
     * the interpreter. See `tests/line-sequential.test.ts`.
     */
    note: "`lineSequential`, for a newline-delimited text file. A record may hold only DISPLAY items, which Enterprise COBOL requires and BankTS enforces: `decimal` is packed by default and is a compile error here.",
    desirable: true,
  },
  {
    feature: "file-indexed",
    support: "supported",
    note: "Indexed files, which on z/OS are VSAM KSDS.",
    desirable: true,
  },
  {
    feature: "file-relative",
    support: "adaptation",
    note: "`file <name> relative ...` emits ORGANIZATION IS RELATIVE and a generated RELATIVE KEY. Migration is still an adaptation: BankTS does not expose relative-record-number access, and source-level `key` operations and browsing remain indexed-only.",
    desirable: true,
  },
  {
    feature: "start-browse",
    support: "supported",
    note: "Keyed positioning and browse, over an indexed file.",
    desirable: true,
  },
  {
    feature: "file-status",
    support: "supported",
    note: "Required rather than optional: an unchecked file status is a compile error.",
    desirable: true,
  },
  {
    feature: "report-writer",
    support: "supported",
    note: "`report` with control breaks and sum counters; see docs/language/reports.md.",
    desirable: true,
  },
  {
    feature: "linage",
    support: "supported",
    note: "A print file's page depth, with the end-of-page branch.",
    desirable: true,
  },
  {
    feature: "screen-section",
    support: "unsupported-by-design",
    note: "SCREEN SECTION is a character terminal form, and is not part of Enterprise COBOL on z/OS at all, since a 3270 screen is CICS BMS. Outside the target.",
    desirable: false,
  },

  // ---- interoperation ---------------------------------------------------
  {
    feature: "exec-sql",
    support: "supported",
    note: "`sql` statements and cursors, with SQLCODE handling required.",
    desirable: true,
  },
  {
    feature: "exec-cics",
    support: "supported",
    note: "`cics` commands, with RESP handling required.",
    desirable: true,
  },
  {
    feature: "exec-dli",
    support: "adaptation",
    note: "IMS is expressed in call form, with `getUnique`, `getNext` and the rest, rather than as EXEC DLI, so a command-form program is rewritten into calls.",
    desirable: true,
  },
  {
    feature: "cbltdli",
    support: "supported",
    note: "The IMS segment operations lower to CBLTDLI calls.",
    desirable: true,
  },
  {
    feature: "mq",
    support: "supported",
    note: "`connectQueue`, `putMessage`, `getMessage` and `disconnectQueue`.",
    desirable: true,
  },
  {
    feature: "copy",
    support: "supported",
    note: '`copybookMode: "copy"` emits COPY rather than inlining the layout.',
    desirable: true,
  },
  {
    feature: "copy-replacing",
    support: "unsupported-not-yet-implemented",
    note: "COPY ... REPLACING edits a copybook as it is read. The importer reads a plain copybook; it does not apply REPLACING.",
    desirable: true,
  },

  // ---- source format -----------------------------------------------------
  {
    feature: "nested-program",
    support: "supported",
    note: "Emitted for contained programs; see tests/nested-programs.test.ts.",
    desirable: true,
  },
  {
    feature: "continuation",
    support: "supported",
    note: "The emitter continues a literal that will not fit before column 72.",
    desirable: true,
  },
];

const BY_FEATURE = new Map(SUPPORT_RULES.map((rule) => [rule.feature, rule]));

/** The rule for a feature, or null when the detector knows a name this does not. */
export function supportFor(feature: string): SupportRule | null {
  return BY_FEATURE.get(feature) ?? null;
}

export type Representability =
  | "fully-representable"
  | "representable-with-adaptation"
  | "unsupported-by-design"
  | "unsupported-not-yet-implemented"
  | "analyser-failure"
  | "unknown";

export interface RepresentabilityVerdict {
  verdict: Representability;
  /** The features that decided it, so the number can be argued with. */
  deciding: string[];
  /** Features the detector found and this policy has no rule for. */
  unclassified: string[];
}

/**
 * One program's verdict, from its features alone.
 *
 * Precedence is deliberate and is the pessimistic order: a single by-design
 * exclusion outranks any amount of supported material, because a program
 * containing `ALTER` is not one BankTS can express regardless of what else is
 * in it. Reporting the optimistic answer, "94% of its constructs are
 * supported", would be the kind of number that reads as a migration estimate
 * and is not one.
 *
 * A feature with no rule makes the verdict `unknown` rather than being ignored.
 * Ignoring it is how a classifier silently drifts into flattering itself as the
 * detector learns new constructs.
 */
export function classifyProgram(
  features: FeatureCounts,
): RepresentabilityVerdict {
  const present = Object.keys(features).sort();
  const unclassified = present.filter((name) => !BY_FEATURE.has(name));
  if (unclassified.length > 0) {
    return { verdict: "unknown", deciding: [], unclassified };
  }

  /*
   * No detected construct is no evidence, and no evidence is not a pass.
   *
   * This returned `fully-representable` until X-COBOL was measured, on the
   * reasoning that a file containing nothing unsupported contains nothing
   * unsupported. That is true and it is not what the verdict is read as. The
   * corpus holds short teaching fragments. One is six lines whose only
   * statement is `ADD 0 TO ZERO GIVING RETURN-CODE`, and eighty-four of them
   * were being counted into the headline as programs whose every construct
   * BankTS supports. The detector had simply learned nothing about them.
   *
   * The missing verbs were added to the feature table at the same time, which
   * is the other half of the fix; this is the half that stops the next gap in
   * that table from flattering the number instead of showing up.
   */
  if (present.length === 0) {
    return { verdict: "unknown", deciding: [], unclassified };
  }

  const of = (support: FeatureSupport): string[] =>
    present.filter((name) => BY_FEATURE.get(name)?.support === support);

  const byDesign = of("unsupported-by-design");
  if (byDesign.length > 0) {
    return {
      verdict: "unsupported-by-design",
      deciding: byDesign,
      unclassified,
    };
  }
  const notYet = of("unsupported-not-yet-implemented");
  if (notYet.length > 0) {
    return {
      verdict: "unsupported-not-yet-implemented",
      deciding: notYet,
      unclassified,
    };
  }
  const adaptation = of("adaptation");
  if (adaptation.length > 0) {
    return {
      verdict: "representable-with-adaptation",
      deciding: adaptation,
      unclassified,
    };
  }
  return { verdict: "fully-representable", deciding: present, unclassified };
}
