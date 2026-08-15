import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { posts } from "../tools/build-blog";
import { isWorkingPaper } from "../tools/build-docs";

/**
 * House style, applied to everything a reader reads.
 *
 * H2, closing the 2026-08-07 audit's F26. `tests/blog.test.ts` held two prose
 * rules and held them on five files: no em dashes, and a list of phrases that
 * read as filler. Measured across the repository, the first was enforced on
 * five files and absent from roughly two hundred:
 *
 * | Surface                    | em dashes |
 * | -------------------------- | --------: |
 * | All five blog posts        |         0 |
 * | `README.md`                |         8 |
 * | `packages/site/src` (HTML) |         4 |
 * | `CHANGELOG.md`             |        44 |
 * | `packages/*` comments      |       615 |
 * | `docs/*.md`                |       620 |
 *
 * The audit's own framing was: extend it, or drop it and stop drawing the
 * distinction. It was dropped in August, on the reasoning that enforcing it on
 * the six posts while the documentation carried 620 of them was the worst of
 * the three options, and that extending it meant a mechanical rewrite of prose
 * that was already good.
 *
 * **It has since been extended, and the rewrite was not mechanical.** Every one
 * of the 685 in the documentation and the posts was read and replaced with the
 * punctuation the sentence wanted: a colon where the dash introduced an
 * explanation, parentheses where a pair of them bracketed an aside, a full stop
 * where what followed could stand on its own. Three of the documents are
 * generated, so those were fixed in the generators. So were the site's own
 * markup, the page titles and the strings the playground renders.
 *
 * What is held here is therefore both checks, over the same surfaces: the
 * phrase list, the two shapes of self-answering negative, and the dash. Code
 * comments are deliberately outside it, and the reason is the one the August
 * entry gave: they are written for whoever is reading the code, the objection
 * is about what a visitor to the site reads, and a rule reaching into every
 * comment in the repository is the mechanical rewrite that was rightly refused.
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
 * 2026-08-05 audit uses "leverage", and it should go on using it.
 */
function proseSurfaces(): { name: string; text: string }[] {
  const files = [
    ...markdownUnder("docs").filter(
      (file) => !isWorkingPaper(file.replace(/\\/g, "/")),
    ),
    "README.md",
    "CONTRIBUTING.md",
    "packages/site/src/index.html",
    "packages/playground/index.html",
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

  /**
   * The two-beat negation, which is a tic rather than a phrase.
   *
   * "It is not a quirk. It is the rule you use when…", "The job is not a
   * skeleton. It is meant to be submittable", "The interesting part is not the
   * translation. It is that the compiler refuses…". Set up a negative, then
   * deliver the real claim in a second short sentence starting "It is".
   *
   * `FORBIDDEN` cannot catch it, because there is no phrase to list — every
   * instance is different words in the same shape, which is exactly why it
   * reads as a mannerism. Twelve of them were spread across the README, the
   * landing page, four of the six blog posts and the documentation, and once
   * you have noticed one you notice all of them.
   *
   * The rule is narrow on purpose. A negation is fine; so is a short sentence.
   * What is caught here is the pair, and only where the second sentence opens
   * with a bare pronoun and a copula, which is the form with no information in
   * it — "It is", "That is", "They are". Rewriting one is usually a matter of
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
   */
  it("does not answer its own negative with a comma and a pronoun", () => {
    // The trailing `(?!\s+not\b)` excludes a list of negatives, which is a
    // different shape and a correct one: "they are not implementations, they
    // are not secure, and they write plain files".
    const SPLICE =
      /\b(?:is|are|was|were)\s+not\s+[^.;:!?]{3,70},\s+(?:it|that|they|this)\s+(?:is|are|was|were)\b(?!\s+not\b)/gi;
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
   * sentence actually wanted — a colon where the dash introduced an
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
});
