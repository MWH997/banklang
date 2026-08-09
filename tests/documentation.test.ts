import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { WORKING_PAPERS, isWorkingPaper } from "../tools/build-docs";

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
    .map((match) => match[1]!)
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

  /**
   * A document named in backticks rather than linked.
   *
   * The check above reads Markdown links, so it never saw `` `language-spec.md`
   * `` in `docs/diagnostics.md`, `` `definitions.md` `` in `docs/glossary.md`
   * and `docs/verification.md`, or `` `repo-conventions.md` `` — four documents
   * that had not existed for a long time, cited as though a reader could go and
   * read them. Prose naming a file is a reference whether or not it is a link.
   */
  it("names no document that does not exist", () => {
    const missing: string[] = [];
    const known = new Set(FILES.map((file) => file.replace(/\\/g, "/")));
    /**
     * A document the reader is asked to create, named for that reason.
     *
     * `RESULTS.md` is what a z/OS run produces from `RESULTS-TEMPLATE.md`, and
     * three pages say so in the form "until `RESULTS.md` exists". Its absence
     * is the point being made.
     */
    const yetToExist = new Set(["RESULTS.md"]);

    for (const file of FILES) {
      // A working paper names files that are not there, and is right to.
      //
      // An audit is a record of what was written at the time, and it names
      // documents later renamed or removed — `integrations/numeric-semantics.md`
      // became `numeric-model.md` because the 2026-08-05 audit asked for it.
      // Rewriting it would be rewriting the history it exists to hold. A ticket
      // names what it exists to have written: the launch checklist asks for
      // `docs/for-decision-makers.md`, and the day that resolves is the day the
      // ticket is done.
      //
      // Asked of the builder rather than matched here. This test had its own,
      // looser pattern for the same idea, which is half of what the 2026-08-07
      // audit's F22 was about: two spellings of one rule, and the site's was
      // the one that decided what got published.
      if (isWorkingPaper(file)) {
        continue;
      }
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const [, named = ""] of text.matchAll(/`([\w./-]+\.md)`/g)) {
        const base = named.split("/").pop() as string;
        if (
          yetToExist.has(base) ||
          [...known].some((path) => path.endsWith(`/${base}`) || path === base)
        ) {
          continue;
        }
        missing.push(`${file} names ${named}`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * The README must not link a working paper.
   *
   * This assertion is the reverse of the one it replaces. G1 added links to
   * `docs/working/` because `tools/build-docs.ts` claimed they existed and they
   * did not — the 2026-08-07 audit's F21 — and that made the comment true while
   * making the repository carry the papers. The papers are gitignored now, so a
   * README link is a path a clone does not have: F21's defect again, pointing
   * the other way.
   *
   * The directory, not a name pattern, for the reason `WORKING_PAPERS` itself
   * exists: what is in `docs/working/` is the set, and the next paper is
   * whatever somebody writes next.
   */
  it("links no working paper from the README, since a clone has none", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    const linked = relativeLinks(readme)
      .map((link) => link.replace(/\\/g, "/"))
      .filter((link) => isWorkingPaper(link));

    expect(
      linked,
      `the README links ${WORKING_PAPERS}/ papers, which are not in the repository`,
    ).toEqual([]);
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
    // The claim, not one phrasing of it. This used to assert on the literal
    // `not** with IBM`, which made a stronger sentence in a better place fail
    // the check: the limit moved above the fold and gained "No IBM Enterprise
    // COBOL validation has been performed", and the test wanted its markup
    // back. `validated with GnuCOBOL, not IBM` is held across all three
    // surfaces by the suite below.
    expect(readme).toMatch(/GnuCOBOL, not IBM/i);
    expect(readme).toContain("never run against a real ledger");
  });

  /**
   * A 16 KB README is one nobody reads to the end of.
   *
   * The ceiling has moved once, from 13,000, and the reason is written here
   * rather than left as a larger number. H5 gave the documentation section two
   * more groups — "Language reference" and "Decisions" — because nineteen of
   * forty-three documents were reaching the docs sidebar through a group called
   * "Everything else", and this section is where that grouping is written. Two
   * headings and two two-row tables is what they cost.
   *
   * G2's links to the working papers were paid for by tightening four
   * paragraphs instead, which is the right answer when the growth is prose. It
   * is the wrong answer here: the alternative was writing all nineteen rows
   * out, which the README cannot afford and which would be a second list to
   * keep in step with `docs/`.
   *
   * It has moved a second time, to 13,550, for R1: the site's address, above
   * the badges, where somebody who arrives at GitHub first sees it before
   * anything else. Two lines, and the same reasoning — a reader who wanted the
   * live compiler and got a repository is the one visitor this project cannot
   * afford to lose to a scroll.
   *
   * And a third, to 13,800, for the same reason as the first: a list that was
   * wrong rather than prose that grew. The example tables named twenty of the
   * twenty-three directories in `examples/` — `payment-feed-import`,
   * `settlement-bill-file` and `zunit-tested-posting` had been added and never
   * listed — so a reader counting the tables got a different answer from a
   * reader counting the directory. Three rows, and the prose was tightened to
   * pay for most of them: the differential lane was explained twice in
   * consecutive paragraphs and is now explained once.
   */
  it("stays short enough to read", () => {
    expect(readme.length).toBeLessThan(13_800);
  });

  /**
   * R1. The first link is the site, not a badge and not GitHub.
   *
   * Asserted rather than trusted to stay put: this line is the one thing in the
   * README that a later edit tidying the header would move down, and the whole
   * of its value is being above the fold.
   */
  it("opens with the address of the site", () => {
    const firstLink = /\[([^\]]+)\]\(([^)]+)\)/.exec(readme);
    expect(firstLink?.[2]).toBe("https://banklang.mwhassan.com");
    expect(readme.indexOf("banklang.mwhassan.com")).toBeLessThan(
      readme.indexOf("badge.svg"),
    );
  });
});

/**
 * The CHANGELOG reached 126 KB in a single `Unreleased` section, and a byte
 * ceiling was the first answer to that. A ceiling only says when the problem
 * has recurred; what keeps the file readable is the entry style, so that is
 * what is asserted. Common Changelog's rule 3: a change is "no more than one
 * line long", and the explanation belongs in the document it links to.
 */
describe("the changelog", () => {
  const changelog = readFileSync(
    resolve(process.cwd(), "CHANGELOG.md"),
    "utf8",
  );

  /**
   * The 126 KB was first moved to `docs/changelog/before-2026-08-05.md` rather
   * than fixed, and a reader who clicked found the same wall under a new name.
   * It is deleted: `git log` holds every entry, which is where a working record
   * belongs. What the file has to keep doing is say so, rather than starting at
   * 0.9.0 as though nothing came before it.
   */
  it("says where the rest is", () => {
    // Wrapping is Prettier's, not the document's: the phrase this looks for
    // fell across a line break the moment the file was formatted.
    expect(changelog.replace(/\s+/g, " ")).toContain("in the commit history");
    expect(changelog).toContain("git log");
  });

  /** Keep a Changelog: an Unreleased section, and a date on every version. */
  it("carries an Unreleased section and a dated version", () => {
    expect(changelog).toMatch(/^## \[Unreleased\]$/m);
    expect(changelog).toMatch(/^## \[\d+\.\d+\.\d+\] — \d{4}-\d{2}-\d{2}$/m);
  });

  /**
   * Measured over what a reader sees: the bullet's Markdown wrapping undone,
   * and a link counted as its text rather than its target, since Common
   * Changelog asks for the links and a URL is not prose. A one-line entry is
   * one sentence, not one line of the file. The essays this replaced ran past
   * two thousand characters each.
   */
  it("keeps every entry to a line", () => {
    const entries = [...changelog.matchAll(/^- (.+(?:\n {2}.+)*)$/gm)].map(
      (match) =>
        match[1]!
          .replace(/\s*\n\s*/g, " ")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    );

    expect(entries.length).toBeGreaterThan(20);
    const long = entries.filter((entry) => entry.length > 200);
    expect(long).toEqual([]);
  });
});

/**
 * COBOL printed in the documentation, held to what the compiler emits.
 *
 * The 2026-08-05 audit's §5.8 asked for this and it was applied to the README
 * only. So `ROUNDED MODE IS NEAREST-EVEN` was taken out of the README and left
 * in `docs/language-reference.md` — the 108 KB specification the playground
 * links to — where a seven-row table taught every rounding mode as a phrase
 * Enterprise COBOL has never had. `docs/cobol-backend.md` had a bool mapping
 * with 88-levels the emitter does not generate, in a picture spelling and a
 * literal delimiter it does not use.
 *
 * A reader believes the specification over the source. Anything it prints as
 * generated COBOL has to be COBOL this compiler generates.
 */
describe("COBOL printed in the documentation", () => {
  /** Every fenced `cobol` block in every document, with its file. */
  const blocks = FILES.filter((file) => !/audit-\d{4}/.test(file)).flatMap(
    (file) => {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      return [...text.matchAll(/```cobol\n([\s\S]*?)```/g)].map((match) => ({
        file,
        body: match[1]!,
      }));
    },
  );

  it("has blocks to check", () => {
    expect(blocks.length).toBeGreaterThan(10);
  });

  /**
   * Forms the compiler once emitted and no longer does. Each is a defect that
   * shipped, so each is a thing a document could still be teaching.
   */
  const withdrawn = [
    {
      form: /ROUNDED\s+MODE\s+IS/,
      why: "COBOL 2002; Enterprise COBOL has only ROUNDED",
    },
    { form: /\bNEAREST-EVEN\b/, why: "appears in no column of Appendix E" },
    {
      form: /PIC X VALUE/,
      why: "the picture is written PIC X(1) with a repeat count",
    },
    { form: /'[YN]'/, why: "the CBL statement names QUOTE as the delimiter" },
    {
      form: /88\s+(TRUE|FALSE)-VALUE/,
      why: "no such condition names are emitted for a bool",
    },
    { form: /^\s*MAIN-PARA\./m, why: "the entry paragraph is BANK-MAIN" },
    {
      form: /PROGRAM-ID\.\s+[A-Z]{9,}/,
      why: "a PROGRAM-ID is at most eight characters",
    },
    {
      form: /PROGRAM-ID\.\s+[A-Z0-9]+-/,
      why: "a PROGRAM-ID carries no hyphen under PGMNAME(COMPAT)",
    },
  ];

  for (const { form, why } of withdrawn) {
    it(`prints no ${form.source}`, () => {
      const offenders = blocks
        .filter((block) => form.test(block.body))
        .map((block) => block.file);

      expect(
        [...new Set(offenders)],
        `A document prints COBOL the compiler does not emit: ${why}.`,
      ).toEqual([]);
    });
  }
});

/**
 * The one sentence that must be wherever a reader can arrive.
 *
 * The pre-public checklist said this was "already
 * in all three; keep it there". It was in two. The README implied it — "each
 * compiled in CI under a GnuCOBOL configuration shaped to Enterprise COBOL
 * 6.4" — and a reader who does not already know that GnuCOBOL is not IBM's
 * compiler would have read that as validation against the target.
 *
 * It is the project's most important claim about what it has *not* done, so it
 * is checked rather than remembered. The wording differs by surface; what has
 * to survive is that no IBM Enterprise COBOL validation is claimed.
 */
describe("validated with GnuCOBOL, not IBM", () => {
  /*
   * The site's own two chrome files are here as well as the README.
   *
   * `packages/site/src/index.html` is the most-read page this project has and
   * the first thing a stranger sees, and `tools/build-blog.ts` writes the
   * footer under every post. Both carried the sentence and neither was held to
   * it: the enforced list was the README, the limits page and the playground,
   * so the home page could have lost the claim in a redesign and every test
   * here would still have passed. The claim is only worth having where it
   * cannot quietly go missing.
   */
  const surfaces: [string, string][] = [
    ["the README", "README.md"],
    ["the honest-limits page", "docs/status-and-limits.md"],
    ["the playground", "packages/playground/index.html"],
    ["the site's home page", "packages/site/src/index.html"],
    ["the footer under every blog post", "tools/build-blog.ts"],
  ];

  for (const [name, file] of surfaces) {
    it(`says so in ${name}`, () => {
      const text = readFileSync(resolve(process.cwd(), file), "utf8").replace(
        /\s+/g,
        " ",
      );
      expect(
        /No IBM\s+Enterprise COBOL validation/i.test(text),
        `${file} does not say that no IBM Enterprise COBOL validation is claimed.`,
      ).toBe(true);
    });
  }
});

/**
 * What the Run tab is run on, said where the numbers are.
 *
 * "Read the postings it made rather than take the compiler's word for them" was
 * the claim, and for a while nothing filled the transaction's records before
 * the program ran — `run.ts` passed `datasets: []` and no entry record at all,
 * so the marquee example's ledger balanced 0.00 against 0.00. That was the
 * 2026-08-07 audit's F4; B3 made the tab admit it and B2 gave it an Input
 * panel.
 *
 * The claim now has to be the other one, and it has to be made in the same
 * three places: the numbers came from something, and a reader is told what.
 * Where a program has no input path at all — a CICS transaction whose commarea
 * a region supplies — the tab still says so, because that is a fact about the
 * program rather than about the browser and the two look identical from the
 * outside.
 */
describe("what the Run tab was run on", () => {
  const surfaces: [string, string][] = [
    ["the Run panel itself", "packages/playground/src/main.ts"],
    ["the README", "README.md"],
    ["the playground's README", "packages/playground/README.md"],
  ];

  for (const [name, file] of surfaces) {
    it(`says where the input comes from, in ${name}`, () => {
      const text = readFileSync(resolve(process.cwd(), file), "utf8").replace(
        /\s+/g,
        " ",
      );
      expect(
        /Input tab|Input panel|entry record|input dataset/i.test(text),
        `${file} does not say what the Run tab is given.`,
      ).toBe(true);
    });
  }

  /**
   * Before the results, not after them. A reader who reaches the journal
   * without knowing what produced it has read the numbers already.
   */
  it("says it before the numbers", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/playground/src/main.ts"),
      "utf8",
    );
    const render = source.slice(
      source.indexOf("function renderRun("),
      source.indexOf("function block("),
    );
    const note = render.indexOf("Run on what the Input tab holds");
    const journal = render.indexOf("Ledger journal");

    expect(note).toBeGreaterThan(-1);
    expect(journal).toBeGreaterThan(-1);
    expect(note).toBeLessThan(journal);
  });

  /** And where there is nothing to be given, why there is nothing. */
  it("still says so for a program with no input path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/playground/src/main.ts"),
      "utf8",
    );
    expect(source).toContain("Nothing was supplied as input.");
    expect(source).toContain("program?.reason");
  });
});

/**
 * The citation file, held to the rest of the repository.
 *
 * A `CITATION.cff` is metadata nobody reads while working, which is exactly why
 * it rots: it names a version, a licence and a repository, and each of those is
 * stated somewhere else that does change. The failure is silent and it surfaces
 * in the worst place — in somebody else's bibliography, naming a release that
 * was never cut.
 *
 * So every field checked here is compared against the thing it duplicates
 * rather than against a literal.
 */
describe("the citation file", () => {
  const citation = readFileSync(resolve(process.cwd(), "CITATION.cff"), "utf8");
  const field = (name: string): string | undefined =>
    new RegExp(`^${name}:\\s*(.+)$`, "m")
      .exec(citation)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");

  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { version: string; license: string; homepage: string };

  it("names the version package.json names", () => {
    expect(field("version")).toBe(manifest.version);
  });

  it("names a version the changelog knows about", () => {
    const changelog = readFileSync(
      resolve(process.cwd(), "CHANGELOG.md"),
      "utf8",
    );
    expect(changelog).toContain(manifest.version);
  });

  it("names the licence the repository is under", () => {
    expect(field("license")).toBe(manifest.license);
    expect(readFileSync(resolve(process.cwd(), "LICENSE"), "utf8")).toContain(
      "MIT License",
    );
  });

  it("points at this repository and this site", () => {
    expect(field("repository-code")).toBe("https://github.com/MWH997/banklang");
    expect(field("url")).toBe(manifest.homepage);
  });

  it("makes the same GnuCOBOL claim every other surface makes", () => {
    expect(
      /No IBM\s+Enterprise COBOL validation/i.test(
        citation.replace(/\s+/g, " "),
      ),
      "CITATION.cff describes the project without saying no IBM validation is claimed.",
    ).toBe(true);
  });

  it("is the version of the format it declares", () => {
    // 1.2.0 is what GitHub and Zenodo parse; an older one is read differently.
    expect(field("cff-version")).toBe("1.2.0");
  });

  /**
   * The one field here that fails silently.
   *
   * A version or a licence that drifts is caught above by comparing it against
   * the file it duplicates. An ORCID has nothing to compare against — it is
   * only ever right or wrong — and the schema matches it against
   * `https://orcid.org/` exactly. A bare identifier, or the `www.` host that
   * orcid.org itself redirects from, is dropped rather than reported: the
   * citation renders, the author's identifier is simply not in it.
   */
  it("gives the author's ORCID in the form the schema matches", () => {
    const orcid = /orcid:\s*["']?([^"'\s]+)/.exec(citation)?.[1];
    expect(orcid, "no ORCID in CITATION.cff").toBeDefined();
    expect(orcid).toMatch(
      /^https:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
    );
  });
});
