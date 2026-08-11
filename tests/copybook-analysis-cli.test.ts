import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import type { CopybookDependencyGraph } from "../packages/migration-analysis/src/index";

function estate(): string {
  const root = mkdtempSync(join(tmpdir(), "bankc-copybook-graph-"));
  mkdirSync(join(root, "programs"), { recursive: true });
  mkdirSync(join(root, "copybooks", "nested"), { recursive: true });
  writeFileSync(
    join(root, "programs", "MAIN.cbl"),
    `       IDENTIFICATION DIVISION.
       PROGRAM-ID. MAIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       COPY COMMON.
       PROCEDURE DIVISION.
           STOP RUN.
`,
    "utf8",
  );
  writeFileSync(
    join(root, "copybooks", "COMMON.cpy"),
    `       COPY NESTED
           REPLACING ==TOKEN== BY ==VALUE==.
`,
    "utf8",
  );
  writeFileSync(
    join(root, "copybooks", "nested", "nested.cpy"),
    "       COPY COMMON.\n",
    "utf8",
  );
  return root;
}

describe("bankc analyse copybook dependencies", () => {
  it("writes stable Markdown and JSON beside the inventory", () => {
    const root = estate();
    const result = runBankc(
      ["analyse", "programs", "copybooks", "--out", "analysis"],
      root,
    );

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("copybook-dependencies.md");
    expect(result.stdout).toContain("copybook-dependencies.json");

    const inventory = readFileSync(
      join(root, "analysis", "inventory.md"),
      "utf8",
    );
    expect(inventory).toContain("## Copybook dependencies");
    expect(inventory).toContain("2 copybook member(s), 3 `COPY` reference(s)");
    expect(inventory).toContain("without expanding copybook content");

    const markdown = readFileSync(
      join(root, "analysis", "copybook-dependencies.md"),
      "utf8",
    );
    expect(markdown).toContain("# Copybook dependency graph");
    expect(markdown).toContain("```mermaid");

    const jsonPath = join(root, "analysis", "copybook-dependencies.json");
    const firstBytes = readFileSync(jsonPath, "utf8");
    const graph = JSON.parse(firstBytes) as CopybookDependencyGraph;
    expect(graph).toMatchObject({ schemaVersion: 1, semanticExpansion: false });
    expect(graph.nodes.filter((node) => node.kind === "copybook")).toHaveLength(
      2,
    );
    expect(graph.edges).toHaveLength(3);
    expect(
      graph.edges.filter((edge) => edge.status === "resolved"),
    ).toHaveLength(3);
    expect(graph.edges.some((edge) => edge.replacing)).toBe(true);
    expect(graph.cycles).toHaveLength(1);

    const rerun = runBankc(
      ["analyse", "copybooks", "programs", "--out", "analysis"],
      root,
    );
    expect(rerun.exitCode).toBe(0);
    expect(readFileSync(jsonPath, "utf8")).toBe(firstBytes);
  });

  it("deduplicates overlapping program paths", () => {
    const root = estate();
    const forward = runBankc(["analyse", ".", "programs/MAIN.cbl"], root);
    const reverse = runBankc(["analyse", "programs/MAIN.cbl", "."], root);

    expect(forward.exitCode).toBe(0);
    expect(forward.stdout).toContain("1 program(s)");
    expect(forward.stdout).toContain("3 `COPY` reference(s)");
    expect(reverse).toEqual(forward);
  });

  it("skips directory symlinks and copybooks without a member name", () => {
    const root = estate();
    const external = mkdtempSync(join(tmpdir(), "bankc-external-graph-"));
    writeFileSync(
      join(external, "OUTSIDE.cbl"),
      "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. OUTSIDE.\n",
      "utf8",
    );
    writeFileSync(join(external, "OUTSIDE.cpy"), "       COPY ABSENT.\n");
    writeFileSync(join(root, "copybooks", ".cpy"), "       COPY ABSENT.\n");
    symlinkSync(root, join(root, "self-loop"));
    symlinkSync(external, join(root, "external-directory"));

    const result = runBankc(["analyse", "."], root);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("1 program(s)");
    expect(result.stdout).toContain("2 copybook member(s)");
    expect(result.stdout).toContain("3 `COPY` reference(s)");
    expect(result.stdout).not.toContain("OUTSIDE");
  });

  it("reports a cycle as a sorted strongly connected group", () => {
    const root = mkdtempSync(join(tmpdir(), "bankc-cycle-summary-"));
    mkdirSync(join(root, "programs"), { recursive: true });
    mkdirSync(join(root, "copybooks"), { recursive: true });
    writeFileSync(
      join(root, "programs", "MAIN.cbl"),
      "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. MAIN.\n       COPY A.\n",
      "utf8",
    );
    writeFileSync(join(root, "copybooks", "A.cpy"), "       COPY C.\n");
    writeFileSync(join(root, "copybooks", "B.cpy"), "       COPY A.\n");
    writeFileSync(join(root, "copybooks", "C.cpy"), "       COPY B.\n");

    const result = runBankc(
      ["analyse", "programs", "copybooks", "--out", "analysis"],
      root,
    );
    const graph = JSON.parse(
      readFileSync(
        join(root, "analysis", "copybook-dependencies.json"),
        "utf8",
      ),
    ) as CopybookDependencyGraph;

    // The edge from A reaches C, but an SCC is a set rather than a traversal.
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "copybook:copybooks/A.cpy",
        targets: ["copybook:copybooks/C.cpy"],
      }),
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const inventory = readFileSync(
      join(root, "analysis", "inventory.md"),
      "utf8",
    );
    expect(inventory).toContain(
      "1 strongly connected dependency cycle group(s) found: " +
        "`copybook:copybooks/A.cpy`, `copybook:copybooks/B.cpy`, " +
        "`copybook:copybooks/C.cpy`.",
    );
    expect(inventory).not.toContain(" -> ");
  });

  it("renders unusual cycle paths as safe single-line code spans", () => {
    const root = mkdtempSync(join(tmpdir(), "bankc-cycle-code-span-"));
    const copybookDirectory = "copy`books\n\u0007branch";
    mkdirSync(join(root, "programs"), { recursive: true });
    mkdirSync(join(root, copybookDirectory), { recursive: true });
    writeFileSync(
      join(root, "programs", "MAIN.cbl"),
      "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. MAIN.\n       COPY A.\n",
      "utf8",
    );
    writeFileSync(
      join(root, copybookDirectory, "A.cpy"),
      "       COPY A.\n",
      "utf8",
    );

    const result = runBankc(["analyse", "programs", copybookDirectory], root);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain(
      "``copybook:copy`books\\n\\u{7}branch/A.cpy``",
    );
    expect(result.stdout).not.toContain("copy`books\n\u0007branch/A.cpy");
  });
});
