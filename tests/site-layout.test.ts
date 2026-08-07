import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { docFiles } from "../tools/build-docs";

/**
 * Layout rules that were broken, found by measuring, and are now held.
 *
 * None of these is visible in a screenshot review, which is why each survived
 * an audit that looked at the pages. They were found by driving a browser at
 * six widths and reading the geometry, and they are asserted here so that the
 * next change that breaks one fails a build rather than waiting for somebody to
 * open the site on a phone.
 */

const SITE_CSS = readFileSync("packages/site/src/site.css", "utf8");
const PLAYGROUND_CSS = readFileSync(
  "packages/playground/src/styles.css",
  "utf8",
);
const PLAYGROUND_HTML = readFileSync("packages/playground/index.html", "utf8");

describe("the playground's output pane", () => {
  /**
   * Measured at 1227px of COBOL inside a 591px pane on a 390px screen, painting
   * over the trace bar and the footer beneath it.
   *
   * The cap was applied to `.pane` and the editor was given `flex: 1`, but
   * `#output-panel` sits between them and was a plain block, so the flex chain
   * broke there and nothing constrained the height. A fix that was believed to
   * be in place for a day and was not.
   */
  it("is part of the pane's flex column, so the height cap reaches the editor", () => {
    const block = /#output-panel\s*\{([^}]*)\}/.exec(PLAYGROUND_CSS)?.[1] ?? "";
    expect(block, "#output-panel has no rule at all").not.toBe("");
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex-direction:\s*column/);
    expect(block).toMatch(/flex:\s*1/);
    expect(block).toMatch(/min-height:\s*0/);
  });
});

describe("every page of the site", () => {
  /**
   * `overflow-x: hidden` on `body` alone does nothing when the overflow comes
   * from the header's flex row: the scrollbar appears on the root element,
   * which `body` cannot suppress. Measured at 34px over on a 360px screen after
   * a fifth link was added to the navigation.
   */
  it("cannot scroll sideways, on the root as well as the body", () => {
    expect(SITE_CSS).toMatch(
      /html,\s*\n?\s*body\s*\{[^}]*overflow-x:\s*hidden/,
    );
    expect(PLAYGROUND_CSS).toMatch(/overflow-x:\s*hidden/);
  });

  /**
   * The navigation takes a row of its own below the breakpoint rather than
   * relying on `flex-wrap`, which keeps items beside the wordmark until one of
   * them cannot break and then overflows instead of wrapping.
   */
  it("gives the header's navigation its own row on a narrow screen", () => {
    for (const [name, css] of [
      ["site.css", SITE_CSS],
      ["playground styles.css", PLAYGROUND_CSS],
    ] as const) {
      const narrow = /@media \(max-width: 40rem\)\s*\{([\s\S]*?)\n\}/.exec(
        css,
      )?.[1];
      expect(narrow, `${name} has no narrow-screen header rule`).toBeDefined();
      expect(narrow, name).toMatch(/flex-direction:\s*column/);
    }
  });
});

describe("headings", () => {
  /**
   * One `h1` per page.
   *
   * `docs/glossary.md` used a level-one heading for each letter of the
   * alphabet, so the rendered page had twenty. That is a real defect in two
   * directions: a screen reader announces twenty page titles, and a search
   * engine has no single statement of what the page is.
   */
  it("is one level-one heading per document", () => {
    const offenders: string[] = [];
    for (const file of docFiles()) {
      const text = readFileSync(`docs/${file}`, "utf8");
      const count = [...text.replace(/```[\s\S]*?```/g, "").matchAll(/^# /gm)]
        .length;
      if (count !== 1) {
        offenders.push(`docs/${file} has ${String(count)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The playground had none at all: a header, two panes of code, and no
   * statement of what the page is.
   */
  it("gives the playground one, even though it shows no title", () => {
    expect([...PLAYGROUND_HTML.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(PLAYGROUND_HTML).toMatch(/<h1 class="sr-only">/);
  });
});
