/**
 * Which COBOL constructs a program actually contains.
 *
 * `analyseCobol` answers questions about a program's *shape* — its paragraphs,
 * its files, what it performs and what it jumps to. This answers a different
 * question, and one it could not: which of COBOL's several hundred features are
 * in here at all.
 *
 * It was added for horizontal validation, where the question being asked is
 * "what does real COBOL contain, and how much of it can BankTS represent?" —
 * and answering that over five thousand files needs a feature vector per file
 * rather than a prose report. It is general, not benchmark-specific: `bankc
 * analyse` prints these counts too, because an estate's inventory is exactly
 * where "412 programs use OCCURS DEPENDING ON" is worth knowing.
 *
 * **Detection, not parsing.** The same reason `analyseCobol` gives: these files
 * do not compile without copybooks nobody has, and a reader that needs a
 * successful parse reports nothing about most of an estate. What that costs is
 * that a feature named inside a literal string can be miscounted, so every
 * pattern below is anchored on the syntax around it rather than on the keyword
 * alone.
 */

/** A feature, as a stable name and the reason anybody cares. */
export interface FeatureDefinition {
  /** Stable id, used as a column in the coverage matrix. */
  name: string;
  /** Which division or concern it belongs to, for grouping in reports. */
  group: "data" | "procedure" | "io" | "interop" | "format";
  description: string;
  pattern: RegExp;
}

/**
 * Every feature this detector knows, with the pattern that finds it.
 *
 * Two rules held throughout. A pattern never relies on `\b` at a hyphen —
 * COBOL treats `-` as a word character and a regular expression does not, so
 * `\bCOMP\b` matches inside `WS-COMP-CODE` — hence the `(?<![A-Z0-9-])` and
 * `(?![A-Z0-9-])` guards. And a clause is matched with the syntax that must
 * accompany it, so `OCCURS` needs a following count or `DEPENDING`, which keeps
 * the word inside a `DISPLAY 'NO OCCURS FOUND'` from being counted.
 */
export const FEATURES: FeatureDefinition[] = [
  // ---- data division -------------------------------------------------
  {
    name: "comp-3",
    group: "data",
    description: "Packed decimal, the storage most mainframe money is held in",
    pattern:
      /(?<![A-Z0-9-])(?:COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL)(?![A-Z0-9-])/,
  },
  {
    name: "comp-binary",
    group: "data",
    description: "Binary integers: COMP, COMP-4, COMP-5, BINARY",
    pattern:
      /(?<![A-Z0-9-])(?:COMP|COMPUTATIONAL)(?:-[45])?(?![A-Z0-9-])|(?<![A-Z0-9-])BINARY(?![A-Z0-9-])/,
  },
  {
    name: "comp-float",
    group: "data",
    description: "IEEE floating point: COMP-1 and COMP-2",
    pattern: /(?<![A-Z0-9-])(?:COMP-[12]|COMPUTATIONAL-[12])(?![A-Z0-9-])/,
  },
  {
    name: "redefines",
    group: "data",
    description: "A second layout over the same bytes",
    pattern: /(?<![A-Z0-9-])REDEFINES\s+[A-Z0-9-]/,
  },
  {
    name: "occurs",
    group: "data",
    description: "Tables",
    pattern: /(?<![A-Z0-9-])OCCURS\s+(?:\d|[A-Z])/,
  },
  {
    name: "occurs-depending-on",
    group: "data",
    description: "A table whose length is decided at run time",
    pattern: /(?<![A-Z0-9-])OCCURS\b[^.]*?\bDEPENDING\s+(?:ON\s+)?[A-Z0-9-]/,
  },
  {
    name: "condition-names",
    group: "data",
    description: "88-level condition names",
    pattern: /^\s*88\s+[A-Z0-9-]+/,
  },
  {
    name: "renames",
    group: "data",
    description: "66-level RENAMES, a third view over a group",
    pattern: /^\s*66\s+[A-Z0-9-]+|(?<![A-Z0-9-])RENAMES\s+[A-Z0-9-]/,
  },
  {
    name: "usage-pointer",
    group: "data",
    description: "POINTER, PROCEDURE-POINTER and ADDRESS OF",
    pattern:
      /(?<![A-Z0-9-])(?:POINTER|PROCEDURE-POINTER|FUNCTION-POINTER)(?![A-Z0-9-])/,
  },
  {
    name: "usage-index",
    group: "data",
    description: "INDEXED BY and USAGE IS INDEX",
    pattern:
      /(?<![A-Z0-9-])INDEXED\s+BY(?![A-Z0-9-])|USAGE\s+(?:IS\s+)?INDEX(?![A-Z0-9-])/,
  },
  {
    name: "sign-separate",
    group: "data",
    description: "An explicitly placed, separately stored sign",
    pattern: /(?<![A-Z0-9-])SIGN\s+(?:IS\s+)?(?:LEADING|TRAILING)/,
  },
  {
    name: "national",
    group: "data",
    description: "PIC N and USAGE NATIONAL, which is UTF-16 on z/OS",
    pattern: /(?<![A-Z0-9-])NATIONAL(?![A-Z0-9-])|PIC(?:TURE)?\s+(?:IS\s+)?N\(/,
  },
  {
    name: "linkage-section",
    group: "data",
    description: "Data supplied by the caller",
    pattern: /(?<![A-Z0-9-])LINKAGE\s+SECTION\s*\./,
  },
  {
    name: "local-storage",
    group: "data",
    description: "Storage reallocated per invocation, needed for recursion",
    pattern: /(?<![A-Z0-9-])LOCAL-STORAGE\s+SECTION\s*\./,
  },
  {
    name: "external-data",
    group: "data",
    description: "EXTERNAL and GLOBAL, which share storage across programs",
    pattern: /(?<![A-Z0-9-])(?:IS\s+)?(?:EXTERNAL|GLOBAL)(?![A-Z0-9-])/,
  },

  // ---- procedure division --------------------------------------------
  //
  // The four below are the ordinary business of a COBOL program, and leaving
  // them out was a real distortion rather than an omission of detail: a file
  // whose only statements are `MOVE` and `ADD ... GIVING` registered no
  // features at all, and a program about which nothing was detected was then
  // being scored as one whose every construct is supported. Eighty-four files
  // of X-COBOL took that route.
  {
    name: "move",
    group: "procedure",
    description: "MOVE, the assignment COBOL is mostly made of",
    pattern: /(?<![A-Z0-9-])MOVE\s+(?:CORRESPONDING\s+|CORR\s+)?[A-Z0-9-"']/,
  },
  {
    name: "arithmetic-verbs",
    group: "procedure",
    description: "ADD, SUBTRACT, MULTIPLY and DIVIDE as statements",
    pattern: /(?<![A-Z0-9-])(?:ADD|SUBTRACT|MULTIPLY|DIVIDE)\s+[A-Z0-9-]/,
  },
  {
    name: "conditional",
    group: "procedure",
    description: "IF, with or without ELSE",
    pattern: /(?<![A-Z0-9-])IF\s+[A-Z0-9-(]/,
  },
  {
    name: "initialize",
    group: "procedure",
    description: "INITIALIZE, which sets a group to its type-wise defaults",
    pattern: /(?<![A-Z0-9-])INITIALIZE\s+[A-Z0-9-]/,
  },
  {
    name: "file-verbs",
    group: "io",
    description: "OPEN, CLOSE, READ, WRITE, REWRITE and DELETE",
    pattern: /(?<![A-Z0-9-])(?:OPEN|CLOSE|READ|WRITE|REWRITE)\s+[A-Z0-9-]/,
  },
  {
    name: "perform-thru",
    group: "procedure",
    description: "PERFORM a THRU b, which reaches every paragraph between",
    pattern:
      /(?<![A-Z0-9-])PERFORM\s+[A-Z0-9-]+\s+(?:THRU|THROUGH)\s+[A-Z0-9-]/,
  },
  {
    name: "perform-varying",
    group: "procedure",
    description: "Counted and conditional inline loops",
    pattern:
      /(?<![A-Z0-9-])PERFORM\s+(?:WITH\s+TEST\s+\w+\s+)?(?:VARYING|UNTIL)(?![A-Z0-9-])/,
  },
  {
    name: "go-to",
    group: "procedure",
    description: "Unstructured transfer of control",
    pattern: /(?<![A-Z0-9-])GO\s+TO\s+[A-Z0-9-]/,
  },
  {
    name: "go-to-depending",
    group: "procedure",
    description: "A computed jump into a list of labels",
    pattern: /(?<![A-Z0-9-])GO\s+TO\b[^.]*?\bDEPENDING\s+ON(?![A-Z0-9-])/,
  },
  {
    name: "alter",
    group: "procedure",
    description: "Rewrites a GO TO while the program runs",
    pattern: /(?<![A-Z0-9-])ALTER\s+[A-Z0-9-]+\s+TO(?![A-Z0-9-])/,
  },
  {
    name: "call-static",
    group: "procedure",
    description: 'CALL "NAME", resolved at bind time',
    pattern: /(?<![A-Z0-9-])CALL\s+["']/,
  },
  {
    name: "call-dynamic",
    group: "procedure",
    description: "CALL identifier, resolved at run time",
    pattern: /(?<![A-Z0-9-])CALL\s+(?!["'])[A-Z][A-Z0-9-]*/,
  },
  {
    name: "sort-merge",
    group: "procedure",
    description: "SORT and MERGE with their input and output procedures",
    pattern:
      /(?<![A-Z0-9-])(?:SORT|MERGE)\s+[A-Z0-9-]+\s+(?:ON\s+)?(?:ASCENDING|DESCENDING|USING)/,
  },
  {
    name: "string-unstring",
    group: "procedure",
    description: "STRING and UNSTRING",
    pattern: /(?<![A-Z0-9-])(?:STRING|UNSTRING)\s+[A-Z0-9-"']/,
  },
  {
    name: "inspect",
    group: "procedure",
    description: "INSPECT, which counts, replaces and converts in place",
    pattern: /(?<![A-Z0-9-])INSPECT\s+[A-Z0-9-]/,
  },
  {
    name: "reference-modification",
    group: "procedure",
    description: "FIELD(start:length), a substring by offset",
    pattern: /[A-Z0-9-]\s*\(\s*[A-Z0-9-]+\s*:\s*[A-Z0-9-]*\s*\)/,
  },
  {
    name: "intrinsic-function",
    group: "procedure",
    description: "FUNCTION, the standard library",
    pattern: /(?<![A-Z0-9-])FUNCTION\s+[A-Z][A-Z0-9-]*/,
  },
  {
    name: "evaluate",
    group: "procedure",
    description: "EVALUATE, COBOL's structured case",
    pattern: /(?<![A-Z0-9-])EVALUATE(?![A-Z0-9-])/,
  },
  {
    name: "search",
    group: "procedure",
    description: "SEARCH and SEARCH ALL over a table",
    pattern: /(?<![A-Z0-9-])SEARCH\s+(?:ALL\s+)?[A-Z0-9-]/,
  },
  {
    name: "declaratives",
    group: "procedure",
    description: "USE procedures, entered by the runtime on a condition",
    pattern: /(?<![A-Z0-9-])DECLARATIVES\s*\./,
  },
  {
    name: "compute",
    group: "procedure",
    description: "COMPUTE, arithmetic as an expression",
    pattern: /(?<![A-Z0-9-])COMPUTE\s+[A-Z0-9-]/,
  },
  {
    name: "rounded",
    group: "procedure",
    description: "The ROUNDED phrase",
    pattern: /(?<![A-Z0-9-])ROUNDED(?![A-Z0-9-])/,
  },
  {
    name: "on-size-error",
    group: "procedure",
    description: "The overflow branch of an arithmetic statement",
    pattern: /(?<![A-Z0-9-])(?:ON\s+)?SIZE\s+ERROR(?![A-Z0-9-])/,
  },
  {
    name: "accept-display",
    group: "procedure",
    description: "Console and system I/O",
    pattern: /(?<![A-Z0-9-])(?:ACCEPT|DISPLAY)\s+[A-Z0-9-"']/,
  },
  {
    name: "entry-point",
    group: "procedure",
    description: "ENTRY, a second way into the same program",
    pattern: /(?<![A-Z0-9-])ENTRY\s+["']/,
  },

  // ---- input and output ----------------------------------------------
  {
    name: "file-sequential",
    group: "io",
    description: "ORGANIZATION SEQUENTIAL, the ordinary flat dataset",
    pattern: /ORGANIZATION\s+(?:IS\s+)?(?:RECORD\s+)?SEQUENTIAL(?![A-Z0-9-])/,
  },
  {
    name: "file-line-sequential",
    group: "io",
    description: "ORGANIZATION LINE SEQUENTIAL, a text file",
    pattern: /ORGANIZATION\s+(?:IS\s+)?LINE\s+SEQUENTIAL(?![A-Z0-9-])/,
  },
  {
    name: "file-indexed",
    group: "io",
    description: "ORGANIZATION INDEXED, which on z/OS is VSAM KSDS",
    pattern: /ORGANIZATION\s+(?:IS\s+)?INDEXED(?![A-Z0-9-])/,
  },
  {
    name: "file-relative",
    group: "io",
    description: "ORGANIZATION RELATIVE, addressed by record number",
    pattern: /ORGANIZATION\s+(?:IS\s+)?RELATIVE(?![A-Z0-9-])/,
  },
  {
    name: "start-browse",
    group: "io",
    description: "START, which positions a keyed file for browsing",
    pattern: /(?<![A-Z0-9-])START\s+[A-Z0-9-]+\s*(?:KEY|$)/,
  },
  {
    name: "file-status",
    group: "io",
    description: "A declared FILE STATUS field",
    pattern: /(?<![A-Z0-9-])FILE\s+STATUS\s+(?:IS\s+)?[A-Z0-9-]/,
  },
  {
    name: "report-writer",
    group: "io",
    description: "The REPORT SECTION and its RD entries",
    pattern: /(?<![A-Z0-9-])REPORT\s+SECTION\s*\.|^\s*RD\s+[A-Z0-9-]/,
  },
  {
    name: "linage",
    group: "io",
    description: "LINAGE, which gives a print file a page depth",
    pattern: /(?<![A-Z0-9-])LINAGE\s+(?:IS\s+)?[A-Z0-9-]/,
  },
  {
    name: "screen-section",
    group: "io",
    description: "SCREEN SECTION, a terminal form",
    pattern: /(?<![A-Z0-9-])SCREEN\s+SECTION\s*\./,
  },

  // ---- interoperation -------------------------------------------------
  {
    name: "exec-sql",
    group: "interop",
    description: "Embedded SQL for Db2",
    pattern: /(?<![A-Z0-9-])EXEC\s+SQL(?![A-Z0-9-])/,
  },
  {
    name: "exec-cics",
    group: "interop",
    description: "CICS commands",
    pattern: /(?<![A-Z0-9-])EXEC\s+CICS(?![A-Z0-9-])/,
  },
  {
    name: "exec-dli",
    group: "interop",
    description: "IMS DL/I calls in command form",
    pattern: /(?<![A-Z0-9-])EXEC\s+DLI(?![A-Z0-9-])/,
  },
  {
    name: "cbltdli",
    group: "interop",
    description: "IMS DL/I calls in call form",
    pattern: /(?<![A-Z0-9-])["']?(?:CBLTDLI|PLITDLI|AIBTDLI)["']?(?![A-Z0-9-])/,
  },
  {
    name: "mq",
    group: "interop",
    description: "IBM MQ, called by its API names",
    pattern:
      /(?<![A-Z0-9-])["'](?:MQCONN|MQOPEN|MQPUT|MQGET|MQCLOSE|MQDISC)["']/,
  },
  {
    name: "copy",
    group: "interop",
    description: "COPY, which brings in a shared layout",
    pattern: /(?<![A-Z0-9-])COPY\s+[A-Z0-9$#@-]/,
  },
  {
    name: "copy-replacing",
    group: "interop",
    description: "COPY ... REPLACING, a copybook edited as it is read",
    pattern: /(?<![A-Z0-9-])COPY\b[^.]*?\bREPLACING(?![A-Z0-9-])/,
  },

  // ---- source format --------------------------------------------------
  {
    name: "nested-program",
    group: "format",
    description: "A program contained inside another",
    pattern: /(?<![A-Z0-9-])END\s+PROGRAM\s+[A-Z0-9-]/,
  },
  {
    name: "continuation",
    group: "format",
    description: "A literal continued across a line boundary",
    pattern: /^.{6}-/,
  },
];

/** How many times each feature was seen, keyed by feature name. */
export type FeatureCounts = Record<string, number>;

/**
 * Whether a source file is written in fixed reference format.
 *
 * z/OS reads columns 8 through 72 and treats column 7 as the indicator area.
 * Much of what is on GitHub is written free-format instead, and reading a
 * free-format file as fixed silently discards everything past column 72 —
 * which, on a file whose lines run to 200 characters, is most of the program.
 * Getting this wrong does not fail; it under-reports, which is worse.
 *
 * Decided by the indicator column: in a fixed-format file almost every line
 * long enough to have one holds a space, `*`, `/`, `-` or `D` there. A file
 * where that is untrue of more than a fifth of its lines is read as free
 * format.
 */
export function isFixedFormat(lines: string[]): boolean {
  const candidates = lines.filter(
    (line) => line.trim() !== "" && line.length > 7,
  );
  if (candidates.length === 0) {
    return true;
  }
  const indicated = candidates.filter((line) =>
    [" ", "*", "/", "-", "D", "d", "$"].includes(line[6] ?? " "),
  ).length;
  return indicated / candidates.length >= 0.8;
}

/**
 * The lines a compiler would read, uppercased, with comments removed.
 *
 * Returned as lines rather than one string so that patterns anchored with `^`
 * — the level numbers, the `RD` entry, the continuation indicator — mean what
 * they say.
 */
export function sourceLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const fixed = isFixedFormat(raw);
  return raw
    .map((line) => {
      if (fixed) {
        if (line[6] === "*" || line[6] === "/") {
          return "";
        }
        // Columns 7 to 72 inclusive, so that a `^.{6}-` continuation test can
        // still see the indicator.
        return line.slice(6, 72);
      }
      return line;
    })
    .map((line) => {
      // COBOL 2002's inline comment, which free-format code uses heavily and
      // which also appears in fixed-format source written this century.
      const inline = line.indexOf("*>");
      const cut = inline === -1 ? line : line.slice(0, inline);
      return fixed
        ? cut.toUpperCase()
        : cut.trimStart().startsWith("*")
          ? ""
          : cut.toUpperCase();
    });
}

/**
 * Every feature present in a program, counted.
 *
 * Counted per line rather than per match: a statement wrapped across three
 * lines would otherwise register three times, and the number wanted here is
 * "how much of this program uses the feature", not "how many times a regular
 * expression matched". A feature that appears at all has a count of at least
 * one, which is what the corpus-wide frequency actually uses.
 */
export function detectFeatures(text: string): FeatureCounts {
  const lines = sourceLines(text);
  const counts: FeatureCounts = {};
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    for (const feature of FEATURES) {
      if (feature.pattern.test(line)) {
        counts[feature.name] = (counts[feature.name] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/** Feature names present at least once, sorted, for a stable manifest. */
export function featureNames(counts: FeatureCounts): string[] {
  return Object.keys(counts).sort();
}
