/**
 * Render `docs/` as part of the site.
 *
 * D1 in `docs/launch-tickets.md`. Forty-two documents, several of them the
 * strongest evidence this project has, readable until now only as raw Markdown
 * on github.com — where the tables are fine, the cross-references work, and
 * nobody arriving from a link ever reads the second one.
 *
 * **Nothing here rewrites the content.** The Markdown in `docs/` is the source
 * of truth and stays exactly as it is; this is presentation. Two consequences
 * follow, and both are load-bearing:
 *
 * - Every page under `docs/` is rendered, not a curated subset. The documents
 *   link to each other 300-odd times, and rendering only the interesting ones
 *   turns every link into the uninteresting ones into a 404.
 * - Relative `.md` links are rewritten to `.html` with their anchors intact,
 *   because that is the only edit that has to happen for a link written for
 *   GitHub to work on a static site.
 *
 * The sidebar's grouping is read out of the README rather than written again
 * here. The README already groups these documents — start here, the output, the
 * language and the compiler — and a second grouping maintained by hand drifts
 * from the first one silently. A document that exists and is in no README group
 * still gets rendered and appears under "Everything else", so adding a page
 * cannot make it unreachable.
 *
 * Usage: `pnpm build:docs`, or `pnpm build:site`, which calls it.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";

import {
  escapeHtml,
  highlightBankTs,
  highlightCobol,
  SITE_ORIGIN,
} from "./build-site";
import { isRunnable, playgroundUrl } from "./playground-links";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

/** Every markdown file under `docs/`, as a path relative to `docs/`. */
/**
 * Documents that stay in the repository and off the site.
 *
 * These are working papers. The audits are this project's own criticism of
 * itself and the ticket list is the plan for fixing it — both belong in the
 * repository, where somebody evaluating the engineering can read them in the
 * context of the commits that answered them, and neither is written for a
 * visitor who arrived from a link.
 *
 * The site rendered them anyway, listed them in `sitemap.xml`, and pointed
 * search engines at them: `robots.txt` allows everything. So a reader searching
 * for a phrase met the pre-publication security checklist and a paragraph that,
 * read on its own, sounded like the resolution of a doubt about who owned the
 * repository. Found by the 2026-08-07 audit.
 *
 * Excluded from the site, not hidden. Every one of them is a file in `docs/`
 * that GitHub renders, and the README links the audits by name.
 */
export const UNPUBLISHED = [
  /^audit-\d{4}-\d{2}-\d{2}\.md$/,
  /^launch-tickets\.md$/,
];

export function docFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".md")) {
        const file = relative(DOCS, path);
        if (!UNPUBLISHED.some((pattern) => pattern.test(file))) {
          found.push(file);
        }
      }
    }
  };
  walk(DOCS);
  return found.sort();
}

/**
 * The sidebar, grouped as the README groups it.
 *
 * Parsed out of the README's `## Documentation` section: a bold line is a group
 * heading and the table rows under it are its documents, in the order they are
 * written. The alternative is a second list here, and a second list is one that
 * disagrees with the first the week after somebody adds a page.
 */
export interface NavGroup {
  title: string;
  entries: { title: string; file: string }[];
}

export function navigation(): NavGroup[] {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const start = readme.indexOf("## Documentation");
  if (start < 0) {
    throw new Error(
      "The README has no `## Documentation` section, which is where the sidebar's grouping comes from.",
    );
  }
  const section = readme.slice(start, readme.indexOf("\n## ", start + 4));

  const groups: NavGroup[] = [];
  for (const line of section.split("\n")) {
    const heading = /^\*\*(.+?)\*\*\s*$/.exec(line);
    if (heading?.[1]) {
      groups.push({ title: heading[1], entries: [] });
      continue;
    }
    // `| [Title](docs/path.md) | ... |`
    const row = /^\|\s*\[([^\]]+)\]\(docs\/([^)]+)\)/.exec(line);
    const group = groups[groups.length - 1];
    if (row?.[1] && row[2] && group) {
      // `docs/adr/` is a directory link; the ADRs are listed individually.
      if (row[2].endsWith("/")) {
        continue;
      }
      group.entries.push({ title: row[1], file: row[2] });
    }
  }

  if (groups.length === 0) {
    throw new Error("No groups found in the README's documentation section.");
  }

  // Everything the README does not name, so a new document is never orphaned.
  const named = new Set(groups.flatMap((g) => g.entries.map((e) => e.file)));
  const rest = docFiles().filter((file) => !named.has(file));
  if (rest.length > 0) {
    groups.push({
      title: "Everything else",
      entries: rest.map((file) => ({ title: titleOf(file), file })),
    });
  }

  return groups;
}

/** A document's own `# ` heading, falling back to its filename. */
export function titleOf(file: string): string {
  const text = readFileSync(join(DOCS, file), "utf8");
  const heading = /^#\s+(.+)$/m.exec(text);
  if (heading?.[1]) {
    return plainInline(heading[1]);
  }
  return file.replace(/\.md$/, "").replace(/[-/]/g, " ");
}

/* ------------------------------------------------------------------ *
 * Rendering.
 * ------------------------------------------------------------------ */

const markdown = MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  highlight: (code: string, language: string): string => {
    // The same two highlighters the landing page uses, so a COBOL block reads
    // identically in both places — including the indicator area, which decides
    // whether a line is a comment.
    if (/^(cobol|cbl|jcl)$/i.test(language)) {
      return `<pre class="code"><code>${highlightCobol(code)}</code></pre>`;
    }
    if (/^(ts|typescript|bankts)$/i.test(language)) {
      const block = `<pre class="code"><code>${highlightBankTs(code)}</code></pre>`;
      // P3: a link, but only where the block is a program rather than a
      // fragment. Of the 94 BankTS blocks under `docs/`, one parses on its
      // own; a link on the other 93 opens the documentation's own example onto
      // a wall of syntax errors, which is worse than no link.
      if (!isRunnable(code)) {
        return block;
      }
      return `${block}<p class="try"><a href="${playgroundUrl(code)}">Open this program in the playground →</a></p>`;
    }
    return `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
  },
});

/**
 * Turns a link written for GitHub into one that works on this site.
 *
 * `../verification.md#what-it-scored` becomes `../verification.html#what-it-scored`.
 * Anything absolute, external, or pointing outside `docs/` is left alone: a link
 * to `../examples/` or to `https://www.ibm.com/...` means what it says, and the
 * ones out of `docs/` are rewritten to the repository so they resolve from a
 * page that is no longer inside the tree.
 */
export function rewriteLink(href: string, fromFile: string): string {
  if (/^([a-z]+:|#|\/)/i.test(href)) {
    return href;
  }

  const [path, anchor] = href.split("#");
  const suffix = anchor ? `#${anchor}` : "";
  if (!path) {
    return href;
  }

  // Where does it land, relative to the docs root?
  const target = resolve(dirname(join(DOCS, fromFile)), path);
  const inside = relative(DOCS, target);
  const escapes = inside.startsWith("..");

  // Out of `docs/`, or in it and not published — either way the repository is
  // the only place the reader can still open it. A link to a page the site does
  // not render is a 404 on our own domain, which is a worse answer than sending
  // somebody to the file on GitHub where it does exist.
  if (escapes || UNPUBLISHED.some((pattern) => pattern.test(inside))) {
    const fromRepoRoot = relative(ROOT, target);
    return `https://github.com/MWH997/banklang/blob/main/${fromRepoRoot}${suffix}`;
  }

  return path.endsWith(".md")
    ? `${path.replace(/\.md$/, ".html")}${suffix}`
    : href;
}

export interface RenderedDoc {
  file: string;
  title: string;
  html: string;
  /** Plain text, for the search index. */
  text: string;
  headings: { id: string; title: string; level: number }[];
}

export function renderDoc(file: string): RenderedDoc {
  const source = readFileSync(join(DOCS, file), "utf8");
  const tokens = markdown.parse(source, {});

  const headings: RenderedDoc["headings"] = [];
  const used = new Map<string, number>();

  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      const inline = tokens[index + 1];
      const title = plainInline(inline?.content ?? "");
      const base = slug(title);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const id = seen === 0 ? base : `${base}-${seen}`;
      token.attrSet("id", id);
      headings.push({
        id,
        title,
        level: Number(token.tag.slice(1)),
      });
    }
    // A link is an *inline* token, so it is a child of the `inline` token
    // between `heading_open`/`paragraph_open` and its close — never a top-level
    // one. Walking only the top level rewrote nothing, and every `.md` link in
    // the rendered site pointed at a file that is not published.
    for (const child of token.children ?? []) {
      if (child.type !== "link_open") {
        continue;
      }
      // `attrGet` is typed as possibly returning a number, which an `href`
      // never is; the coercion is for the type rather than for the value.
      const href = child.attrGet("href");
      if (href !== null && href !== "") {
        const rewritten = rewriteLink(String(href), file);
        child.attrSet("href", rewritten);
        if (/^https?:/i.test(rewritten)) {
          // An external link opens where it is, but never with access to this
          // page through `window.opener`.
          child.attrSet("rel", "noopener");
        }
      }
    }
  }

  return {
    file,
    title: titleOf(file),
    html: markdown.renderer.render(tokens, markdown.options, {}),
    text: plainText(source),
    headings: headings.filter((h) => h.level >= 2 && h.level <= 3),
  };
}

/**
 * A heading as a reader sees it, not as it is written.
 *
 * markdown-it hands back the heading's *source*, so a heading written
 * ``D1. `USAGE NATIONAL` inside a group — **measured**`` arrived in the
 * contents list with its asterisks and backticks intact. Rendering them as
 * emphasis is wrong in a table of contents — it is one line of navigation — so
 * the markup is removed rather than styled.
 */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** GitHub's heading slug, which is what the existing `#anchor` links assume. */
export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Markdown with the syntax taken out, for searching over.
 *
 * **An inline code span keeps its text.** It used to be replaced with a space
 * along with the backticks, and the effect was that the search could not find
 * the things it exists to find: `BANK-LED-001`, `COMP-3`, `EIBRESP` and `PIC`
 * are all written in backticks everywhere they appear, so every one of them
 * matched nothing. `docs.js` opens by saying a reader of a compiler's
 * documentation is nearly always looking for a page by exactly such a name.
 *
 * A fenced block is still dropped. It is a listing rather than prose, and the
 * words in it are the generated COBOL rather than anything a reader is
 * searching for.
 */
function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ *
 * The page.
 * ------------------------------------------------------------------ */

/** How deep under `docs/` a file sits, for relative asset paths. */
function depthOf(file: string): string {
  const depth = file.split("/").length - 1;
  return depth === 0 ? "." : "..".concat("/..".repeat(depth - 1));
}

function sidebar(groups: NavGroup[], current: string): string {
  const up = depthOf(current);
  return groups
    .map(
      (group) => `<section>
  <h2>${escapeHtml(group.title)}</h2>
  <ul>
${group.entries
  .map((entry) => {
    const href = `${up}/${entry.file.replace(/\.md$/, ".html")}`;
    const here = entry.file === current;
    return `    <li><a href="${href}"${here ? ' aria-current="page"' : ""}>${escapeHtml(entry.title)}</a></li>`;
  })
  .join("\n")}
  </ul>
</section>`,
    )
    .join("\n");
}

function onThisPage(doc: RenderedDoc): string {
  if (doc.headings.length < 2) {
    return "";
  }
  return `<nav class="toc" aria-label="On this page">
  <h2>On this page</h2>
  <ul>
${doc.headings
  .map(
    (heading) =>
      `    <li class="lvl-${heading.level}"><a href="#${heading.id}">${escapeHtml(heading.title)}</a></li>`,
  )
  .join("\n")}
  </ul>
</nav>`;
}

export function renderPage(doc: RenderedDoc, groups: NavGroup[]): string {
  const up = depthOf(doc.file);
  const canonical = `${SITE_ORIGIN}/docs/${doc.file.replace(/\.md$/, ".html")}`;
  const description = doc.text.slice(0, 180).trim();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(doc.title)} — BankLang</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="${up}/../favicon.svg" />
    <link rel="stylesheet" href="${up}/../assets/site.css" />
    <link rel="stylesheet" href="${up}/../assets/docs.css" />
    <script>
      // Before paint, so a reader who chose a theme never sees the other one.
      (() => {
        const saved = localStorage.getItem("banklang-theme");
        if (saved) document.documentElement.dataset.theme = saved;
      })();
    </script>
  </head>
  <body class="docs">
    <a class="skip" href="#doc">Skip to content</a>

    <header class="top">
      <a class="wordmark" href="${up}/../">BankLang</a>
      <nav>
        <a href="${up}/../docs/">Docs</a>
        <a href="${up}/../blog/">Writing</a>
        <a href="${up}/../playground/">Playground</a>
        <a href="https://github.com/MWH997/banklang" rel="noopener">GitHub</a>
        <button id="theme" type="button" class="ghost" aria-label="Switch between light and dark">Theme</button>
        <button id="nav-toggle" type="button" class="ghost narrow-only" aria-expanded="false" aria-controls="side">Contents</button>
      </nav>
    </header>

    <div class="shell">
      <nav class="side" id="side" aria-label="Documentation">
        <form class="search" role="search" onsubmit="return false">
          <label class="visually-hidden" for="q">Search the documentation</label>
          <input id="q" type="search" placeholder="Search the documentation" autocomplete="off" />
        </form>
        <div id="results" class="results" hidden></div>
        <div id="tree">
${sidebar(groups, doc.file)}
        </div>
      </nav>

      <main id="doc" class="doc">
${doc.html}
        <hr />
        <p class="edit">
          <a href="https://github.com/MWH997/banklang/blob/main/docs/${doc.file}" rel="noopener">Read this page as Markdown on GitHub →</a>
        </p>
      </main>

${onThisPage(doc)}
    </div>

    <script src="${up}/../assets/docs.js" defer></script>
    <script>
      document.getElementById("theme").addEventListener("click", () => {
        const root = document.documentElement;
        const dark =
          root.dataset.theme === "dark" ||
          (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
        root.dataset.theme = dark ? "light" : "dark";
        localStorage.setItem("banklang-theme", root.dataset.theme);
      });
    </script>
  </body>
</html>
`;
}

/** The docs landing page: every group, with every document under it. */
export function renderIndex(groups: NavGroup[]): string {
  const cards = groups
    .map(
      (group) => `<section class="group">
  <h2>${escapeHtml(group.title)}</h2>
  <ul class="cards">
${group.entries
  .map(
    (entry) =>
      `    <li><a href="${entry.file.replace(/\.md$/, ".html")}">${escapeHtml(entry.title)}</a></li>`,
  )
  .join("\n")}
  </ul>
</section>`,
    )
    .join("\n");

  const doc: RenderedDoc = {
    file: "index.md",
    title: "Documentation",
    html: `<h1>Documentation</h1>
<p class="lede">Everything this compiler claims, and what each claim rests on.
Start with <a href="getting-started.html">Getting started</a> if you want to run
it, <a href="for-mainframe-engineers.html">For mainframe engineers</a> if you
want to read the COBOL, and
<a href="for-decision-makers.html">For the person deciding</a> if you have to
accept the risk rather than the output.</p>
${cards}`,
    text:
      "Everything this compiler claims, and what each claim rests on: the " +
      "generated COBOL, the rules that refuse a program, the numeric model, " +
      "and how each is verified.",
    headings: [],
  };

  return renderPage(doc, groups);
}

/** Every directory under `docs/` that holds documents of its own. */
export function directoriesOf(files: string[]): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const directory = dirname(file);
    if (directory !== ".") {
      directories.add(directory);
    }
  }
  return [...directories].sort();
}

/** The page a link to `language/` or `adr/` lands on. */
export function renderDirectory(
  directory: string,
  files: string[],
  groups: NavGroup[],
): string {
  const title = directory
    .split("/")
    .pop()!
    .replace(/-/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  const names = files.map((file) => titleOf(file));

  const doc: RenderedDoc = {
    file: `${directory}/index.md`,
    title,
    html: `<h1>${escapeHtml(title)}</h1>
<ul class="cards">
${files
  .map(
    (file, index) =>
      `  <li><a href="${file.split("/").pop()!.replace(/\.md$/, ".html")}">${escapeHtml(names[index] ?? "")}</a></li>`,
  )
  .join("\n")}
</ul>`,
    // The pages it lists, so the `<meta name="description">` says something.
    // An empty one is what a search engine shows for the page, and a listing
    // page with no description is the one it decides not to show at all.
    text: `${title}: ${names.join(", ")}.`,
    headings: [],
  };

  return renderPage(doc, groups);
}

/* ------------------------------------------------------------------ *
 * Search.
 * ------------------------------------------------------------------ */

export interface SearchEntry {
  /** Path relative to `/docs/`, already `.html`. */
  u: string;
  /** Title. */
  t: string;
  /** Group it sits under, so a result can say where it came from. */
  g: string;
  /** Lowercased text, in full, so a match late in a long page is findable. */
  b: string;
}

/**
 * A prebuilt index rather than a search service.
 *
 * Forty-two documents is small enough that the whole corpus fits in a file the
 * browser can scan, which is the only design that keeps the promise the rest of
 * this site makes: nothing is fetched from another host, and there is no
 * runtime dependency to audit.
 *
 * **The body is no longer truncated.** It was cut at 4,000 characters on the
 * reasoning that the point is to find the page rather than to rank inside it,
 * and the effect was that most of the documentation could not be found at all:
 * the numeric model is 6.6 KB, the diagnostics catalogue is 29 KB, and a reader
 * searching for a term that appears past the first page of either got nothing.
 * The whole corpus is 265 KB of text, fetched once on the first keystroke and
 * never on a page that is only read — a quarter of a megabyte to make a
 * documentation site searchable is a trade worth making.
 */
export function searchIndex(groups: NavGroup[], docs: RenderedDoc[]): string {
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const entry of group.entries) {
      groupOf.set(entry.file, group.title);
    }
  }

  const entries: SearchEntry[] = docs.map((doc) => ({
    u: doc.file.replace(/\.md$/, ".html"),
    t: doc.title,
    g: groupOf.get(doc.file) ?? "Everything else",
    b: doc.text.toLowerCase(),
  }));

  return JSON.stringify(entries);
}

/* ------------------------------------------------------------------ *
 * The build.
 * ------------------------------------------------------------------ */

/** Writes the rendered documentation under `outRoot` (the site's root). */
export function buildDocs(outRoot: string): number {
  const groups = navigation();
  const files = docFiles();
  const rendered = files.map((file) => renderDoc(file));

  const docsOut = join(outRoot, "docs");
  mkdirSync(docsOut, { recursive: true });

  for (const doc of rendered) {
    const target = join(docsOut, doc.file.replace(/\.md$/, ".html"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderPage(doc, groups), "utf8");
  }

  writeFileSync(join(docsOut, "index.html"), renderIndex(groups), "utf8");

  // A page linking to `language/` means the set of them, and on GitHub that
  // resolves to a directory listing. Nothing serves one here, so the directory
  // gets a page of its own rather than the link getting rewritten to somewhere
  // it was not pointed.
  for (const directory of directoriesOf(files)) {
    const inside = files.filter(
      (file) => dirname(file) === directory && file !== `${directory}/index.md`,
    );
    writeFileSync(
      join(docsOut, directory, "index.html"),
      renderDirectory(directory, inside, groups),
      "utf8",
    );
  }

  const assets = join(outRoot, "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(
    join(assets, "search-index.json"),
    searchIndex(groups, rendered),
    "utf8",
  );

  return rendered.length;
}

function main(): void {
  const count = buildDocs(join(ROOT, "dist/site"));
  console.log(`Rendered ${count} documents`);
}

if (process.argv[1]?.endsWith("build-docs.ts")) {
  main();
}
