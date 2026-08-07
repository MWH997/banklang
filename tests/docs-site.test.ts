import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildDocs,
  docFiles,
  navigation,
  plainInline,
  renderDoc,
  rewriteLink,
  type SearchEntry,
} from "../tools/build-docs";

/**
 * The documentation, rendered as part of the site.
 *
 * D1. Forty-two documents that were readable only as raw Markdown on
 * github.com, several of them the strongest evidence this project has.
 *
 * What is worth testing here is not that pages exist — a build that produced no
 * pages would be noticed immediately. It is the two things that rot silently:
 *
 * - **Links.** These documents cross-reference each other more than two
 *   thousand times, written for GitHub, where `../verification.md#what-it-scored`
 *   works. On a static site it does not, and a link that 404s on the page a bank
 *   was sent is worse than the raw Markdown it replaced. Every one is resolved
 *   against the built tree, anchors included.
 * - **Coverage.** The sidebar's grouping is read out of the README, so a
 *   document nobody added to the README must still be rendered and still be
 *   reachable, or adding a page quietly hides it.
 *
 * The build runs into a temporary directory rather than `dist/`, so this does
 * not depend on `pnpm build:site` having been run and cannot be fooled by a
 * stale one.
 */

let out: string;
let pages: string[];

const htmlUnder = (root: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".html")) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
};

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "banklang-docs-"));
  buildDocs(out);
  pages = htmlUnder(join(out, "docs"));
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("every document is published", () => {
  it("renders one page per markdown file under docs/", () => {
    for (const file of docFiles()) {
      const page = join(out, "docs", file.replace(/\.md$/, ".html"));
      expect(existsSync(page), `${file} was not rendered`).toBe(true);
    }
  });

  it("renders nothing that is not a document", () => {
    // One page per document, plus the docs index and one per subdirectory.
    const directories = new Set(
      docFiles()
        .map((file) => dirname(file))
        .filter((directory) => directory !== "."),
    );
    expect(pages).toHaveLength(docFiles().length + 1 + directories.size);
  });

  it("gives every subdirectory a page, because documents link to them", () => {
    // `docs/language/` is written as a link in more than one document, and on
    // GitHub that resolves to a directory listing. Nothing serves one here.
    expect(existsSync(join(out, "docs/language/index.html"))).toBe(true);
    expect(existsSync(join(out, "docs/adr/index.html"))).toBe(true);
  });
});

describe("every link in the rendered site resolves", () => {
  it("resolves each relative href against a file that exists", () => {
    const docsRoot = join(out, "docs");
    const broken: string[] = [];
    const outside = new Set<string>();
    let checked = 0;

    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const href = match[1] ?? "";
        if (/^(https?:|mailto:|#)/.test(href)) {
          continue;
        }
        const [path] = href.split("#");
        if (!path) {
          continue;
        }
        const target = resolve(dirname(page), path);

        // Only `docs/` is built here. A link to the stylesheet, the favicon or
        // the landing page leaves this tree, and what matters about those is
        // not that they resolve inside a temporary directory but that they are
        // the ones `build-site.ts` actually writes — checked below.
        if (!target.startsWith(docsRoot)) {
          outside.add(relative(out, target) || "(the site root)");
          continue;
        }

        checked += 1;
        const ok =
          existsSync(target) &&
          (statSync(target).isFile() || existsSync(join(target, "index.html")));
        if (!ok) {
          broken.push(`${page.slice(out.length)} -> ${href}`);
        }
      }
    }

    expect(
      checked,
      "no links were checked, so this proves nothing",
    ).toBeGreaterThan(1000);
    expect([...new Set(broken)]).toEqual([]);

    // Everything a documentation page reaches for outside `docs/`. Each is
    // written by `build-site.ts`; a new one appearing here without being added
    // there is a page pointing at a file the site does not serve.
    expect([...outside].sort()).toEqual([
      "(the site root)",
      "assets/docs.css",
      "assets/site.css",
      "blog",
      "favicon.svg",
      "playground",
    ]);
  });

  it("resolves each anchor against an id on the page it names", () => {
    const ids = new Map<string, Set<string>>();
    for (const page of pages) {
      ids.set(
        page,
        new Set(
          [...readFileSync(page, "utf8").matchAll(/id="([^"]+)"/g)].map(
            (m) => m[1] ?? "",
          ),
        ),
      );
    }

    const broken: string[] = [];
    let checked = 0;
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const match of html.matchAll(/href="([^"#]*)#([^"]+)"/g)) {
        const [, path = "", anchor = ""] = match;
        if (/^https?:/.test(path)) {
          continue;
        }
        const target = path ? resolve(dirname(page), path) : page;
        const known = ids.get(target);
        if (!known) {
          continue;
        }
        checked += 1;
        if (!known.has(anchor)) {
          broken.push(`${page.slice(out.length)} -> ${path}#${anchor}`);
        }
      }
    }

    expect(checked, "no anchors were checked").toBeGreaterThan(100);
    expect([...new Set(broken)]).toEqual([]);
  });

  it("leaves no `.md` href in the rendered output", () => {
    // The whole point of the rewrite: a `.md` link on a static site is a 404,
    // and it is the failure that looks fine until somebody clicks it.
    const offenders: string[] = [];
    for (const page of pages) {
      for (const match of readFileSync(page, "utf8").matchAll(
        /href="([^"]*\.md(?:#[^"]*)?)"/g,
      )) {
        const href = match[1] ?? "";
        // A link out of `docs/` is rewritten to the repository, where the file
        // really is Markdown and really is at that path.
        if (href.startsWith("https://github.com/")) {
          continue;
        }
        offenders.push(`${page.slice(out.length)} -> ${href}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("rewriting a link written for GitHub", () => {
  it("turns a sibling document into its rendered page", () => {
    expect(rewriteLink("verification.md", "comparison.md")).toBe(
      "verification.html",
    );
  });

  it("keeps the anchor, which is what most of them carry", () => {
    expect(rewriteLink("verification.md#what-it-scored", "comparison.md")).toBe(
      "verification.html#what-it-scored",
    );
  });

  it("walks up out of a subdirectory", () => {
    expect(rewriteLink("../diagnostics.md", "language/sql.md")).toBe(
      "../diagnostics.html",
    );
  });

  it("sends a link out of docs/ to the repository, where the file still is", () => {
    // `../examples/` and `../runtime/zunit/EQAITERC.cpy` are real paths in the
    // repository and are not published on this site.
    expect(rewriteLink("../evidence/GRADES.md", "divergences.md")).toBe(
      "https://github.com/MWH997/banklang/blob/main/evidence/GRADES.md",
    );
  });

  it("leaves an external link alone", () => {
    const ibm = "https://www.ibm.com/docs/en/cobol-zos/6.4";
    expect(rewriteLink(ibm, "target-conformance.md")).toBe(ibm);
  });

  it("leaves a bare anchor alone", () => {
    expect(rewriteLink("#the-numeric-model", "numeric-model.md")).toBe(
      "#the-numeric-model",
    );
  });
});

describe("the sidebar", () => {
  const groups = navigation();

  it("is grouped the way the README groups the documentation", () => {
    // Read out of the README rather than written twice. If the README's
    // headings change, this is the test that says the sidebar changed with it.
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    for (const group of groups) {
      if (group.title === "Everything else") {
        continue;
      }
      expect(readme).toContain(`**${group.title}**`);
    }
    expect(groups.length).toBeGreaterThan(3);
  });

  it("reaches every document, including the ones the README does not list", () => {
    const linked = new Set(groups.flatMap((g) => g.entries.map((e) => e.file)));
    for (const file of docFiles()) {
      expect(linked.has(file), `${file} is in no sidebar group`).toBe(true);
    }
  });

  it("marks the page being read, so a reader knows where they are", () => {
    const page = readFileSync(join(out, "docs/getting-started.html"), "utf8");
    expect(page).toContain('aria-current="page"');
  });
});

describe("the search index", () => {
  const index = (): SearchEntry[] =>
    JSON.parse(
      readFileSync(join(out, "assets/search-index.json"), "utf8"),
    ) as SearchEntry[];

  it("carries every document", () => {
    expect(index()).toHaveLength(docFiles().length);
  });

  it("points at pages that exist", () => {
    for (const entry of index()) {
      expect(existsSync(join(out, "docs", entry.u)), entry.u).toBe(true);
    }
  });

  it("finds a page by a word only its body contains", () => {
    // The index is the only thing standing between a reader and 42 documents;
    // an empty body field would still pass every check above.
    const hits = index().filter((entry) => entry.b.includes("banker"));
    expect(hits.length).toBeGreaterThan(0);
  });

  /**
   * The whole page, not the first four thousand characters of it.
   *
   * The body used to be truncated, and the effect was that most of the
   * documentation could not be searched: the diagnostics catalogue is 29 KB and
   * everything past its opening was invisible. This was found when a paragraph
   * added near the top of one page pushed the only occurrence of "banker" in
   * the corpus past the cutoff and the check above started failing, which is a
   * test passing for a reason nobody chose.
   */
  /**
   * The names a reader of a compiler's documentation actually types.
   *
   * `docs.js` opens by saying that a reader is nearly always looking for a page
   * by name — `EIBRESP`, `rounding`, `BANK-LED-001` — and the index stripped
   * every inline code span, so all three of the code-shaped ones matched
   * nothing. The search could not find the things it was built to find.
   */
  it("finds a diagnostic id, a picture clause and a CICS field", () => {
    const body = index()
      .map((entry) => entry.b)
      .join(" ");
    for (const term of [
      "bank-led-001",
      "comp-3",
      "eibresp",
      "sqlcode",
      "file status",
    ]) {
      expect(body, `the search index cannot find ${term}`).toContain(term);
    }
  });

  it("indexes every page in full, not only its opening", () => {
    const entries = index();
    const catalogue = entries.find((entry) => entry.u === "diagnostics.html");
    expect(catalogue, "diagnostics.html is not in the index").toBeDefined();
    // The last diagnostic in the catalogue, which sits well past 4,000
    // characters into the page.
    const last = readFileSync("docs/diagnostics.md", "utf8")
      .match(/BANK-[A-Z]+-\d+/g)
      ?.at(-1);
    expect(last).toBeDefined();
    expect(
      catalogue?.b,
      `the index does not reach ${last ?? ""}, so most of the catalogue cannot be searched`,
    ).toContain(last!.toLowerCase());
  });
});

describe("the rendered pages keep the site's promises", () => {
  it("fetches nothing from another host", () => {
    // The same rule the landing page is held to: a compiler that makes a point
    // of having no network call in its pipeline should not pull a font from
    // somebody else's CDN in order to say so.
    const offenders: string[] = [];
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const match of html.matchAll(
        /<(?:script|img|iframe)\b[^>]*\bsrc="(https?:[^"]*)"/g,
      )) {
        offenders.push(`${page.slice(out.length)}: ${match[1] ?? ""}`);
      }
      for (const match of html.matchAll(
        /<link\b[^>]*\bhref="(https?:[^"]*)"/g,
      )) {
        const tag = match[0];
        if (/rel="(canonical|alternate)"/.test(tag)) {
          continue;
        }
        offenders.push(`${page.slice(out.length)}: ${match[1] ?? ""}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives every page a title, a description and a canonical URL", () => {
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      expect(html, page).toMatch(/<title>[^<]+ — BankLang<\/title>/);
      expect(html, page).toMatch(/<meta name="description" content="[^"]+"/);
      expect(html, page).toContain(
        'rel="canonical" href="https://banklang.mwhassan.com/docs/',
      );
    }
  });

  it("renders COBOL with the indicator area respected", () => {
    // The same highlighter the landing page uses: a `*` in column 7 is a
    // comment, and colouring it as code misrepresents the output.
    // `for-mainframe-engineers.md` is the page with the most generated COBOL on
    // it, which makes it the one where getting this wrong would matter most.
    const page = readFileSync(
      join(out, "docs/for-mainframe-engineers.html"),
      "utf8",
    );
    expect(page.match(/class="c-com"/g)?.length ?? 0).toBeGreaterThan(10);
  });
});

describe("headings", () => {
  it("are listed as a reader sees them, not as they are written", () => {
    // `D1. \`USAGE NATIONAL\` inside a group — **measured**` arrived in the
    // contents list with its asterisks and backticks intact.
    expect(
      plainInline("D1. `USAGE NATIONAL` inside a group — **measured**"),
    ).toBe("D1. USAGE NATIONAL inside a group — measured");
    expect(plainInline("A [linked](to.md) heading")).toBe("A linked heading");
  });

  it("keeps the id GitHub would have given them, so existing anchors work", () => {
    const doc = renderDoc("numeric-model.md");
    for (const heading of doc.headings) {
      expect(heading.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(doc.headings.length).toBeGreaterThan(1);
  });
});

describe("the source the docs are built from", () => {
  /**
   * The generator must never write into `docs/`: the Markdown is the source of
   * truth and the site is a view of it.
   *
   * Measured by hashing the tree either side of a build rather than by reading
   * `git status`, which was the first attempt and was wrong: it reported any
   * uncommitted edit to a document as though the build had made it, so editing
   * a page and running the suite failed this for a reason that had nothing to
   * do with the generator.
   */
  const fingerprint = (): string => {
    const hash = createHash("sha256");
    for (const file of docFiles()) {
      hash.update(file);
      hash.update(readFileSync(join(process.cwd(), "docs", file)));
    }
    return hash.digest("hex");
  };

  it("is left byte-for-byte alone by a build", () => {
    const before = fingerprint();

    const scratch = mkdtempSync(join(tmpdir(), "banklang-docs-immutable-"));
    try {
      buildDocs(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    expect(fingerprint(), "the docs build wrote into docs/").toBe(before);
  });
});

/**
 * Working papers that stay in the repository and off the site.
 *
 * The audits are this project's criticism of itself and `launch-tickets.md` is
 * the plan for answering it. Both belong in the repository, next to the commits
 * that did the answering. Neither is written for somebody who arrived from a
 * link — and the site rendered them anyway, put them in `sitemap.xml`, and
 * pointed search engines at them, so a reader searching the site met the
 * pre-publication security checklist and an author's address.
 *
 * Excluded, not hidden: GitHub renders every one of them, and the links now go
 * there rather than to a page this site does not serve.
 */
describe("the documents the site does not publish", () => {
  it("renders no audit and no ticket list", () => {
    const published = docFiles();
    expect(published.length).toBeGreaterThan(20);
    expect(published.filter((file) => /^audit-/.test(file))).toEqual([]);
    expect(published).not.toContain("launch-tickets.md");
  });

  it("still has them in the repository, which is the point", () => {
    // Excluding a document from the site must not be a reason to delete it.
    expect(existsSync("docs/launch-tickets.md")).toBe(true);
    expect(existsSync("docs/audit-2026-08-06.md")).toBe(true);
  });

  it("sends a link to one of them to GitHub rather than to a 404", () => {
    expect(rewriteLink("audit-2026-08-06.md", "for-decision-makers.md")).toBe(
      "https://github.com/MWH997/banklang/blob/main/docs/audit-2026-08-06.md",
    );
    expect(rewriteLink("launch-tickets.md", "roadmap.md")).toBe(
      "https://github.com/MWH997/banklang/blob/main/docs/launch-tickets.md",
    );
    // A published one still resolves on the site.
    expect(rewriteLink("verification.md", "roadmap.md")).toBe(
      "verification.html",
    );
  });

  it("carries the author's address on no published page", () => {
    // It is in CITATION.cff on purpose, which is a file rather than a page.
    // It was on two rendered pages, in a paragraph about identity.
    for (const file of docFiles()) {
      const text = readFileSync(join("docs", file), "utf8");
      expect(text, `${file} prints an email address`).not.toMatch(
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
      );
    }
  });
});
