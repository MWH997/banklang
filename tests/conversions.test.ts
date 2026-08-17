import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import { conversionDirectories, measure } from "../tools/refresh-conversions";

/**
 * The conversions, held to what the compiler actually produces.
 *
 * Each conversion's `generated` directory is checked in so a reader can see the output
 * without a toolchain, which makes it the one kind of artifact this project
 * says is dangerous: a file that claims to be generated and has drifted from
 * the generator. Two real defects were sitting in `tests/fixtures/` exactly
 * like that.
 *
 * So it is rebuilt here into a temporary directory and compared. A failure
 * means `pnpm conversions:refresh` has not been run, and the diff is what
 * changed about the compiler's output, which is the review.
 */

const CONVERSIONS = conversionDirectories();

/** Every file under a directory, as paths relative to it. */
function tree(root: string, base = root): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return statSync(path).isDirectory()
        ? tree(path, base)
        : [relative(base, path)];
    })
    .sort();
}

describe("the conversions directory", () => {
  it("holds the conversions the README lists", () => {
    const readme = readFileSync("conversions/README.md", "utf8");
    for (const conversion of CONVERSIONS) {
      expect(readme, `${conversion} is not linked from the index`).toContain(
        `${conversion}/`,
      );
    }
    expect(CONVERSIONS.length).toBeGreaterThanOrEqual(5);
  });

  for (const conversion of CONVERSIONS) {
    describe(conversion, () => {
      const directory = join("conversions", conversion);

      /**
       * Errors, not warnings. `03-db2-cursor-batch` warns that it posts inside
       * a loop with no checkpoint, which is true of the original too and is
       * part of what that page says, and silencing it here would be silencing the
       * finding.
       */
      it("compiles with no errors", () => {
        const result = runBankc(["check", join(directory, "banklang")]);
        expect(result.stderr).not.toContain(" error ");
        expect(result.exitCode).toBe(0);
      });

      it("has generated output matching the compiler", () => {
        const built = mkdtempSync(join(tmpdir(), "bankc-conversion-"));
        const result = runBankc([
          "build",
          join(directory, "banklang"),
          "--out",
          built,
        ]);
        expect(result.exitCode).toBe(0);

        // The audit bundle is a per-run report rather than part of the
        // argument, so it is not checked in and not compared.
        const checkedIn = resolve(directory, "generated");
        const fresh = tree(built).filter((path) => !path.startsWith("audit"));

        expect(tree(checkedIn).sort()).toEqual(fresh.sort());
        for (const path of fresh) {
          expect(
            readFileSync(join(checkedIn, path), "utf8"),
            `${directory}/generated/${path} is stale; run pnpm conversions:refresh`,
          ).toBe(readFileSync(join(built, path), "utf8"));
        }
      });

      /**
       * The numbers on the page, against the numbers the files support.
       *
       * A hand-typed count that stopped being true is the same failure as a
       * stale artifact, and it is the one a reader has no way to check.
       */
      it("prints measurements that match its files", () => {
        const page = readFileSync(join(directory, "README.md"), "utf8");
        const measurement = measure(conversion);

        // Compared with the column padding squeezed out, because the table is
        // written by `pnpm conversions:refresh` and then aligned by Prettier,
        // and the alignment is Prettier's business rather than the claim's.
        const squeezed = page.replace(/[ \t]+/g, " ");

        expect(page).toContain("<!-- measurements -->");
        expect(squeezed).toContain(
          `| Lines of code, comments and blanks excluded | ${measurement.originalLines} | ${measurement.generatedLines} |`,
        );
        expect(squeezed).toContain(
          `| \`GO TO\` a paragraph that is not an exit | ${measurement.originalJumps} | ${measurement.generatedJumps} |`,
        );
      });
    });
  }
});

/**
 * No checked-in artifact may carry a path from the machine that built it.
 *
 * Every source map and every audit report in `evidence/` named
 * `/Users/<somebody>/Code/banklang/...`, so none of it could be reproduced
 * byte for byte anywhere else, in a project whose first claim is that the same
 * input always produces the same output, and whose evidence bundles are what a
 * reader is invited to check that claim against.
 *
 * The rule is stated as "no absolute path" rather than "not my home directory",
 * because the next person to run the refresh scripts has a different one.
 */
describe("checked-in artifacts", () => {
  const roots = ["evidence", "conversions", "tests/fixtures"];

  it("carry no absolute path from the machine that built them", () => {
    const offenders: string[] = [];

    for (const root of roots) {
      for (const path of tree(root)) {
        const full = join(root, path);
        if (/\.(png|jpg|gif|pdf)$/.test(full)) {
          continue;
        }
        const text = readFileSync(full, "utf8");
        // A POSIX absolute path in something that is not JCL. `//` in JCL is a
        // statement, and `/*` is a delimiter.
        for (const match of text.matchAll(
          /(?:^|["'\s(])(\/[A-Za-z][^\s"'*)]*)/g,
        )) {
          if (
            match[1]!.startsWith("/Users") ||
            match[1]!.startsWith("/home") ||
            match[1]!.startsWith("/private") ||
            match[1]!.startsWith("/var/folders")
          ) {
            offenders.push(`${full}: ${match[1]}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
