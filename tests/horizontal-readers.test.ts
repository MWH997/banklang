import { describe, expect, it } from "vitest";

import {
  DEFECT_DEMONSTRATIONS,
  LockMismatchError,
  analyseFile,
  capOutput,
  demonstratedDefects,
  defectIdOf,
  familyOf,
  hashBytes,
  lockHash,
  looksLikeCobol,
  parseDefect,
  parseLock,
  safeJoin,
  sanitizedEnv,
  stableLockJson,
  summarise,
  supportGaps,
  UnsafePathError,
  verifyLock,
  EXTERNAL_OUTPUT_CAP,
  type CorpusAnalysis,
  type FileAnalysis,
  type LockedCorpus,
} from "../packages/horizontal-validation/src/index";
import {
  contentDigest,
  detectFeatures,
  featureNames,
  isFixedFormat,
  sourceLines,
} from "../packages/migration-analysis/src/features";

const ANALYSED: FileAnalysis = {
  path: "programs/A.cbl",
  sha256: hashBytes("A"),
  bytes: 1,
  provenance: "upstream/a",
  programId: "A",
  statementLines: 3,
  analysed: true,
  failure: null,
  features: { alter: 2, inspect: 1 },
  representability: "unsupported-not-yet-implemented",
  deciding: ["alter"],
};

const FAILED: FileAnalysis = {
  path: "programs/B.cob",
  sha256: hashBytes("B"),
  bytes: 1,
  provenance: null,
  programId: null,
  statementLines: 0,
  analysed: false,
  failure: "reader failed",
  features: { inspect: 3 },
  representability: "analyser-failure",
  deciding: [],
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("horizontal corpus readers", () => {
  it("recognises only program extensions, case-insensitively", () => {
    expect(looksLikeCobol("src/MAIN.CBL")).toBe(true);
    expect(looksLikeCobol("src/main.cobol")).toBe(true);
    expect(looksLikeCobol("src/main.ccp")).toBe(true);
    expect(looksLikeCobol("src/main.cpy")).toBe(false);
    expect(looksLikeCobol("src/main.cbl.bak")).toBe(false);
  });

  it("reads one COBOL member into a reproducible row", () => {
    const text = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SAMPLE.
       PROCEDURE DIVISION.
           ALTER OLD-PARA TO PROCEED TO NEW-PARA.
      * £ proves the byte count is not a character count.
`;
    expect(analyseFile("nested/SAMPLE.cbl", text, "repo/sample")).toMatchObject(
      {
        path: "nested/SAMPLE.cbl",
        sha256:
          "cdaa2621a67f7a6ca4b464d3921c7628e122756eb803490f664e17c2346dbd43",
        bytes: Buffer.byteLength(text, "utf8"),
        provenance: "repo/sample",
        programId: "SAMPLE",
        statementLines: 4,
        analysed: true,
        failure: null,
        features: { alter: 1 },
        representability: "unsupported-by-design",
        deciding: ["alter"],
      },
    );
  });

  it("derives every corpus total from its file rows", () => {
    expect(summarise("probe", [ANALYSED, FAILED])).toEqual({
      corpus: "probe",
      discovered: 2,
      analysed: 1,
      analyserFailures: 1,
      representability: {
        "fully-representable": 0,
        "representable-with-adaptation": 0,
        "unsupported-by-design": 0,
        "unsupported-not-yet-implemented": 1,
        "analyser-failure": 1,
        unknown: 0,
      },
      featureFiles: { alter: 1, inspect: 2 },
      featureLines: { alter: 2, inspect: 4 },
      files: [ANALYSED, FAILED],
    });
  });

  it("ranks implemented support gaps and omits supported and unknown rows", () => {
    const analysis: CorpusAnalysis = {
      ...summarise("probe", [ANALYSED, FAILED]),
      discovered: 4,
      featureFiles: {
        alter: 1,
        inspect: 2,
        mystery: 4,
        "copy-replacing": 3,
      },
    };
    const rows = supportGaps(analysis, (feature) =>
      feature === "alter"
        ? "unsupported-not-yet-implemented"
        : feature === "copy-replacing"
          ? "unsupported-by-design"
          : feature === "inspect"
            ? "supported"
            : null,
    );
    expect(rows).toEqual([
      {
        feature: "copy-replacing",
        support: "unsupported-by-design",
        files: 3,
        share: "75.0%",
      },
      {
        feature: "alter",
        support: "unsupported-not-yet-implemented",
        files: 1,
        share: "25.0%",
      },
    ]);

    const empty: CorpusAnalysis = {
      ...analysis,
      discovered: 0,
      featureFiles: { alter: 1 },
    };
    expect(supportGaps(empty, () => "unsupported-by-design")[0]?.share).toBe(
      "0%",
    );
  });
});

describe("OpenCBS defect readers", () => {
  const defectText = `      **** PROBLEM WITH DIVIDE BEFORE MULTIPLY ****
      **** (PRECISION LOST) ****
      **** BEFORE CODE BEGINS (PROBLEM)
      ****     COMPUTE X = 1
      ****
      **** BEFORE CODE ENDS (PROBLEM)
      **** AFTER CODE BEGINS (CORRECT)
       COMPUTE X = 2.
      **** AFTER CODE ENDS (CORRECT)
`;

  it("extracts a case id only from a defect member name", () => {
    expect(defectIdOf("df36test.cbl")).toBe("DF36");
    expect(defectIdOf("DF01.cob")).toBe("DF01");
    expect(defectIdOf("README.md")).toBeNull();
  });

  it("recovers the defective and corrected blocks exactly", () => {
    expect(parseDefect("DF36TEST.CBL", defectText)).toEqual({
      id: "DF36",
      program: "DF36TEST.CBL",
      title: "PROBLEM WITH DIVIDE BEFORE MULTIPLY",
      cause: "PRECISION LOST",
      before: ["          COMPUTE X = 1"],
      after: ["       COMPUTE X = 2."],
    });
    expect(parseDefect("notes.txt", defectText)).toBeNull();
    expect(parseDefect("DF99.cbl", "")).toEqual({
      id: "DF99",
      program: "DF99.cbl",
      title: "",
      cause: null,
      before: [],
      after: [],
    });
  });

  it("classifies a case from both its title and cause", () => {
    const numeric = parseDefect("DF36TEST.CBL", defectText)!;
    expect(familyOf(numeric)?.family).toBe("numeric-precision");
    expect(
      familyOf({ ...numeric, title: "UNKNOWN", cause: "PRECISION LOST" })
        ?.family,
    ).toBe("numeric-precision");
    expect(
      familyOf({ ...numeric, title: "DECIMAL POINT LOST", cause: null })
        ?.family,
    ).toBe("numeric-precision");
    expect(familyOf({ ...numeric, title: "UNKNOWN", cause: null })).toBeNull();
  });

  it("deduplicates and sorts the demonstrated case ids", () => {
    expect(
      DEFECT_DEMONSTRATIONS.filter((entry) => entry.defect === "DF01"),
    ).toHaveLength(2);
    expect(demonstratedDefects()).toEqual([
      "DF01",
      "DF06",
      "DF10",
      "DF15",
      "DF18",
      "DF19",
      "DF25",
      "DF26",
      "DF36",
      "DF42",
    ]);
  });
});

describe("corpus lock parsing", () => {
  const locked: LockedCorpus = {
    id: "probe",
    revision: "abc123",
    retrieved: "2026-08-11",
    licence: "MIT",
    files: [{ path: "A.cbl", sha256: hashBytes("abc"), bytes: 3 }],
  };

  it("reports missing, size-mismatched and hash-mismatched bytes separately", () => {
    expect(verifyLock(locked, new Map())).toEqual([
      "probe: A.cbl is locked and missing from the cache.",
    ]);
    expect(verifyLock(locked, new Map([["A.cbl", Buffer.from("ab")]]))).toEqual(
      ["probe: A.cbl is 2 bytes and the lock records 3."],
    );
    expect(
      verifyLock(locked, new Map([["A.cbl", Buffer.from("abd")]])),
    ).toEqual([
      `probe: A.cbl hashes to ${hashBytes("abd").slice(0, 12)} and the lock records ${hashBytes("abc").slice(0, 12)}.`,
    ]);
    expect(
      verifyLock(locked, new Map([["A.cbl", Buffer.from("abc")]])),
    ).toEqual([]);
  });

  it("hashes strings, bytes and canonical lock JSON to fixed digests", () => {
    expect(hashBytes("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashBytes(new Uint8Array([0, 255, 65]))).toBe(
      "a90a10503fbfc95789ff38a1bb5039cb71869ab9c0eb1cb51c4a9099f2933c6b",
    );
    expect(lockHash({ version: 1, corpora: [] })).toBe(
      "1ae96ba7964d101293424efff3de56be7a0e14819f16b9ab64a89a34112fb6a7",
    );
  });

  it("parses the supported lock shape and rejects each outer-shape error", () => {
    const valid = { version: 1 as const, corpora: [locked] };
    expect(parseLock(JSON.stringify(valid), "lock.json")).toEqual(valid);
    expect(() => parseLock("null", "lock.json")).toThrow(
      new LockMismatchError("lock.json: not a JSON object."),
    );
    expect(() => parseLock('{"version":2,"corpora":[]}', "lock.json")).toThrow(
      "lock version 2",
    );
    expect(() => parseLock('{"version":1,"corpora":{}}', "lock.json")).toThrow(
      "'corpora' must be an array",
    );
  });

  it("orders corpora and files in the serialized lock", () => {
    const alphaA = { ...locked.files[0]!, path: "A.cbl" };
    const alphaZ = { ...locked.files[0]!, path: "Z.cbl" };
    const second = { ...locked, id: "alpha", files: [alphaZ, alphaA] };
    const json = stableLockJson({ version: 1, corpora: [locked, second] });
    expect(json).toBe(
      `${JSON.stringify(
        {
          version: 1,
          corpora: [{ ...second, files: [alphaA, alphaZ] }, locked],
        },
        null,
        2,
      )}\n`,
    );
  });
});

describe("external-run containment", () => {
  it("keeps corpus paths inside their working root", () => {
    expect(safeJoin("/tmp/corpus", ".")).toBe("/tmp/corpus");
    expect(safeJoin("/tmp/corpus", "nested/../A.cbl")).toBe(
      "/tmp/corpus/A.cbl",
    );
    for (const candidate of [
      "/etc/passwd",
      "C:\\Windows\\system.ini",
      "../corpus-evil/member.cbl",
      "member\0.cbl",
    ]) {
      expect(() => safeJoin("/tmp/corpus", candidate)).toThrow(UnsafePathError);
    }
  });

  it("uses explicit safe defaults without inheriting unrelated variables", () => {
    const path = process.env.PATH;
    const home = process.env.HOME;
    const config = process.env.COB_CONFIG_DIR;
    const copy = process.env.COB_COPY_DIR;
    const library = process.env.LD_LIBRARY_PATH;
    try {
      process.env.PATH = "/safe/bin";
      process.env.HOME = "/safe/home";
      delete process.env.COB_CONFIG_DIR;
      delete process.env.COB_COPY_DIR;
      delete process.env.LD_LIBRARY_PATH;
      expect(sanitizedEnv()).toEqual({
        PATH: "/safe/bin",
        HOME: "/safe/home",
        LANG: "C",
        LC_ALL: "C",
      });

      delete process.env.PATH;
      delete process.env.HOME;
      process.env.COB_CONFIG_DIR = "/cob/config";
      process.env.COB_COPY_DIR = "/cob/copy";
      process.env.LD_LIBRARY_PATH = "/cob/lib";
      expect(sanitizedEnv({ BANKLANG_PROBE: "yes" })).toEqual({
        PATH: "/usr/bin:/bin",
        HOME: "/tmp",
        LANG: "C",
        LC_ALL: "C",
        COB_CONFIG_DIR: "/cob/config",
        COB_COPY_DIR: "/cob/copy",
        LD_LIBRARY_PATH: "/cob/lib",
        BANKLANG_PROBE: "yes",
      });
    } finally {
      restoreEnv("PATH", path);
      restoreEnv("HOME", home);
      restoreEnv("COB_CONFIG_DIR", config);
      restoreEnv("COB_COPY_DIR", copy);
      restoreEnv("LD_LIBRARY_PATH", library);
    }
  });

  it("returns bounded output unchanged and states every truncation", () => {
    const exact = "x".repeat(EXTERNAL_OUTPUT_CAP);
    expect(capOutput("short")).toBe("short");
    expect(capOutput(exact)).toBe(exact);
    expect(capOutput(`${exact}y`)).toBe(
      `${exact}\n[truncated at ${String(EXTERNAL_OUTPUT_CAP)} bytes by the horizontal validation harness]`,
    );
  });
});

describe("COBOL feature-reader primitives", () => {
  it("uses the indicator-column threshold, including its boundary", () => {
    expect(isFixedFormat([])).toBe(true);
    expect(
      isFixedFormat([
        "",
        "short",
        "      *A",
        "      /B",
        "      -C",
        "      DD",
        "ABCDEFGE",
      ]),
    ).toBe(true);
    expect(
      isFixedFormat(["short", "      *A", "      /B", "      -C", "ABCDEFGE"]),
    ).toBe(false);
  });

  it("removes both fixed and free comments before uppercasing", () => {
    expect(
      sourceLines(
        "      * fixed comment\n      / page eject\n       move a to b *> tail\n",
      ),
    ).toEqual(["", "", " MOVE A TO B ", ""]);
    expect(
      sourceLines(
        "identification division.\n  * free comment\nmove a to b *> tail",
      ),
    ).toEqual(["IDENTIFICATION DIVISION.", "", "MOVE A TO B "]);
    expect(sourceLines(`      -${"x".repeat(80)}`)).toEqual([
      `-${"X".repeat(65)}`,
    ]);
  });

  it("counts nonblank feature lines and returns stable names", () => {
    const counts = detectFeatures(
      "       01 A PIC S9(4) COMP.\n\n       01 B PIC S9(4) COMP.\n",
    );
    expect(counts["comp-binary"]).toBe(2);
    expect(detectFeatures("       MOVE A TO B MOVE C TO D.\n").move).toBe(1);
    expect(featureNames({ zeta: 1, alpha: 2 })).toEqual(["alpha", "zeta"]);
  });

  it("keeps the content digest stable at the empty and loop boundaries", () => {
    expect(contentDigest("")).toBe("811c9dc5");
    expect(contentDigest("a")).toBe("e40c292c");
    expect(contentDigest("ab")).toBe("4d2505ca");
  });
});
