import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The documentation, checked rather than trusted.
 *
 * The 2026-08-05 audit's §6 found three structural problems: no read-this-first
 * path, the honest-limits section buried at the bottom of a 16 KB README, and
 * nothing addressed to the person who has to accept the generated COBOL. Those
 * are fixed by writing; what a test can do is keep them fixed.
 *
 * A dead link is the failure that creeps back. `docs/glossary.md` pointed at
 * `language-spec.md` and `banking-safety-spec.md`, neither of which has existed
 * for a long time, and four evidence bundles pointed at a `tester-notes/`
 * directory that was removed.
 */

/** Every Markdown file in the repository, excluding dependencies. */
function markdownFiles(root: string, base = root): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      return [];
    }
    const path = join(root, entry.name);
    if (statSync(path).isDirectory()) {
      return markdownFiles(path, base);
    }
    return entry.name.endsWith(".md") ? [relative(base, path)] : [];
  });
}

/** Relative links in one file, with the anchor stripped. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith("<"));
}

const FILES = markdownFiles(process.cwd());

describe("every link in every document", () => {
  it("points at something that exists", () => {
    const broken: string[] = [];

    for (const file of FILES) {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const target of relativeLinks(text)) {
        const resolved = normalize(
          join(dirname(resolve(process.cwd(), file)), target),
        );
        try {
          statSync(resolved);
        } catch {
          broken.push(`${file} → ${target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});

/**
 * The pages the audit asked for, by name. A page that is deleted or renamed
 * without the README being changed leaves a reader with no path in.
 */
describe("the read-this-first path", () => {
  const required = [
    "docs/getting-started.md",
    "docs/for-mainframe-engineers.md",
    "docs/generated-code-standards.md",
    "docs/target-conformance.md",
    "docs/divergences.md",
    "docs/error-handling.md",
    "docs/numeric-model.md",
    "docs/jcl-model.md",
    "docs/security-and-data.md",
    "docs/comparison.md",
    "docs/status-and-limits.md",
  ];

  for (const page of required) {
    it(`has ${page}`, () => {
      expect(FILES).toContain(page);
    });

    it(`links to ${page} from the README`, () => {
      expect(
        readFileSync(resolve(process.cwd(), "README.md"), "utf8"),
      ).toContain(page);
    });
  }
});

/**
 * The README used to print `COMPUTE … ROUNDED MODE IS NEAREST-EVEN` as its
 * flagship example — a phrase Enterprise COBOL does not have, in the first
 * COBOL a reader sees. Every claim that names a construct should be one the
 * compiler emits.
 */
describe("what the README claims", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

  it("does not print COBOL the target rejects", () => {
    expect(readme).not.toContain("ROUNDED MODE IS");
  });

  it("says the limits out loud rather than only linking to them", () => {
    expect(readme).toContain("not** with IBM");
    expect(readme).toContain("never run against a real ledger");
  });

  /** A 16 KB README is one nobody reads to the end of. */
  it("stays short enough to read", () => {
    expect(readme.length).toBeLessThan(13_000);
  });
});

/**
 * The CHANGELOG reached 126 KB in a single `Unreleased` section. The archive is
 * where everything before the audit response went.
 */
describe("the changelog", () => {
  it("is short, and says where the rest is", () => {
    const changelog = readFileSync(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );

    expect(changelog.length).toBeLessThan(20_000);
    expect(changelog).toContain("docs/changelog/before-2026-08-05.md");
  });
});
