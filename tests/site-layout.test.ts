import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { statChip } from "../packages/playground/src/html";
import { posts, renderPost } from "../tools/build-blog";
import {
  docFiles,
  navigation,
  renderDoc,
  renderPage,
} from "../tools/build-docs";
import { renderLanding, siteContent } from "../tools/build-site";

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

  /**
   * E3. The `h1` is first.
   *
   * The sidebar's group labels were `h2` and the sidebar precedes `<main>` in
   * the document, so every documentation page opened with four level-two
   * headings before its own title. The one-`h1` check above passed throughout,
   * and so did `axe-core`: its `heading-order` rule allows a level to *fall*,
   * so `h2 h2 h2 h2 h1` is not a violation to it. It is still a page that
   * announces four things before saying what it is.
   */
  it("puts the documentation page's h1 before any other heading", () => {
    const page = docFiles().find((file) => file.endsWith("getting-started.md"));
    expect(page).toBeDefined();
    const html = renderPage(renderDoc(page!), navigation());

    const headings = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) =>
      Number(match[1]),
    );
    expect(headings.length).toBeGreaterThan(3);
    expect(
      headings[0],
      "something is announced before the page's own title",
    ).toBe(1);
  });

  /**
   * E2. The editor, the artifact tabs and the summary had no heading of any
   * kind, so a reader moving by heading went from the page title to the end of
   * the document. The Run panel already emitted `h3`s, so the pattern existed
   * and had simply not been applied to the frame around it.
   */
  it("gives the playground's panes headings, hidden but present", () => {
    for (const [id, level] of [
      ["h-source", 2],
      ["h-output", 2],
      ["h-summary", 3],
    ] as const) {
      const heading = new RegExp(
        `<h${String(level)} class="sr-only" id="${id}">`,
      );
      expect(PLAYGROUND_HTML, `${id} is missing`).toMatch(heading);
    }

    // And each names the region it heads, so the pane is announced as a group
    // rather than as an unlabelled section.
    expect(PLAYGROUND_HTML).toContain('aria-labelledby="h-source"');
    expect(PLAYGROUND_HTML).toContain('aria-labelledby="h-output"');

    const levels = [...PLAYGROUND_HTML.matchAll(/<h([1-6])[\s>]/g)].map(
      (match) => Number(match[1]),
    );
    expect(levels[0]).toBe(1);
    for (const [index, level] of levels.entries()) {
      const previous = levels[index - 1] ?? level;
      expect(
        level - previous,
        `heading level jumps at ${String(index)}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * E1. Both CodeMirror instances exposed `role="textbox"` with no accessible
 * name, so a screen-reader user reaching the product's primary interactive
 * surface was told "text box" — WCAG 4.1.2.
 *
 * Asserted against the source rather than a rendered editor: CodeMirror needs
 * layout that jsdom does not provide, and what is being checked is that the
 * name is set at all and set on the element that carries the role.
 * `contentAttributes` is that element; an attribute on the wrapper would not be.
 */
describe("the playground's editors", () => {
  const MAIN = readFileSync("packages/playground/src/main.ts", "utf8");

  it("are named, and named on the element with the role", () => {
    const named = [...MAIN.matchAll(/EditorView\.contentAttributes\.of\(/g)];
    expect(named, "one editor is unnamed").toHaveLength(2);
    expect(MAIN).toContain('"aria-label": "BankTS source"');
    expect(MAIN).toContain('"aria-label": "Generated COBOL, read only"');
  });
});

/**
 * E5. `<button id="theme" aria-label="Switch between light and dark">Theme</button>`
 * on four pages: no state, and a label that never changed. Neither a sighted
 * nor a screen-reader user could tell the current mode from the control.
 *
 * Four copies, because two of these pages are static files and two are
 * generated. Held together here rather than trusted to stay in step.
 */
describe("the theme toggle", () => {
  const surfaces: [string, string][] = [
    ["the home page", renderLanding(siteContent())],
    ["the playground", PLAYGROUND_HTML],
    [
      "a documentation page",
      renderPage(renderDoc(docFiles()[0]!), navigation()),
    ],
    ["a blog post", renderPost(posts()[0]!)],
  ];

  it("says which theme is on, on every page that has one", () => {
    for (const [name, html] of surfaces) {
      expect(html, name).toMatch(/<button[^>]*id="theme"[\s\S]{0,200}?>/);
      expect(html, name).toContain('aria-pressed="false"');
      expect(html, name).toContain("Dark mode");
      expect(html, `${name} still carries the old label`).not.toContain(
        "Switch between light and dark",
      );
    }
  });

  it("keeps that state true, including when nothing was ever chosen", () => {
    // The whole reason this needs a script rather than an attribute: with no
    // stored choice the effective theme is the system's, and it can change
    // while the page is open.
    const scripts = [
      ["the home page", renderLanding(siteContent())],
      [
        "a documentation page",
        renderPage(renderDoc(docFiles()[0]!), navigation()),
      ],
      ["a blog post", renderPost(posts()[0]!)],
      [
        "the playground",
        readFileSync("packages/playground/src/main.ts", "utf8"),
      ],
    ] as const;
    for (const [name, source] of scripts) {
      expect(source, name).toMatch(/aria-pressed/);
      expect(
        source,
        `${name} never follows a change of system preference`,
      ).toMatch(/addEventListener\(\s*"change"/);
    }
  });
});

/**
 * E4. `<b>${value}</b>${label}` with the gap supplied by `margin-right`, so
 * `textContent` was `1records` — what a screen reader announces and what a copy
 * and paste produces — and the labels were plurals written at the call sites,
 * so one record read "1 records".
 */
describe("the summary chips", () => {
  const text = (html: string): string =>
    new JSDOM(`<div>${html}</div>`).window.document.body.textContent;

  it("puts a real space between the number and the word", () => {
    expect(text(statChip("record", 3))).toBe("3 records");
  });

  it("says one record rather than one records", () => {
    expect(text(statChip("record", 1))).toBe("1 record");
    expect(text(statChip("audit event", 1))).toBe("1 audit event");
    expect(text(statChip("audit event", 0))).toBe("0 audit events");
  });

  it("does not rely on the stylesheet for the gap", () => {
    expect(PLAYGROUND_CSS).not.toMatch(/\.stat b \{[^}]*margin-right/);
  });
});
