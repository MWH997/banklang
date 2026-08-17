import { describe, expect, it } from "vitest";

import {
  allocateDdNames,
  ddBase,
  ddCandidate,
  ddEndsCandidate,
  isLegalDdName,
} from "../packages/horizontal-validation/src/dd-names";

/**
 * The DD-name allocator, against the case that broke it.
 *
 * A COBOL file is reached through a DD name of one to eight alphanumeric
 * characters, and a benchmark names its files like a Unix program. The first
 * mapping between them truncated each name on its own, which is how nineteen of
 * CobolCodeBench's forty-six tasks became unrunnable: `taskfunc` is exactly
 * eight characters, so `task_func03_inp`, `task_func03_out1` and
 * `task_func03_out2` all truncated to `TASKFUNC` and the three files of a task
 * became one file.
 *
 * So the property under test is not "produces a legal name". It is "produces
 * *distinct* legal names for a set", which is a property of the set and cannot
 * be tested one name at a time, which is exactly why the defect existed.
 */

describe("reducing a logical name", () => {
  it("keeps only the characters a DD name may hold", () => {
    expect(ddBase("task_func03_out1")).toBe("TASKFUNC03OUT1");
    expect(ddBase("input.txt")).toBe("INPUTTXT");
    expect(ddBase("a-b_c.d")).toBe("ABCD");
  });

  it("reduces punctuation and non-ASCII to nothing rather than throwing", () => {
    expect(ddBase("___")).toBe("");
    expect(ddBase("données")).toBe("DONNES");
    expect(ddBase("日本語")).toBe("");
  });

  it("takes the first eight characters as the plain form", () => {
    expect(ddCandidate("OUTPUTTXT")).toBe("OUTPUTTX");
    expect(ddCandidate("SHORT")).toBe("SHORT");
    expect(ddCandidate("EXACTLY8")).toBe("EXACTLY8");
  });

  it("keeps both ends when the plain form is not enough", () => {
    // `TASKFUNC`, the head alone, is the same for every file of a task.
    expect(ddEndsCandidate("TASKFUNC03OUT1")).toBe("TASKOUT1");
    expect(ddEndsCandidate("TASKFUNC03INP")).toBe("TASK3INP");
  });
});

describe("allocating a set of DD names", () => {
  it("separates the three files that used to collapse into one", () => {
    const names = allocateDdNames([
      "task_func03_inp",
      "task_func03_out1",
      "task_func03_out2",
    ]);
    const values = [...names.values()];
    expect(new Set(values).size).toBe(3);
    for (const value of values) {
      expect(isLegalDdName(value), value).toBe(true);
    }
  });

  it("gives every task in the corpus's naming style distinct names", () => {
    // The whole shape that broke: a shared ten-character prefix and a short
    // discriminating tail.
    const names = allocateDdNames([
      "task_func24_inp1",
      "task_func24_inp2",
      "task_func24_out",
    ]);
    expect(new Set(names.values()).size).toBe(3);
  });

  it("resolves more than two collisions", () => {
    const names = allocateDdNames([
      "prefixaaaaaaaa1",
      "prefixaaaaaaaa2",
      "prefixaaaaaaaa3",
      "prefixaaaaaaaa4",
      "prefixaaaaaaaa5",
    ]);
    expect(new Set(names.values()).size).toBe(5);
    for (const value of names.values()) {
      expect(isLegalDdName(value), value).toBe(true);
    }
  });

  it("resolves a group larger than the single-digit counter", () => {
    // The suffix is base-36, so a group of forty still fits, and the first
    // thirty-six in one character and the rest in two.
    const many = Array.from(
      { length: 40 },
      (_, index) => `sameprefixhere${index}`,
    );
    const names = allocateDdNames(many);
    expect(new Set(names.values()).size).toBe(40);
    for (const value of names.values()) {
      expect(isLegalDdName(value), value).toBe(true);
    }
  });

  it("separates names that differ only in punctuation or case", () => {
    const names = allocateDdNames(["report-out", "report_out", "REPORT.OUT"]);
    // All three reduce to the same base, so all three have to be counted apart.
    expect(new Set(names.values()).size).toBe(3);
  });

  it("gives a name to something that reduces to nothing", () => {
    const names = allocateDdNames(["___", "日本語", "!!!"]);
    expect(new Set(names.values()).size).toBe(3);
    for (const value of names.values()) {
      expect(isLegalDdName(value), value).toBe(true);
    }
  });

  it("treats a duplicate logical name as one file", () => {
    const names = allocateDdNames(["input.txt", "input.txt"]);
    expect(names.size).toBe(1);
  });

  it("leaves an uncontested name on its plain first eight characters", () => {
    // The property that makes adding this allocator a no-op for every task
    // that was already working: `output.txt` was `OUTPUTTX` and stays so.
    expect(allocateDdNames(["input.txt", "output.txt"]).get("output.txt")).toBe(
      "OUTPUTTX",
    );
  });

  it("does not disturb a name that never collided", () => {
    // A file whose candidate is unique keeps it, so adding a colliding pair
    // elsewhere in the task does not rename the one file that was fine.
    const alone = allocateDdNames(["ledger.dat"]);
    const crowded = allocateDdNames([
      "ledger.dat",
      "task_func03_out1",
      "task_func03_out2",
    ]);
    expect(crowded.get("ledger.dat")).toBe(alone.get("ledger.dat"));
  });

  it("depends on the set and not on the order it was given in", () => {
    /*
     * The property the harness actually needs. The caller reads these names out
     * of a JSON object, and a benchmark that reordered its keys must not
     * silently change which file a DD points at, because that would move a
     * measurement without moving the corpus.
     */
    const forwards = allocateDdNames([
      "task_func15_inp1",
      "task_func15_inp2",
      "task_func15_out",
    ]);
    const backwards = allocateDdNames([
      "task_func15_out",
      "task_func15_inp2",
      "task_func15_inp1",
    ]);
    expect([...backwards.entries()].sort()).toEqual(
      [...forwards.entries()].sort(),
    );
  });

  it("gives the same answer every time it is asked", () => {
    const once = allocateDdNames(["a_very_long_one", "a_very_long_two"]);
    const twice = allocateDdNames(["a_very_long_one", "a_very_long_two"]);
    expect([...twice.entries()]).toEqual([...once.entries()]);
  });

  it("produces a legal DD name for every corpus file name shape", () => {
    const shapes = [
      "input.txt",
      "output.txt",
      "match_data.ps",
      "updated_match_data.ps",
      "task_func23_inp",
      "output-marks.txt",
      "original_data.txt",
      "M3input.ps",
      "9leading-digit",
    ];
    const names = allocateDdNames(shapes);
    expect(names.size).toBe(shapes.length);
    for (const [logical, dd] of names) {
      expect(isLegalDdName(dd), `${logical} -> ${dd}`).toBe(true);
    }
  });
});
