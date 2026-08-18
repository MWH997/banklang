import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { posts } from "../tools/build-blog";
import { isWorkingPaper } from "../tools/build-docs";

/**
 * House style, applied to everything a reader reads.
 *
 * Five rules: a list of phrases that read as filler, a list of phrases that
 * praise the page's own frankness, two shapes of self-answering negative, and
 * no em dashes. All of them over the same surfaces, which is the part that took
 * the longest to get right.
 *
 * The dash rule was held on the blog posts alone for a while, while the
 * documentation carried 620 of them and the site's own markup carried four.
 * Enforcing a rule on six files out of two hundred teaches a reader that the
 * blog is punctuated by different hands from the docs, which is the inference
 * the rule existed to prevent. Extending it meant reading all 685 instances in
 * the documentation and the posts and replacing each with the punctuation the
 * sentence actually wanted: a colon where the dash introduced an explanation,
 * parentheses where a pair of them bracketed an aside, a full stop where what
 * followed could stand on its own. Three of the documents are generated, so
 * those were fixed in the generators, along with the site's markup, the page
 * titles and the strings the playground renders.
 *
 * That rewrite is also where the bracket rule at the bottom of this file comes
 * from. Thirty-three list items came out of it with an open bracket on one
 * bullet and its partner on the next, and they shipped, because nothing was
 * reading punctuation.
 *
 * Code comments are deliberately outside all of this. They are written for
 * whoever is reading the code, the objection these rules answer is about what a
 * visitor to the site reads, and a rule reaching into every comment in the
 * repository is a mechanical rewrite of prose that is already doing its job.
 */

const FORBIDDEN = [
  "delve",
  "seamless",
  "leverage",
  "game-chang",
  "cutting-edge",
  "in today's",
  "it's not just",
  "unlock the",
  "elevate",
  "embark",
  "realm of",
  "testament to",
  "tapestry",
  "dive into",
  "deep dive",
  "at the end of the day",
  "plays a crucial role",
  "plays a vital role",
  "it is important to note",
  "in conclusion",
  "comprehensive guide",
  "harness the",
  "streamline",
  "empower",
  "revolutioniz",
  "navigating the",
  "ever-evolving",
  "robust solution",
  "best-in-class",
  "paradigm shift",
  // A second group, from the 2026-08-09 sweep of every reader-facing file. The
  // list above catches marketing vocabulary, which this repository never had
  // much of; what the sweep actually found was self-congratulation and claims
  // the project cannot support.
  //
  // "bank-grade" was in `docs/glossary.md` twice and in `docs/verification.md`,
  // which opened by calling verification "the difference between a toy
  // transpiler and a bank-grade toolchain". Nothing here has run on z/OS or
  // moved any money, and `docs/status-and-limits.md` says so on the same site.
  // A page that grades itself against a phrase with no definition is doing the
  // opposite of what the rest of the documentation does.
  "bank-grade",
  "enterprise-grade",
  "production-grade",
  "battle-tested",
  "world-class",
  "best-in-breed",
  "industry-leading",
  "non-negotiable",
  // Filler intensifiers in front of a claim, which is where a reader looks for
  // the measurement instead.
  "rock-solid",
  "bulletproof",
  "blazing",
  "effortless",
];

/**
 * Prose that praises its own candour.
 *
 * A third group, from the 2026-08-18 sweep, and the one an outside reader
 * actually named. The vocabulary rules above were already passing while the
 * documentation kept stopping to point out how frank it was being: "the honest
 * comparison", "the honest sample", "the honest first answer", "the honest
 * reading", "the honest position", nine of them across the docs and the posts,
 * plus a page titled "Status and honest limits" and a bullet ending "a project
 * that only publishes its good numbers is telling you something else".
 *
 * Any one of those is unremarkable. Together they read as a document performing
 * integrity, and the effect is the opposite of the one intended: a reader who
 * is told five times that this paragraph is the frank one starts wondering
 * about the other four.
 *
 * The fix in every case was to delete the flourish and leave the claim, which
 * is shorter and says the same thing. "The honest comparison is that they solve
 * opposite problems" became "They solve opposite problems."
 *
 * `honestly` as an adverb is deliberately not here: "what you can honestly
 * claim" is a normal English sentence about the reader's position, not a
 * compliment the page is paying itself.
 */
const SELF_PRAISE = [
  "the honest",
  "least honest",
  "is the tell",
  "telling you something",
  "not a claim on a page",
  "to its credit",
  // A fourth group, from the 2026-08-18 read-through. The move above has a
  // sibling that argues for the page's own trustworthiness before making a
  // claim, and it turned up twice in the same shape: "Stated plainly, because a
  // list like this is usually absent and its absence is the tell" opened the
  // production checklist in for-decision-makers.md, and "Stated plainly,
  // because a page that lists only advantages is one nobody believes" opened
  // the drawbacks in comparison.md. Both headings already said it.
  //
  // "The second half is what makes the first half worth reading" opened
  // comparison.md as a subtitle, telling a reader which half to trust before
  // they had read either. That one is fixed but deliberately not listed: any
  // phrase general enough to catch it also catches "the part worth reading is
  // `zunit/`", which is an ordinary sentence pointing at a directory.
  "stated plainly",
  "nobody believes",
];

/** Every Markdown file under one directory. */
function markdownUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      return [];
    }
    const path = join(root, entry.name);
    if (statSync(path).isDirectory()) {
      return markdownUnder(path);
    }
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/**
 * Everything written for a reader.
 *
 * Working papers are excluded for the reason they are excluded from the site:
 * an audit is a record of what was written on a day, and editing one to satisfy
 * a style rule added later is editing the history it exists to hold. The
 * earliest of them uses "leverage", and it should go on using it.
 *
 * The example, conversion and evidence READMEs were outside this for a long
 * time, and it showed: `docs/` had been swept clean of em dashes while a
 * hundred and twenty sat in the pages a reader reaches by clicking an example.
 * They are the same prose, written for the same reader, so they are held to the
 * same rules. `runtime/`, `zos/` and the two package READMEs are here for the
 * same reason.
 *
 * `CHANGELOG.md` is deliberately not: Common Changelog puts an em dash between
 * a version and its date, three tests match on that form, and the file is a
 * record rather than an argument.
 */
function proseSurfaces(): { name: string; text: string }[] {
  const readmesUnder = (root: string): string[] =>
    markdownUnder(root).filter((file) => file.endsWith("README.md"));

  const files = [
    ...markdownUnder("docs").filter(
      (file) => !isWorkingPaper(file.replace(/\\/g, "/")),
    ),
    "README.md",
    "CONTRIBUTING.md",
    "packages/site/src/index.html",
    "packages/playground/index.html",
    ...readmesUnder("examples"),
    ...readmesUnder("conversions"),
    ...readmesUnder("evidence"),
    "runtime/README.md",
    "zos/README.md",
    "packages/playground/README.md",
    "packages/vscode-extension/README.md",
  ];

  return [
    ...files.map((file) => ({ name: file, text: readFileSync(file, "utf8") })),
    // The posts as text rather than as source, so a phrase inside a fenced
    // block of COBOL is not counted as prose.
    ...posts().map((post) => ({
      name: `blog/${post.slug}.md`,
      text: post.text,
    })),
  ];
}

describe("everything written for a reader", () => {
  const SURFACES = proseSurfaces();

  it("covers the documentation, the site copy and the writing", () => {
    // A floor, so a change to `proseSurfaces` that quietly stops finding files
    // fails rather than passing over nothing.
    expect(SURFACES.length).toBeGreaterThan(45);
    for (const required of [
      "README.md",
      "docs/getting-started.md",
      "packages/site/src/index.html",
    ]) {
      expect(SURFACES.map((surface) => surface.name)).toContain(required);
    }
  });

  it("avoids the phrases that read as filler", () => {
    const found: string[] = [];
    for (const surface of SURFACES) {
      const lower = surface.text.toLowerCase();
      for (const phrase of FORBIDDEN) {
        if (lower.includes(phrase)) {
          found.push(`${surface.name}: ${phrase}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("does not compliment itself on being frank", () => {
    const found: string[] = [];
    for (const surface of SURFACES) {
      const lower = surface.text.toLowerCase();
      for (const phrase of SELF_PRAISE) {
        if (lower.includes(phrase)) {
          found.push(`${surface.name}: ${phrase}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * The two-beat negation, which is a tic rather than a phrase.
   *
   * "It is not a quirk. It is the rule you use when…", "The job is not a
   * skeleton. It is meant to be submittable", "The interesting part is not the
   * translation. It is that the compiler refuses…". Set up a negative, then
   * deliver the real claim in a second short sentence starting "It is".
   *
   * `FORBIDDEN` cannot catch it, because there is no phrase to list. Every
   * instance is different words in the same shape, which is why it
   * reads as a mannerism. Twelve of them were spread across the README, the
   * landing page, four of the six blog posts and the documentation, and once
   * you have noticed one you notice all of them.
   *
   * The rule is narrow on purpose. A negation is fine; so is a short sentence.
   * What is caught here is the pair, and only where the second sentence opens
   * with a bare pronoun and a copula, which is the form with no information in
   * it: "It is", "That is", "They are". Rewriting one is usually a matter of
   * putting the claim first and letting "rather than" carry the contrast.
   */
  it("does not set up a negative and answer it in the next sentence", () => {
    const TWO_BEAT =
      /\b(?:is|are|was|were)\s+not\s+[^.!?]{2,70}[.!?]\s+(?:It|That|They|This)\s+(?:is|are|was|were)\s/g;
    const found: string[] = [];
    for (const surface of SURFACES) {
      for (const [hit] of surface.text.matchAll(TWO_BEAT)) {
        found.push(`${surface.name}: ${hit.replace(/\s+/g, " ").trim()}`);
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * The same shape inside one sentence, joined with a comma.
   *
   * "is not a rule, it is a comment", "is not a compiler error, it is a file
   * somebody uploads". The rule above catches the two-sentence form and this
   * one was left: same mannerism, one mark of punctuation different, and a
   * comma splice on top of it.
   *
   * "not X but Y" and "not X: Y" are both left alone. The objection is to the
   * pronoun-and-copula restatement, which carries no information the first
   * clause did not, and not to contrast.
   *
   * The auxiliary form is caught too. Written with `do` rather than `be` it is
   * the same mannerism and the same splice, and it read as clean for as long as
   * this only matched a copula: "an out-of-range write does not fail, it
   * quietly changes a different field", "the compiler does not evaluate it, it
   * compares the expressions". A rule that catches one spelling of a tic and
   * not the other just moves the tic.
   */
  it("does not answer its own negative with a comma and a pronoun", () => {
    // The trailing `(?!\s+not\b)` excludes a list of negatives, which is a
    // different shape and a correct one: "they are not implementations, they
    // are not secure, and they write plain files".
    const SPLICE =
      /\b(?:is|are|was|were|does|do|did)\s+not\s+[^.;:!?,]{3,70},\s+(?:it|that|they|this)\s+(?:\w+ly\s+)?(?:is|are|was|were|does|do|did|[a-z]+s)\b(?!\s+not\b)/gi;
    const found: string[] = [];
    for (const surface of SURFACES) {
      for (const [hit] of surface.text.matchAll(SPLICE)) {
        found.push(`${surface.name}: ${hit.replace(/\s+/g, " ").trim()}`);
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * No em dashes, in anything a reader reads.
   *
   * The comment at the top of this file records why this rule was dropped in
   * August: it was enforced on the six blog posts and absent from the 1,235
   * instances in the documentation and the code comments, and a reader who
   * notices that the blog punctuates differently from the docs draws exactly
   * the inference the rule existed to prevent. Extending it was called a
   * mechanical rewrite of prose that was already good.
   *
   * It has now been extended, which is what makes the rule defensible: 685 in
   * the documentation and the posts, and every one in the site's own markup and
   * in the strings the playground renders, rewritten as the punctuation the
   * sentence actually wanted: a colon where the dash introduced an
   * explanation, parentheses where a pair of them bracketed an aside, a full
   * stop where the clause after it could stand alone.
   *
   * Held over the reader-facing surfaces only. Code comments are not in
   * `proseSurfaces()` and are not covered: they are written for whoever is
   * reading the code, the argument above is about what a visitor to the site
   * sees, and a rule that reaches into every comment in the repository is the
   * mechanical rewrite that was rightly refused.
   *
   * Generated pages are covered through their generators. `pnpm
   * horizontal:report` writes three of the documents this reads, so the em
   * dashes in it were fixed in `tools/horizontal-report.ts` and in
   * `packages/horizontal-validation/src/defects.ts` rather than in the output,
   * where the next run would have put them back.
   */
  it("uses no em dashes", () => {
    const found: string[] = [];
    for (const surface of SURFACES) {
      // Fenced blocks are content: a COBOL sample or a terminal transcript is
      // quoted, not written. `posts()` already arrives as prose.
      const prose = surface.text.replace(/```[\s\S]*?```/g, "");
      const count = (prose.match(/—/g) ?? []).length;
      if (count > 0) {
        found.push(`${surface.name}: ${String(count)}`);
      }
    }
    expect(found).toEqual([]);
  });

  /**
   * Every list item closes the brackets it opens.
   *
   * This is the damage the dash removal left behind, and it went unnoticed for
   * a release because nothing reads punctuation. Replacing each dash by hand,
   * across thirty-odd "Related pages" lists, turned pairs like
   *
   *     - [divergences.md](divergences.md) (what is known not to be proved
   *     - [verification.md](verification.md)) what is checked, and how
   *
   * into exactly that: an open bracket on one bullet and its partner on the
   * next, which renders as literal parentheses in the middle of two unrelated
   * sentences. Thirty-three of them shipped to the site.
   *
   * Held over every published Markdown file, not only the pages
   * `proseSurfaces()` covers, because an example's README is read by whoever is
   * reading that example. Working papers are out for the reason they are out of
   * everything else here. Fenced blocks are excluded: COBOL and JCL open
   * brackets that Markdown never closes.
   */
  it("closes every bracket a list item opens", () => {
    const unbalanced: string[] = [];
    const published = [
      ...markdownUnder("docs").filter(
        (file) => !isWorkingPaper(file.replace(/\\/g, "/")),
      ),
      ...markdownUnder("examples"),
    ];
    for (const file of published) {
      const lines = readFileSync(file, "utf8").split("\n");

      // Fenced blocks blanked in place, so line numbers stay true.
      let fenced = false;
      const prose = lines.map((line) => {
        if (line.trimStart().startsWith("```")) {
          fenced = !fenced;
          return "";
        }
        return fenced ? "" : line;
      });

      // A list item runs from its bullet to the next bullet or a blank line.
      let item: string[] = [];
      let at = 0;
      const check = (): void => {
        if (item.length === 0) {
          return;
        }
        // A link target is not prose, and its brackets are not the author's.
        const text = item.join(" ").replace(/\]\([^)\s]*\)/g, "]");
        const opens = (text.match(/\(/g) ?? []).length;
        const closes = (text.match(/\)/g) ?? []).length;
        if (opens !== closes) {
          unbalanced.push(`${file}:${String(at + 1)}: ${item[0]!.trim()}`);
        }
        item = [];
      };

      prose.forEach((line, index) => {
        if (/^\s*(?:[-*+]|\d+\.) /.test(line)) {
          check();
          item = [line];
          at = index;
        } else if (item.length > 0 && line.trim() !== "") {
          item.push(line);
        } else {
          check();
        }
      });
      check();
    }

    expect(unbalanced).toEqual([]);
  });
});
