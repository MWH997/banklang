/**
 * Reading the OpenCBS defect suite: what broke, and what the fix was.
 *
 * Each program in the suite carries its defect in a fixed shape, which is what
 * makes this deterministic rather than interpretive:
 *
 *     ****   PROBLEM WITH COMPUTE STATEMENT NOT ROUNDED PROPERLY    ****
 *     ****   (CAUSE OF ROUNDING ERROR IS DIVIDE BEFORE MULTIPLY)    ****
 *     ...
 *     **** BEFORE CODE BEGINS (PROBLEM)
 *     **** COMPUTE WS-AVERAGE-RATE ROUNDED = (WS-S1-VALUE
 *     ****     [DIVIDE AFTER MULTIPLY)     / (WS-S2-VALUE - 1.0)
 *     ****                                 * 100
 *     **** END-COMPUTE.
 *     **** BEFORE CODE ENDS (PROBLEM)
 *
 *     **** AFTER CODE BEGINS (CORRECT)
 *          COMPUTE WS-AVERAGE-RATE ROUNDED = (WS-S1-VALUE * 100)
 *                                          / (WS-S2-VALUE - 1.0)
 *          END-COMPUTE.
 *     **** AFTER CODE ENDS (CORRECT)
 *
 * The defective code is commented out and the corrected code is live, so the
 * file compiles as the fix. Both halves are recovered here.
 *
 * **What this file must not do.** It classifies defects into families; it does
 * not decide that BankLang prevents any of them. That claim requires a BankTS
 * program the compiler actually refuses, which lives in
 * `tests/horizontal-defects.test.ts` and is checked by running the compiler.
 * A defect with no such test is reported as `not-demonstrated`, however
 * obviously the language would catch it.
 */

export interface DefectCase {
  /** `DF36`, from the file name. */
  id: string;
  program: string;
  /** The banner's first line: what went wrong. */
  title: string;
  /** The banner's parenthesised line: why. */
  cause: string | null;
  /** The commented-out defective code, uncommented. Empty when none is marked. */
  before: string[];
  /** The live corrected code between the AFTER markers. */
  after: string[];
}

/** `DF36TEST.CBL` -> `DF36`. Null for a file that is not a defect program. */
export function defectIdOf(fileName: string): string | null {
  return /^(DF\d{2})/i.exec(fileName)?.[1]?.toUpperCase() ?? null;
}

/** True for a comment line in fixed reference format. */
function isComment(line: string): boolean {
  return line[6] === "*" || line[6] === "/";
}

/**
 * A comment line with its comment markers removed.
 *
 * The suite is inconsistent about how many asterisks it uses — `**** `, `*** `,
 * `*****` and `****` with no space all appear — so the leading run of asterisks
 * is stripped rather than a fixed prefix. The result is put back at column 8
 * so the recovered code is still reference format.
 */
function uncomment(line: string): string {
  const body = line.slice(6).replace(/^\*+ ?/, "");
  return `      ${body}`.replace(/\s+$/, "");
}

/**
 * One defect program, split into its parts.
 *
 * Marker matching is deliberately loose about spacing and about the
 * parenthesised suffix, because the suite writes `**** BEFORE CODE BEGINS
 * (PROBLEM)`, `****BEFORE CODE BEGINS` and `*** BEFORE CODE` in different
 * files. It is strict about `BEGINS` and `ENDS`, which every file has.
 */
export function parseDefect(fileName: string, text: string): DefectCase | null {
  const id = defectIdOf(fileName);
  if (!id) {
    return null;
  }
  const lines = text.split(/\r?\n/);

  const banner = lines
    .filter((line) => isComment(line) && /\*{3}/.test(line.slice(6)))
    .map((line) => line.slice(6).replace(/\*+/g, " ").trim())
    .filter((line) => line.length > 0 && !/^(BEFORE|AFTER) CODE/.test(line));

  const title = banner[0] ?? "";
  const cause = banner.find((line) => line.startsWith("(")) ?? null;

  const before: string[] = [];
  const after: string[] = [];
  let collecting: "before" | "after" | null = null;

  for (const line of lines) {
    const comment = isComment(line) ? line.slice(6) : "";
    if (/BEFORE\s+CODE\s+BEGINS/i.test(comment)) {
      collecting = "before";
      continue;
    }
    if (/AFTER\s+CODE\s+BEGINS/i.test(comment)) {
      collecting = "after";
      continue;
    }
    if (/(BEFORE|AFTER)\s+CODE\s+ENDS/i.test(comment)) {
      collecting = null;
      continue;
    }
    if (collecting === "before" && isComment(line)) {
      before.push(uncomment(line));
    } else if (collecting === "after" && !isComment(line)) {
      after.push(line.replace(/\s+$/, ""));
    }
  }

  return {
    id,
    program: fileName,
    title,
    cause: cause?.replace(/^\(|\)$/g, "").trim() ?? null,
    before: before.filter((line) => line.trim() !== ""),
    after: after.filter((line) => line.trim() !== ""),
  };
}

/**
 * The families a defect can belong to, and what BankLang says about each.
 *
 * A family is assigned by matching the defect's own words, so the mapping can
 * be checked against the corpus by anybody. `banklangPosition` is what the
 * language *claims*; whether the claim holds is settled by a test, never here.
 */
export interface DefectFamily {
  family: string;
  /** Matched against the title and cause, case-insensitively. */
  pattern: RegExp;
  /** The BankLang mechanism that bears on it, or null when none does. */
  mechanism: string | null;
  banklangPosition: string;
}

export const DEFECT_FAMILIES: DefectFamily[] = [
  {
    family: "numeric-precision",
    pattern: /ROUND|DIVIDE BEFORE MULTIPLY|PRECISION|DECIMAL POINT/i,
    mechanism: "scale tracking and mandatory `round(...)`",
    banklangPosition:
      "Every arithmetic expression carries a scale the typechecker computes, and storing a wider result into a narrower field without `round(value, scale, mode)` is a compile error rather than a silent truncation.",
  },
  {
    family: "numeric-class",
    pattern:
      /ALPHANUMERIC FIELD NOT CONVERT|CHARACTER (?:FIELD|INSTEAD)|NUMVAL|PACKED (?:DECIMAL|FIELD)|SOC7|S0C7/i,
    mechanism: "the type system",
    banklangPosition:
      "A `string<n>` and a `decimal<p,s>` are different types and neither moves into the other. The data exception these defects produce at run time is a type error at compile time.",
  },
  {
    family: "file-status",
    pattern:
      /VSAM STATUS|FILE STATUS|STATUS 92|END OF FILE CHECK|KSDS|REWRITE|RECORD SIZE CONFLICT/i,
    mechanism:
      "a declared file status, a mode the operation has to match, and a flow-sensitive check that its outcome was handled",
    banklangPosition:
      "A file must declare a status field (`BANK-FILE-001`) and an operation must match the mode the file was opened in, and reading an output file is refused. Since this phase it also has to be *looked at*.\n\nEvery generated I/O statement is followed by a test of the status, and anything outside class 0 stops the step. That covers the failures and deliberately does not cover the statuses a program is written to produce: end of file on a read, no such record on a keyed read or a browse, a duplicate key on a write to a KSDS. Those are the program's business, and a program that ignores one carries on with the record area still holding the record before it. `BANK-FILE-017` is the rule that says so: an operation that can end with one of those statuses leaves an outstanding outcome, and using the record it filled, operating on the file again (a close overwrites the status too) or reaching the end of the routine with it outstanding is an error. Comparing the status discharges it, wherever the comparison is written; a `log` of the status does not, because printing the answer is not reading it.\n\nThe rule is flow-sensitive, which is what the two earlier attempts were not. `read` then `if status` is safe and `if status` then `read` is not, and a check that flattens the statement list cannot tell them apart. The walk merges the state at each join, so a fact is discharged after a branch only when every path through it discharged the fact.\n\nMigration cost, measured before it shipped: two of this repository's forty-four programs, both genuine: `withdrawal-with-recovery` debited an account id of spaces when its request dataset was empty, and `statement-generation` produced a statement from whatever `master` held when the account was not on the file. Forty-five unit-test fixtures, all of them programs that read a file and ignored what happened, corrected by hand. The earlier measurement of 117 declarations with 95 unhandled counted *declarations*; this one counts operations and control flow, which is why the number is different and why this rule could ship where that one could not.",
  },
  {
    family: "table-bounds",
    pattern: /SEARCH|TABLE INDEX|SUBSCRIPT|ARRAY|OCCURS|MAXIMUM TABLE ENTRIES/i,
    mechanism: "subscript bounds checking",
    banklangPosition:
      "Array access is bounds-checked, and an index is an expression over the array rather than a separately declared register that can drift from it.",
  },
  {
    family: "name-resolution",
    pattern: /NOT UNIQUELY DEFINED|QUALIF|MULTI-DEFINED/i,
    mechanism: "lexical scoping",
    banklangPosition:
      "Field names are resolved through the record that holds them, so the ambiguity these defects are about cannot be written.",
  },
  {
    family: "sql-handling",
    pattern: /CURSOR|SQLSTATE|SQLCODE|HOST VARIABLE|FETCH/i,
    mechanism: "SQLCODE handling and cursor lifecycle",
    banklangPosition:
      "A cursor is opened, fetched and closed as one construct, and an unchecked SQLCODE is a compile error.",
  },
  {
    family: "pointer-and-linkage",
    pattern: /POINTER|ADDRESS|LINKAGE PARAMETER|SOC-4|S0C4/i,
    mechanism: "the absence of a pointer type",
    banklangPosition:
      "BankTS has no pointer type and no address arithmetic, so this class of defect cannot be expressed. Prevention here is trivial rather than clever, and is reported as such.",
  },
  {
    family: "control-flow",
    pattern: /INNER IF|OUTER IF|EVALUATE|NESTED IF|SET .* TO FALSE/i,
    mechanism: "structured control flow",
    banklangPosition:
      "Conditionals are blocks with explicit ends, so an `IF` cannot fall into the wrong branch of an enclosing one.",
  },
  {
    family: "string-handling",
    pattern: /UNSTRING|STRING|QUOTE|CSV/i,
    mechanism: "partial: `split` covers the common UNSTRING",
    banklangPosition:
      "`split` covers delimited parsing; STRING's `POINTER` and `OVERFLOW` machinery has no BankTS equivalent, so some of these defects are outside what the language expresses at all.",
  },
  {
    family: "date-handling",
    pattern: /GREGORIAN|INTEGER-OF-DATE|INVALID DATE/i,
    mechanism: "`date` as a distinct type",
    banklangPosition:
      "A date is its own type stored as `PIC 9(8)` YYYYMMDD, not a group with subordinate fields, and date arithmetic goes through builtins that lower to the COBOL intrinsics. The shape these defects rely on (a date group that is numeric from one angle and not from another) is not expressible.",
  },
  {
    family: "group-item-semantics",
    pattern: /GROUP LEVEL|RIGHT-ADJUST|OVERLAPPING OF DATA/i,
    mechanism: "typed assignment and comparison",
    banklangPosition:
      "Assignment and comparison are between typed fields. A group item is not silently treated as a character string, which is what makes the alphanumeric comparison in these defects give an answer nobody expected.",
  },
  {
    family: "condition-name-coverage",
    pattern: /88 LEVEL/i,
    mechanism: "closed `enum` types",
    banklangPosition:
      "An enum is closed and its members generate the condition names, so a value outside the declared set is a type error rather than a case no condition name matches.",
  },
  {
    family: "record-lifetime",
    pattern:
      /RECORD DATA NO LONGER AVAILABLE|INITIALIZATION USING OUTPUT RECORD/i,
    // Deliberately null. Whether BankLang models the record area as undefined
    // after a WRITE is a question the compiler answers, not this table, and
    // until a test settles it the matrix must say `not-demonstrated`.
    mechanism: null,
    banklangPosition:
      "COBOL leaves an FD's record area undefined after a WRITE, and reading it back is what this defect does. Whether BankLang refuses that is settled by `tests/horizontal-defects.test.ts` rather than asserted here.",
  },
  {
    family: "compiler-and-environment",
    pattern:
      /COMPILE ERROR|COMPILATION ERROR|COMPILER OPTION|COLUMN 7|FASTSRT|DISPLAY/i,
    mechanism: null,
    banklangPosition:
      "These are defects in how COBOL source is written or compiled. BankTS generates the COBOL, so the specific mistake is unavailable, but that is a consequence of code generation rather than a safety property, and it is not counted as one.",
  },
];

/** The family a defect belongs to, from its own description. */
export function familyOf(defect: DefectCase): DefectFamily | null {
  const text = `${defect.title} ${defect.cause ?? ""}`;
  return DEFECT_FAMILIES.find((family) => family.pattern.test(text)) ?? null;
}

/**
 * What this repository has actually shown about a defect.
 *
 * `prevented-at-compile-time` requires a named test. Nothing else may claim it.
 */
export type DefectCoverage =
  | "prevented-at-compile-time"
  | "not-expressible-in-bankts"
  | "outside-banklang-model"
  | "not-demonstrated";
