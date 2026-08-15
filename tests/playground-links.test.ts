import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  exampleIds,
  isRunnable,
  playgroundUrl,
  readmeTargets,
  writeLinks,
} from "../tools/playground-links";
import { SITE_ORIGIN } from "../tools/build-site";

/**
 * Links from what a reader is reading into the thing that runs it.
 *
 * P3 asked for every fenced BankTS block in `docs/` to become an
 * open-in-playground link. Measured, that is the wrong target: of the 94 `ts`
 * blocks under `docs/`, **one** parses on its own. The rest are fragments — a
 * record, a clause, three lines of a transaction — written to show a construct.
 * A link on the other 93 opens the documentation's own example onto a wall of
 * syntax errors, which is a worse experience than no link and a worse
 * impression than no site.
 *
 * So the rule became: a block gets a link when it is a program. These check
 * that the rule is applied and that it stays true — a block that stops parsing
 * loses its link rather than keeping a broken one.
 */

describe("which code blocks earn a playground link", () => {
  it("links a whole module", () => {
    expect(
      isRunnable(`module Demo;

type MoneyBDT = decimal<18, 2>;

record Row {
  amount: MoneyBDT;
}
`),
    ).toBe(true);
  });

  it("does not link a fragment, which is what most documentation shows", () => {
    // A record on its own is not a program and never compiles as one.
    expect(
      isRunnable(`record Row {
  amount: MoneyBDT;
}`),
    ).toBe(false);
    expect(isRunnable("let scratch: MoneyBDT = 0.00;")).toBe(false);
  });

  it("still links a program the compiler refuses", () => {
    // A program that breaks a banking rule is the single best reason to open
    // the playground: it is where the diagnostics are legible.
    const unsafe = `module Unsafe;

type MoneyBDT = decimal<18, 2>;

record Posting {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  fee: MoneyBDT;
}

transaction postTransfer(request: Posting) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}
`;
    expect(isRunnable(unsafe)).toBe(true);
  });
});

describe("the permalink a documentation block carries", () => {
  it("is the playground's own versioned hash format", () => {
    const url = playgroundUrl("module Demo;\n");
    expect(url.startsWith(`${SITE_ORIGIN}/playground/#v1=`)).toBe(true);
  });

  it("round-trips the source it was built from", () => {
    // The one property that matters: what the reader opens is what was written.
    const source = "module Demo;\n\n// a comment with é and a <bracket>\n";
    const url = playgroundUrl(source);
    const encoded = url.split("#v1=")[1] ?? "";
    const decoded = Buffer.from(decodeURIComponent(encoded), "base64").toString(
      "utf8",
    );
    expect(decoded).toBe(source);
  });
});

describe("every example README links to the playground", () => {
  it("names an example the playground actually has", () => {
    const ids = new Set(exampleIds());
    expect(ids.size).toBeGreaterThan(15);

    for (const { readme } of readmeTargets()) {
      const text = readFileSync(readme, "utf8");
      const links = [...text.matchAll(/playground\/#example=([\w/-]+)\)/g)].map(
        (match) => match[1] ?? "",
      );

      expect(
        links.length,
        `${readme} carries no playground link`,
      ).toBeGreaterThan(0);
      for (const id of links) {
        expect(ids.has(id), `${readme} links to a missing example: ${id}`).toBe(
          true,
        );
      }
    }
  });

  it("is checked in, so the site does not link at something unwritten", () => {
    // `pnpm playground:links` writes them; this is the check half. If it
    // reports a change, the working tree is out of date with the examples.
    const { changed } = writeLinks(true);
    expect(
      changed,
      `run \`pnpm playground:links\`: these READMEs are out of date`,
    ).toEqual([]);
  });

  it("links every program of a job, not the directory holding them", () => {
    // `end-of-day-settlement` is four programs and one README. A link to the
    // directory opens nothing: the playground is keyed by program.
    const target = readmeTargets().find((entry) =>
      entry.readme.includes("end-of-day-settlement"),
    );
    expect(target).toBeDefined();
    expect(target?.ids.length).toBeGreaterThan(1);
    for (const id of target?.ids ?? []) {
      expect(id).toContain("end-of-day-settlement/");
    }
  });
});

describe("the example ids the links use", () => {
  it("are the directory names, so a link survives an edit to the program", () => {
    // Encoding the source into every README would strand each link on a copy
    // of the example as it was the day the link was written.
    const ids = exampleIds();
    const directories = execSync("ls examples", { encoding: "utf8" })
      .trim()
      .split("\n");
    for (const id of ids) {
      expect(directories).toContain(id.split("/")[0]);
    }
  });

  it("covers every example directory that holds a program", () => {
    const ids = new Set(exampleIds().map((id) => id.split("/")[0]));
    const directories = execSync("ls examples", { encoding: "utf8" })
      .trim()
      .split("\n");
    for (const directory of directories) {
      expect(ids.has(directory), `${directory} has no playground id`).toBe(
        true,
      );
    }
  });
});

describe("the playground page itself", () => {
  const html = readFileSync(
    join(process.cwd(), "packages/playground/index.html"),
    "utf8",
  );

  it("carries the site's header rather than its own", () => {
    // P1: a visitor must be able to move between landing, playground and docs
    // without leaving the domain. The only outbound links used to be three raw
    // GitHub URLs.
    expect(html).toContain('<a class="wordmark" href="/">BankLang</a>');
    expect(html).toContain('href="/docs/"');
  });

  /**
   * The two reference pages a reader of this page wants, on this domain.
   *
   * They used to be two more items in the header, which is how the playground
   * came to have a different navigation from every other page of the site. They
   * are now where each is actually wanted: the language reference beside the
   * editor you write BankTS in, and the diagnostic catalogue at the foot of the
   * pane that has just shown you a diagnostic. The rule this test exists for is
   * unchanged, and it is about the destination rather than the position.
   */
  it("points the language and diagnostics links at this domain", () => {
    const main = readFileSync(
      join(process.cwd(), "packages/playground/src/main.ts"),
      "utf8",
    );
    expect(html).toContain('href="/docs/language-reference.html"');
    expect(main).toContain('href="/docs/diagnostics.html"');
    expect(html).not.toContain("blob/main/docs/language-reference.md");
    expect(main).not.toContain("blob/main/docs/diagnostics.md");
  });

  it("says what the panes are, before a reader has to guess", () => {
    // P2: a first-time visitor sees two panes of code and no instruction.
    expect(html).toContain('class="howto"');
    expect(html).toMatch(/Edit this/);
  });

  it("offers a link to copy and a theme shared with the rest of the site", () => {
    expect(html).toContain('id="share"');
    expect(html).toContain('id="theme"');
    expect(html).toContain("banklang-theme");
  });
});

describe("the landing page reaches the playground where it matters", () => {
  const html = readFileSync(
    join(process.cwd(), "packages/site/src/index.html"),
    "utf8",
  );

  it("deep-links the refusal example from the section that shows it", () => {
    // P2 again: the program the landing page prints diagnostics for is the one
    // worth opening, and it was reachable only by finding it in a dropdown.
    expect(html).toContain("/playground/#example=unsafe-posting");
  });

  it("uses an id the playground has", () => {
    const ids = new Set(exampleIds());
    // `unsafe-posting` is defined in the playground rather than in `examples/`,
    // because a program that fails on purpose does not belong in the corpus the
    // test suite compiles.
    expect(ids.has("unsafe-posting")).toBe(false);
    expect(
      readFileSync("packages/playground/src/examples.ts", "utf8"),
    ).toContain('id: "unsafe-posting"');
  });
});
