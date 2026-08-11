import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
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
import { buildAbout, buildBlog, buildFeed } from "../tools/build-blog";
import {
  builtPages,
  render404,
  renderLanding,
  servedPath,
  servedUrl,
  siteContent,
} from "../tools/build-site";

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
      // D5. Every page declares the feed, not only the blog: a reader who
      // wants to follow this is as likely to be on a documentation page, and a
      // feed reader looks at whatever page it was handed.
      "blog/feed.xml",
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

  /**
   * D2. The exact form, not a prefix.
   *
   * This asserted that the canonical *started with* `…/docs/`, which is why
   * F11 survived it: the docs index declared `…/docs/index.html` canonical
   * while its own sitemap entry said `…/docs/`, and both matched. Cloudflare
   * Pages answers `/docs/index.html` with a 308 to `/docs/`, so the page had
   * declared a redirect to be its own preferred URL.
   */
  it("gives every page a title, a description and the URL it is served at", () => {
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      expect(html, page).toMatch(/<title>[^<]+ — BankLang<\/title>/);
      expect(html, page).toMatch(/<meta name="description" content="[^"]+"/);

      const expected = servedUrl(relative(out, page));
      expect(html, page).toContain(`rel="canonical" href="${expected}"`);
      // And `og:url`, which is the same URL said again to a different reader.
      // A card that points somewhere else from the canonical is the same
      // defect wearing a different tag.
      expect(html, page).toContain(`property="og:url" content="${expected}"`);
      expect(html, page).not.toContain(
        'href="https://banklang.mwhassan.com/docs/index.html"',
      );
    }
  });

  /**
   * D3. A documentation page shared as a bare link used to render as a bare
   * link: no card, no title beyond the URL, no image.
   */
  it("carries the metadata a shared link needs", () => {
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const tag of [
        'property="og:type"',
        'property="og:title"',
        'property="og:description"',
        'property="og:image"',
        'property="og:image:alt"',
        'name="twitter:card" content="summary_large_image"',
        'name="twitter:title"',
        'name="twitter:description"',
        'name="twitter:image"',
        'rel="alternate" type="application/rss+xml"',
      ]) {
        expect(html, `${page}: ${tag}`).toContain(tag);
      }
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

/**
 * D2. What the sitemap says the site contains.
 *
 * Two failures, one ticket. Forty-seven of fifty-one entries named the `.html`
 * form, which Cloudflare Pages answers with a redirect rather than with the
 * page — "Page with redirect, not indexed" in Search Console. And the list was
 * written out by hand beside the build rather than derived from it, so the two
 * documentation directory indexes, which `buildDocs` has rendered all along,
 * were in no sitemap at all.
 */
describe("the sitemap", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "banklang-site-"));
    buildDocs(root);
    const written = buildBlog(root);
    buildFeed(root, written);
    buildAbout(root);
    // The landing page, which `build-site.ts` writes from the template rather
    // than through a builder. Rendered here so the comparison below covers the
    // one page a reader is most likely to arrive at.
    writeFileSync(join(root, "index.html"), renderLanding(siteContent()));
    // And the page served for every address that names no file, written the
    // same way and for the same reason.
    writeFileSync(join(root, "404.html"), render404());
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("names every page the build writes, and nothing else", () => {
    // The playground is built by Vite rather than here, so it is the one entry
    // this comparison cannot see and is asserted separately below.
    const listed = new Set(
      builtPages().filter((page) => page !== "playground/index.html"),
    );
    const written = new Set(
      htmlUnder(root).map((page) => relative(root, page).replace(/\\/g, "/")),
    );

    expect(written.size).toBeGreaterThan(45);
    expect(
      [...written].filter((page) => !listed.has(page)).sort(),
      "rendered, and in no sitemap",
    ).toEqual([]);
    expect(
      [...listed].filter((page) => !written.has(page)).sort(),
      "in the sitemap, and never rendered",
    ).toEqual([]);
  });

  it("includes the playground, which is built elsewhere", () => {
    expect(builtPages()).toContain("playground/index.html");
  });

  it("names the URL the host serves, not the file on disk", () => {
    for (const page of builtPages()) {
      const path = servedPath(page);
      expect(path, page).not.toMatch(/\.html$/);
      expect(path, page).toMatch(/^\//);
    }
    expect(servedPath("index.html")).toBe("/");
    expect(servedPath("docs/index.html")).toBe("/docs/");
    expect(servedPath("docs/language/sql.html")).toBe("/docs/language/sql");
    expect(servedPath("blog/why.html")).toBe("/blog/why");
  });

  it("agrees with the canonical each of those pages declares", () => {
    // The invariant that was broken: `/docs/index.html` as the canonical and
    // `/docs/` in the sitemap, for one page.
    //
    // The 404 page is the one page this cannot ask of, and the exclusion is the
    // rule rather than a hole in it: a canonical names the address a page is
    // served at, and that page is the answer given to every address that names
    // no page. Naming one would be picking an address for it. What it declares
    // instead is asserted below.
    for (const page of htmlUnder(root)) {
      const built = relative(root, page).replace(/\\/g, "/");
      if (built === "404.html") {
        continue;
      }
      const html = readFileSync(page, "utf8");
      const canonical = /rel="canonical" href="([^"]+)"/.exec(html)?.[1];
      expect(canonical, `${built} declares no canonical`).toBe(
        servedUrl(built),
      );
    }
  });

  it("has the 404 page declare noindex instead of an address", () => {
    const html = readFileSync(join(root, "404.html"), "utf8");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toContain('rel="canonical"');
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
 * Working papers, which are in neither the site nor the repository.
 *
 * The audits are this project's criticism of itself and the ticket lists are
 * the plans for answering it. They were kept in the repository on the argument
 * that somebody evaluating the engineering should be able to read them beside
 * the commits that answered them. That argument loses to a simpler one: one of
 * them records rewrites of this repository's own history, and a public repo is
 * not where that goes. `.gitignore` excludes `docs/working/`, so a clone does
 * not contain them and no commit adds them.
 *
 * The reasoning worth publishing goes in the commit message for the change it
 * explains, which is where somebody reading the history will actually find it.
 *
 * **A directory rather than a list of names.** The first answer to this was
 * `UNPUBLISHED = [/^audit-\d{4}-\d{2}-\d{2}\.md$/, /^launch-tickets\.md$/]`,
 * which fixed the two files that existed and left the next working paper
 * published by default under whatever it happened to be called — the audit's
 * F22. `docs/working/` is a decision the author makes while writing, and the
 * guard below turns the old list into a check on where a file is rather than
 * the rule for whether it ships. It still matters with the directory ignored:
 * the papers exist on the author's disk, and a build that runs there must not
 * render them into the public site.
 */
describe("the documents the site does not publish", () => {
  it("renders no audit and no ticket list", () => {
    const published = docFiles();
    expect(published.length).toBeGreaterThan(20);
    expect(
      published.filter((file) =>
        /(^|\/)audit-\d{4}-\d{2}-\d{2}\.md$/.test(file),
      ),
    ).toEqual([]);
    expect(published.filter((file) => file.startsWith("working/"))).toEqual([]);
    expect(published).not.toContain("working/launch-tickets.md");
  });

  /**
   * And the repository does not carry them either.
   *
   * Asserted against git rather than against the file system: they are on the
   * author's disk and must stay off every commit, which `existsSync` cannot
   * tell apart. `git ls-files` answers the question that matters — what a clone
   * gets.
   */
  it("keeps them out of the repository as well as off the site", () => {
    // Stryker runs from a nested sandbox inside the checkout. A relative
    // pathspec there means `.stryker-tmp/.../docs`, which correctly matches no
    // tracked files and makes this repository check fail before mutation even
    // starts. Ask Git for the real worktree first so the assertion means the
    // same thing from an ordinary test run and a mutation sandbox.
    const worktree = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const tracked = execFileSync("git", ["-C", worktree, "ls-files", "docs/"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line !== "");

    expect(tracked.length).toBeGreaterThan(20);
    expect(tracked.filter((file) => file.startsWith("docs/working/"))).toEqual(
      [],
    );
    expect(
      tracked.filter((file) =>
        /(^|\/)(audit-\d{4}-\d{2}-\d{2}|tickets-\d{4}-\d{2}-\d{2}|launch-tickets)\.md$/i.test(
          file,
        ),
      ),
    ).toEqual([]);
  });

  /**
   * Nothing published may link to one.
   *
   * They are not in the repository, so the GitHub fallback that a link out of
   * `docs/` gets would be a dead link on somebody else's domain. Refusing is
   * the only honest answer, and it fails the build rather than the reader.
   */
  it("refuses to render a link from a published page to a working paper", () => {
    expect(() =>
      rewriteLink("working/audit-2026-08-06.md", "for-decision-makers.md"),
    ).toThrow(/working paper/);
  });

  /**
   * The half that fails closed.
   *
   * A denylist is only as good as the names somebody remembered to put in it,
   * and the working paper written next year will have a name nobody predicted.
   * What the old patterns are good for is noticing that a file which is plainly
   * a working paper has been left where the site would publish it — so they
   * stop the build instead of deciding what ships.
   */
  it("refuses to build when a working paper is filed outside the directory", () => {
    const stray = "docs/audit-2999-01-01.md";
    writeFileSync(stray, "# A working paper in the wrong place\n", "utf8");
    try {
      expect(() => docFiles()).toThrow(/docs\/working/);
    } finally {
      rmSync(stray);
    }
  });

  /**
   * F21 was that the builder's comment claimed the README linked the audits by
   * name and `grep audit-2026 README.md` returned nothing. The links were added
   * to make the claim true; they are gone again, because the papers are gone.
   *
   * This is the assertion that keeps the two consistent: no tracked file may
   * name a path under `docs/working/`, in either direction. A link to a file a
   * clone does not have is the same defect F21 was, pointing the other way.
   */
  it("is linked from nothing that ships", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => file.endsWith(".md"));

    // Naming the directory is fine and necessary — `WORKING_PAPERS` and the
    // guard around it have to say what they exclude. A *link* is the defect:
    // it is a path a clone does not have, offered to a reader as one it does.
    const link = /\]\(([^)]*\b(?:docs\/)?working\/[^)]+)\)/g;
    const offenders: string[] = [];
    for (const file of tracked) {
      if (!existsSync(file)) {
        continue;
      }
      for (const [, target] of readFileSync(file, "utf8").matchAll(link)) {
        offenders.push(`${file} → ${target ?? ""}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still resolves a published link on the site", () => {
    expect(rewriteLink("verification.md", "roadmap.md")).toBe(
      "verification.html",
    );
    // And one that leaves `docs/` still goes to the repository, where it is.
    expect(rewriteLink("../CONTRIBUTING.md", "roadmap.md")).toBe(
      "https://github.com/MWH997/banklang/blob/main/CONTRIBUTING.md",
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
