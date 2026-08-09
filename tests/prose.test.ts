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
 * distinction. **Dropped**, and the reasoning is worth writing down because the
 * easy reading of that is that a standard was lowered.
 *
 * The stated rationale was that "the em dash is the punctuation mark a language
 * model reaches for, and a reader who has noticed that stops reading". Two
 * things are wrong with it. It is a proxy: what it is reaching for is writing
 * that reads as though nobody chose the words, and the phrase list below is the
 * direct measurement of that. And it was enforced on the one surface where the
 * writing is most deliberate, while the documentation and the code comments —
 * the two surfaces this project asks to be judged on — carried 1,235 of them.
 * A reader who notices the blog punctuates differently from the docs draws
 * exactly the inference the rule existed to prevent.
 *
 * Extending it was the other option, and it is worse than it sounds: it is a
 * mechanical rewrite of 1,235 sentences in prose that is currently good, to
 * satisfy a heuristic about how the prose might be read rather than about
 * whether it is right. `README.md` discloses the AI assistance in the second
 * paragraph, so nothing was being concealed by the punctuation either way.
 *
 * What survives is the check with a basis, applied to everything: the phrase
 * list, over the blog, the documentation, the README, the contributing guide
 * and the site's own copy. It passed on all of them the day it was extended,
 * which is the argument for extending it rather than against.
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
});
