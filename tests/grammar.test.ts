import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { KEYWORDS } from "../packages/parser/src/index";

/**
 * The published grammar against the lexer.
 *
 * `docs/language/grammar.md` is the page a compiler engineer opens first, and a
 * grammar that has fallen behind the language is worse than none: it reads as
 * the specification and describes a compiler that no longer exists. Nothing
 * about writing it by hand stops that happening, so it is checked in both
 * directions.
 *
 * The check is deliberately about *keywords* rather than productions. A
 * production this page gets subtly wrong is a documentation bug somebody can
 * read and correct; a keyword the compiler accepts and this page never mentions
 * is a language feature with no specification at all, which is the failure that
 * matters.
 */

const GRAMMAR = readFileSync("docs/language/grammar.md", "utf8");

/** The reserved-word block at the end of the page. */
function reservedWords(): string[] {
  const section =
    /## Words the language reserves([\s\S]*?)```txt([\s\S]*?)```/.exec(GRAMMAR);
  if (!section?.[2]) {
    throw new Error(
      "grammar.md has no reserved-word block; the section heading or its fence has moved.",
    );
  }
  return section[2].trim().split(/\s+/);
}

describe("the published grammar", () => {
  it("lists every word the lexer reserves", () => {
    const listed = new Set(reservedWords());
    const missing = [...KEYWORDS].filter((word) => !listed.has(word)).sort();
    expect(
      missing,
      "these are keywords the compiler accepts and docs/language/grammar.md does not list",
    ).toEqual([]);
  });

  it("reserves no word the lexer does not", () => {
    const invented = reservedWords()
      .filter((word) => !KEYWORDS.has(word))
      .sort();
    expect(
      invented,
      "docs/language/grammar.md reserves these and the compiler has never heard of them",
    ).toEqual([]);
  });

  it("mentions every keyword somewhere in a production", () => {
    // A keyword in the reserved list and nowhere in the grammar is a word with
    // no syntax attached, which is how a half-removed feature survives in the
    // lexer for a release.
    const productions = GRAMMAR.slice(
      0,
      GRAMMAR.indexOf("## Words the language reserves"),
    );
    const unspecified = [...KEYWORDS]
      .filter(
        (word) =>
          !new RegExp(`"${word}"`).test(productions) &&
          !new RegExp(`\`${word}\``).test(productions),
      )
      .sort();
    expect(
      unspecified,
      "these keywords are reserved and no production or note in grammar.md uses them",
    ).toEqual([]);
  });

  it("says which of the three checkers rejects what it cannot express", () => {
    // A grammar that does not say what it leaves out reads as the whole
    // specification, and the whole point of this compiler is the rules that are
    // not syntactic.
    expect(GRAMMAR).toContain("What the grammar does not say");
    expect(GRAMMAR).toContain("packages/typechecker");
    expect(GRAMMAR).toContain("packages/semantic-analyzer");
    expect(GRAMMAR).toContain("packages/copybook");
  });
});
