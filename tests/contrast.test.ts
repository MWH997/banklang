import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Colour contrast, computed.
 *
 * E6 put `axe-core` over every page template and switched `color-contrast` off,
 * because that rule needs a layout engine jsdom does not have. The reasoning was
 * sound and the consequence was that the one accessibility property this site
 * makes a claim about was the one nothing checked. The launch checklist
 * recorded "every colour pair in both themes clears WCAG AA at worst 4.87:1",
 * measured by hand on 2026-08-06 — before the Input panel, the stacked code
 * figures, the theme toggle's pressed state and four stylesheet revisions. It
 * was already wrong when this file was written: the true worst pair is 4.57:1.
 *
 * A ratio does not need a layout engine. It needs the two colours, and both are
 * design tokens with names. So this reads the tokens out of the stylesheets and
 * computes, which holds the claim on every future change rather than on the day
 * somebody looked.
 *
 * What it does not do is discover which pairs are painted together — that does
 * need layout. Instead it asserts the stronger thing the claim already says:
 * *every* foreground token clears AA on *every* background token, so any pairing
 * the CSS makes is covered whether or not this file knows about it.
 */

const SHEETS = [
  "packages/site/src/site.css",
  "packages/playground/src/styles.css",
] as const;

/** WCAG 2.2 relative luminance. */
function luminance(hex: string): number {
  const pairs = hex.replace("#", "").match(/../g);
  if (!pairs || pairs.length < 3) {
    throw new Error(`${hex} is not a six-digit colour.`);
  }
  const [r, g, b] = pairs.slice(0, 3).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

interface Theme {
  /** `site.css :root[data-theme="dark"]`, for a failure somebody can find. */
  where: string;
  tokens: Record<string, string>;
}

/**
 * Every block that defines colour tokens, in every sheet.
 *
 * There are four per sheet and they must all be checked: `:root` is the dark
 * default, the media query is the light theme for a reader who has chosen
 * nothing, and the two `[data-theme]` blocks are what the toggle sets. A theme
 * that is only wrong in one of the four is the one nobody opens.
 */
function themes(): Theme[] {
  const found: Theme[] = [];
  for (const sheet of SHEETS) {
    const css = readFileSync(sheet, "utf8");
    const blocks = css.matchAll(
      /(:root(?:\[data-theme="[a-z]+"\])?|@media \(prefers-color-scheme: [a-z]+\))\s*\{([\s\S]*?)\n\}/g,
    );
    for (const [, selector, body] of blocks) {
      const tokens = Object.fromEntries(
        [
          ...(body ?? "").matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g),
        ].map((match) => [match[1]!, match[2]!]),
      );
      if (Object.keys(tokens).length > 0) {
        found.push({ where: `${sheet} ${selector ?? ""}`, tokens });
      }
    }
  }
  return found;
}

/** What text is painted on. */
const BACKGROUNDS = ["bg", "panel", "panel-2"];

/**
 * Tokens that are not text and are not a control's edge.
 *
 * `--border` is the rule between two table cells and the line under the header.
 * WCAG 1.4.11 covers "visual information required to identify user interface
 * components", and a separator identifies nothing — holding it to 3:1 would be
 * inventing a requirement and would darken every hairline on the site to satisfy
 * a test rather than a reader.
 */
const NOT_TEXT = ["border", "field"];

describe("the palette", () => {
  it("defines the same tokens in every theme of every sheet", () => {
    const found = themes();
    expect(found.length).toBe(8);
    for (const theme of found) {
      for (const token of [...BACKGROUNDS, ...NOT_TEXT, "text", "muted"]) {
        expect(theme.tokens[token], `${theme.where} has no --${token}`).toMatch(
          /^#[0-9a-fA-F]{6}$/,
        );
      }
    }
  });

  /**
   * WCAG 2.2 SC 1.4.3, at the AA threshold of 4.5:1.
   *
   * Every foreground on every background rather than the pairs in use: the
   * claim this holds is "every colour pair in both themes", and a test that
   * enumerated the pairings would go stale the first time a class moved.
   */
  it("clears AA for every foreground on every background", () => {
    const failures: string[] = [];
    for (const theme of themes()) {
      for (const [name, colour] of Object.entries(theme.tokens)) {
        if (BACKGROUNDS.includes(name) || NOT_TEXT.includes(name)) {
          continue;
        }
        for (const background of BACKGROUNDS) {
          const behind = theme.tokens[background];
          if (!behind) {
            continue;
          }
          const ratio = contrast(colour, behind);
          if (ratio < 4.5) {
            failures.push(
              `${theme.where}: --${name} on --${background} is ${ratio.toFixed(2)}:1`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * WCAG 2.2 SC 1.4.11, at 3:1, for the edge of a control.
   *
   * This is the one the hand measurement missed, and enabling `color-contrast`
   * in axe would not have found it either — that rule reads text. The
   * documentation search is an `<input>` with the page's own background and a
   * one-pixel `--border` outline: 1.45:1 in the light theme, on forty-five
   * pages, and the only thing on screen saying there is a search box there.
   */
  it("clears AA for the edge of every control", () => {
    const failures: string[] = [];
    for (const theme of themes()) {
      const field = theme.tokens.field;
      if (!field) {
        continue;
      }
      for (const background of BACKGROUNDS) {
        const behind = theme.tokens[background];
        if (!behind) {
          continue;
        }
        const ratio = contrast(field, behind);
        if (ratio < 3) {
          failures.push(
            `${theme.where}: --field on --${background} is ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * And the controls really do use it.
   *
   * The token is worth nothing if a new input is written against `--border`,
   * which is what every other bordered thing in these sheets uses. Held as the
   * rule: anything that takes a keystroke or a click has a `--field` edge.
   */
  it("gives every interactive control the field edge, not the separator", () => {
    const controls = [
      ["packages/site/src/docs.css", ".search input {"],
      ["packages/site/src/site.css", ".ghost {"],
      ["packages/site/src/site.css", ".button {"],
      ["packages/playground/src/styles.css", ".ghost {"],
      ["packages/playground/src/styles.css", ".input__field input {"],
    ] as const;

    for (const [sheet, selector] of controls) {
      const css = readFileSync(sheet, "utf8");
      const at = css.indexOf(selector);
      expect(at, `${sheet} no longer has ${selector}`).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf("}", at));
      expect(
        rule,
        `${sheet} ${selector} uses the separator colour`,
      ).not.toMatch(/border(-[a-z]+)?:[^;]*var\(--border\)/);
    }
  });

  /**
   * The worst pair on the site, named.
   *
   * P5's "at worst 4.87:1" was a number in a document that nothing recomputed,
   * and it drifted. This prints the real one on failure, so the next person to
   * quote a figure quotes one a test produced.
   */
  it("has a worst pair, and it is above the threshold", () => {
    let worst = { ratio: Infinity, what: "nothing" };
    for (const theme of themes()) {
      for (const [name, colour] of Object.entries(theme.tokens)) {
        if (BACKGROUNDS.includes(name) || NOT_TEXT.includes(name)) {
          continue;
        }
        for (const background of BACKGROUNDS) {
          const behind = theme.tokens[background];
          if (!behind) {
            continue;
          }
          const ratio = contrast(colour, behind);
          if (ratio < worst.ratio) {
            worst = {
              ratio,
              what: `--${name} on --${background} in ${theme.where}`,
            };
          }
        }
      }
    }
    expect(worst.ratio, `worst pair is ${worst.what}`).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
