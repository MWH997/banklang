import { readFileSync } from "node:fs";

import axe, { type Result } from "axe-core";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { posts, renderPost } from "../tools/build-blog";
import {
  docFiles,
  navigation,
  renderDoc,
  renderPage,
} from "../tools/build-docs";
import { renderLanding, siteContent, SITE_ORIGIN } from "../tools/build-site";

/**
 * Every page template, read by axe-core.
 *
 * Five specific defects were found here by hand: two unlabelled editors, an
 * `h1` outside `<main>`, a docs sidebar whose group labels preceded the page
 * heading, stat chips reading `1records`, and a theme toggle with no state.
 * Fixing five defects fixes five defects. This file is what stops the next
 * five, because the next five will be a different five and nobody is going to
 * find them by looking.
 *
 * **jsdom rather than a real browser.** The ticket said a Vitest browser test,
 * and that would additionally catch contrast and anything that depends on
 * layout. It also means Playwright in `devDependencies`, a browser download in
 * CI, and an install script running arbitrary code, and `pnpm-workspace.yaml`
 * takes install scripts one decision at a time on purpose. Every one of those
 * five defects is structural: a name, a role, a heading order, a state. jsdom
 * sees all of them and `axe-core` is the same rule set either way.
 *
 * What is given up is `color-contrast`, which needs a layout engine and is
 * turned off below rather than left to fail silently. `tests/site-layout.test.ts`
 * holds the measured geometry, from a real browser, by hand, and
 * `tests/contrast.test.ts` computes every ratio in the palette from the
 * tokens, which is the half axe would have given back and more of it. Axe reads
 * text, and the failure actually on this site was the outline of the
 * documentation search box under SC 1.4.11.
 *
 * **The playground is audited as it is served, not as it ends up.** Its two
 * editors are inserted by CodeMirror at run time, so the names it gives them
 * through `EditorView.contentAttributes` are not in this DOM. Everything the
 * page ships is: the tablist, the pickers, the landmarks, the headings.
 */

/** Rules that need a rendering engine, and would report nothing useful here. */
const NEEDS_LAYOUT = ["color-contrast"];

/**
 * The standards the pages are held to.
 *
 * WCAG 2.2 AA, which is what the EU Accessibility Act and the UK public sector
 * regulations both name, plus axe's own best-practice set. The second is where
 * "the page has one main landmark" and "headings are in order" live, and those
 * are exactly the two that were wrong.
 */
const STANDARD = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

interface Audit {
  violations: Result[];
  /** How many rules actually ran, so a misconfigured audit cannot pass empty. */
  checked: number;
}

async function audit(html: string): Promise<Audit> {
  // `SITE_ORIGIN`, not a domain nobody owns. `bankc init` shipped a `$schema`
  // pointing at `banklang.dev` for the same reason: it reads like this
  // project's domain and is somebody else's.
  const dom = new JSDOM(html, {
    url: `${SITE_ORIGIN}/`,
    pretendToBeVisual: true,
  });
  try {
    const results = await axe.run(
      dom.window.document.documentElement as unknown as Element,
      {
        runOnly: { type: "tag", values: STANDARD },
        rules: Object.fromEntries(
          NEEDS_LAYOUT.map((rule) => [rule, { enabled: false }]),
        ),
      },
    );
    return {
      violations: results.violations,
      checked:
        results.violations.length +
        results.passes.length +
        results.incomplete.length,
    };
  } finally {
    dom.window.close();
  }
}

/** A failure somebody can act on: the rule, the impact, and the element. */
function report(violations: Result[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n` +
        violation.nodes
          .slice(0, 4)
          .map((node) => `    ${node.html.replace(/\s+/g, " ").slice(0, 160)}`)
          .join("\n") +
        `\n    ${violation.helpUrl}`,
    )
    .join("\n\n");
}

/**
 * The four templates, each rendered the way the build renders it.
 *
 * Rendered rather than read out of `dist/site`, for the same reason the docs
 * tests build into a temporary directory: a test that reads the last build
 * passes on whatever somebody happened to leave there.
 */
const PAGES: { name: string; html: () => string }[] = [
  { name: "the home page", html: () => renderLanding(siteContent()) },
  {
    name: "a documentation page",
    html: () => {
      const page = docFiles().find((file) =>
        file.endsWith("getting-started.md"),
      );
      if (!page) {
        throw new Error("docs/getting-started.md is no longer built.");
      }
      // `renderPage`, not `renderDoc`: the second is the article, and a
      // fragment has no `<title>`, no `lang` and no landmarks to be outside of.
      // Auditing it reports three defects the page does not have and hides the
      // sidebar, which is where the heading-order defect was.
      return renderPage(renderDoc(page), navigation());
    },
  },
  {
    name: "a blog post",
    html: () => {
      const post = posts()[0];
      if (!post) {
        throw new Error("There are no posts to render.");
      }
      return renderPost(post);
    },
  },
  {
    name: "the playground",
    html: () => readFileSync("packages/playground/index.html", "utf8"),
  },
];

describe("every page template", () => {
  for (const page of PAGES) {
    it(`has no accessibility violations: ${page.name}`, async () => {
      const result = await audit(page.html());

      expect(
        result.violations.length,
        `${page.name}:\n\n${report(result.violations)}\n`,
      ).toBe(0);
    });

    /**
     * An audit that ran no rules reports no violations, and looks exactly like
     * a page with none. This is the same guard `checked()` gives the corpus
     * assertions: state the floor, so a configuration mistake fails instead of
     * quietly checking nothing.
     */
    it(`is actually audited: ${page.name}`, async () => {
      const result = await audit(page.html());

      expect(result.checked).toBeGreaterThan(20);
    });
  }
});
