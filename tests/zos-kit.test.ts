import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildZosKit } from "../tools/zos-kit";

/**
 * The upload bundle, which nothing had ever run.
 *
 * `pnpm zos:kit` is the documented way to get every artifact onto a mainframe,
 * and it had stopped building: two examples that each declare a
 * `TransferRequest` of their own put two different records under one member
 * name, and the tool refused — correctly, and for every run, with no test to
 * notice. A command a document tells someone to run has to run.
 */

const ROOT = join(mkdtempSync(join(tmpdir(), "bankc-zos-")), "zos");
const KIT = buildZosKit(ROOT);

describe("the z/OS kit", () => {
  it("builds", () => {
    expect(KIT.members).toBeGreaterThan(0);
    expect(KIT.examples.length).toBeGreaterThan(0);
    expect(KIT.skipped).toEqual([]);
  });

  /**
   * These examples are independent programs rather than one application, and
   * several declare an `AccountRecord` of their own with different fields. One
   * flat library would ship one program's record under another program's name,
   * so each program's copybooks go to a library of its own — and two records
   * clashing *inside* one program is still refused.
   */
  it("gives each program its own copybook library", () => {
    const copybooks = readdirSync(join(ROOT, "copybooks"), {
      withFileTypes: true,
    });

    expect(copybooks.every((entry) => entry.isDirectory())).toBe(true);
    expect(copybooks.map((entry) => entry.name)).toContain("ACCOUNTF");
  });

  it("writes a manifest listing what shipped", () => {
    const manifest = readFileSync(join(ROOT, "MANIFEST.txt"), "utf8");

    for (const member of KIT.examples) {
      expect(manifest).toContain(`cobol/${member}`);
    }
  });

  /**
   * The zUnit case is the one artifact in the bundle nothing here has ever run,
   * which is what makes it the most valuable thing in it: a single real run
   * settles divergences D20 and D21.
   */
  it("carries the generated zUnit case and its configuration", () => {
    expect(readdirSync(join(ROOT, "bzucfg"))).toContain("TZUNITTE.txt");
    expect(readdirSync(join(ROOT, "cobol"))).toContain("TZUNITTE.txt");

    const manifest = readFileSync(join(ROOT, "MANIFEST.txt"), "utf8");
    expect(manifest).toContain("compiled with TEST");
    expect(manifest).toContain("EQAPPLAY");
  });
});
