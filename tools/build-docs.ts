/**
 * Render `docs/` as part of the site.
 *
 * Forty-two documents, several of them the
 * strongest evidence this project has, readable until now only as raw Markdown
 * on github.com, where the tables are fine, the cross-references work, and
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
 * here. The README already groups these documents (start here, the output, the
 * language and the compiler) and a second grouping maintained by hand drifts
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

import { feedLink } from "./build-blog";
import {
  escapeHtml,
  highlightBankTs,
  highlightCobol,
  servedUrl,
  SITE_ORIGIN,
  NAV_SCRIPT,
  siteHeader,
  THEME_SCRIPT,
} from "./build-site";
import { isRunnable, playgroundUrl } from "./playground-links";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

/**
 * Where a document that is not published goes.
 *
 * These are working papers: the audits are this project's own criticism of
 * itself and the ticket lists are the plans for fixing it. Neither is written
 * for a visitor who arrived from a link, and neither is in the repository:
 * `.gitignore` excludes this directory, so a clone does not contain them and
 * no commit adds them. One of them records rewrites of this repository's own
 * history, which settles the question: the reasoning that is worth publishing
 * goes in a commit message, where it is attached to the change it explains.
 *
 * This constant is therefore not about hiding a tracked file. It is what stops
 * a paper that only exists on the author's disk from being rendered into the
 * public site by a build that happens to run there.
 *
 * The site used to render them, list them in `sitemap.xml`, and point search
 * engines at them: `robots.txt` allows everything. So a reader searching for a
 * phrase met the pre-publication security checklist. The first answer was a
 * list of two file-name patterns, which fixed the two files that existed and
 * left the next working paper published by default under whatever it happened
 * to be called. A denylist decides what to hide, and the thing you forgot to
 * name is the thing that gets out.
 *
 * A directory decides instead. A document is published because it is in
 * `docs/`, and a working paper is not because it is in `docs/working/`, which
 * is a decision the author makes while writing it rather than one somebody has
 * to remember to encode afterwards.
 *
 * **Nothing published may link to one.** They are not in the repository, so the
 * GitHub fallback `rewriteLink` uses for a file outside `docs/` would be a dead
 * link on somebody else's domain. `rewriteLink` refuses instead, which is the
 * same fail-closed shape as the misfiling guard below: a red build rather than
 * a 404 a reader finds first.
 */
export const WORKING_PAPERS = "working";

/**
 * The shapes a working paper comes in, used only to catch a misfiled one.
 *
 * This is not what decides publication. The directory above is, and a second
 * copy of that decision as a name pattern is how the two rules drifted apart
 * last time. Treat it as a guard: a document that is plainly a working paper
 * and is not in `docs/working/` stops the build instead of being published, so
 * the failure mode is a red build rather than an audit on the public site.
 */
const WORKING_PAPER_NAMES = [
  /^audit-\d{4}-\d{2}-\d{2}\.md$/,
  /^tickets-\d{4}-\d{2}-\d{2}\.md$/i,
  /^launch-tickets\.md$/,
];

/**
 * True for a path under `docs/working/`, which the site does not render.
 *
 * Takes a path relative to `docs/` or to the repository root, because the two
 * callers hold it each way. The alternative is what happened before: the
 * builder's rule and `tests/documentation.test.ts`'s were two spellings of one
 * idea, and the test's was the looser of them.
 */
export function isWorkingPaper(file: string): boolean {
  const parts = file.split(/[\\/]/);
  const at = parts[0] === "docs" ? 1 : 0;
  return parts[at] === WORKING_PAPERS;
}

/** Every markdown file under `docs/`, as a path relative to `docs/`. */
export function docFiles(): string[] {
  const found: string[] = [];
  const misfiled: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".md")) {
        const file = relative(DOCS, path);
        if (isWorkingPaper(file)) {
          continue;
        }
        if (WORKING_PAPER_NAMES.some((pattern) => pattern.test(entry.name))) {
          misfiled.push(file);
          continue;
        }
        found.push(file);
      }
    }
  };
  walk(DOCS);

  if (misfiled.length > 0) {
    throw new Error(
      `These read as working papers and are not in docs/${WORKING_PAPERS}/, so the site would publish them: ${misfiled.join(", ")}. Move them, or rename them if they are meant for the site.`,
    );
  }
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
      // A row pointing at a directory means the set of pages in it.
      //
      // It used to mean nothing: the row was skipped, and every page under
      // `docs/language/` and `docs/adr/` fell through to "Everything else",
      // which is how nineteen of forty-three documents came to sit in the
      // group named as a leftover. Expanding it here rather than writing
      // the nineteen rows out keeps the README the single list, which is the
      // point of parsing it at all, and keeps a new page in either directory
      // filed correctly without anybody remembering to add it.
      if (row[2].endsWith("/")) {
        group.entries.push(
          ...directoryPages(row[2]).map((file) => ({
            title: titleOf(file),
            file,
          })),
        );
        continue;
      }
      group.entries.push({ title: row[1], file: row[2] });
    }
  }

  if (groups.length === 0) {
    throw new Error("No groups found in the README's documentation section.");
  }

  // A page named twice is a page in two groups, and the second one is
  // wherever the directory row happened to fall. The row-by-row order above is
  // what decides, so the duplicate is dropped from the later group: `Grammar`
  // and `Language stability` are named individually because they are read on
  // their own, and they should not appear again under the directory that holds
  // them.
  const seen = new Set<string>();
  for (const group of groups) {
    group.entries = group.entries.filter((entry) => {
      if (seen.has(entry.file)) {
        return false;
      }
      seen.add(entry.file);
      return true;
    });
  }

  // Everything the README does not name, so a new document is never orphaned.
  const rest = docFiles().filter((file) => !seen.has(file));
  if (rest.length > 0) {
    groups.push({
      title: "Everything else",
      entries: rest.map((file) => ({ title: titleOf(file), file })),
    });
  }

  return groups.filter((group) => group.entries.length > 0);
}

/** Every published document under one directory of `docs/`, in order. */
function directoryPages(directory: string): string[] {
  const prefix = directory.replace(/\/+$/, "");
  const inside = docFiles().filter((file) => dirname(file) === prefix);
  if (inside.length === 0) {
    throw new Error(
      `The README's documentation section links docs/${directory}, which holds no published page.`,
    );
  }
  return inside;
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
    // identically in both places, including the indicator area, which decides
    // whether a line is a comment.
    if (/^(cobol|cbl|jcl)$/i.test(language)) {
      return `<pre class="code"><code>${highlightCobol(code)}</code></pre>`;
    }
    if (/^(ts|typescript|bankts)$/i.test(language)) {
      const block = `<pre class="code"><code>${highlightBankTs(code)}</code></pre>`;
      // A link, but only where the block is a program rather than a
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

  // A working paper is not in the repository, so neither this site nor GitHub
  // can answer a link to one. Refusing is the only honest option: the
  // alternatives are a 404 on our own domain and a 404 on somebody else's.
  if (isWorkingPaper(inside)) {
    throw new Error(
      `${fromFile} links to ${href}, which is a working paper: not published, not in the repository, and not linkable from a page that is. Quote it or cite it by date instead.`,
    );
  }

  // Out of `docs/` but in the repository: the file really is Markdown there,
  // and sending somebody to GitHub is a better answer than a 404 on a page this
  // site does not render.
  if (escapes) {
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
    // between `heading_open`/`paragraph_open` and its close, never a top-level
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
 * ``D1. `USAGE NATIONAL` inside a group, **measured**`` arrived in the contents
 * list with its asterisks and backticks intact. A table of contents is one line
 * of navigation, so the markup is removed rather than styled.
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

/**
 * The group labels are not headings.
 *
 * They were `h2`, and the sidebar precedes `<main>` in the document, so every
 * documentation page opened with four level-two headings before its own `h1`.
 * That is why `tests/site-layout.test.ts` asserting a single `h1` passed
 * throughout: there was only ever one. A screen-reader user moving by heading
 * met "Start here", "The output", "The language and the compiler" and
 * "Everything else" before being told what page they were on.
 *
 * The other repair the ticket offered was to move the sidebar after `<main>`
 * and place it back with grid. That fixes the order and leaves four headings in
 * the document outline that are navigation rather than sections of the page,
 * which is the deeper problem. `aria-labelledby` on the list gives the group
 * its name without claiming to be a heading.
 */
function sidebar(groups: NavGroup[], current: string): string {
  const up = depthOf(current);
  return groups
    .map((group, index) => {
      const id = `side-${String(index)}-${slug(group.title)}`;
      return `<div class="side__group">
  <p class="side__title" id="${id}">${escapeHtml(group.title)}</p>
  <ul aria-labelledby="${id}">
${group.entries
  .map((entry) => {
    const href = `${up}/${entry.file.replace(/\.md$/, ".html")}`;
    const here = entry.file === current;
    return `    <li><a href="${href}"${here ? ' aria-current="page"' : ""}>${escapeHtml(entry.title)}</a></li>`;
  })
  .join("\n")}
  </ul>
</div>`;
    })
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
  const canonical = servedUrl(`docs/${doc.file.replace(/\.md$/, ".html")}`);
  const description = doc.text.slice(0, 180).trim();
  const title = `${doc.title} · BankLang`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    ${feedLink(`${up}/../`)}
    <link rel="icon" type="image/svg+xml" href="${up}/../favicon.svg" />
    <link rel="stylesheet" href="${up}/../assets/site.css" />
    <link rel="stylesheet" href="${up}/../assets/docs.css" />

    <!--
      Every documentation page used to share as a bare link, with nothing for
      the receiving client to render: no card, no title beyond the URL, no
      image. Forty-two pages, and the ones people link to are the technical
      ones.

      Filled from what the page already has rather than from a second source:
      the title is the document's own heading and the description is the first
      180 characters of its text, which are the same two strings the title
      element and meta description above use.
    -->
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og.png" />
    <meta property="og:image:alt" content="BankTS source on the left, the IBM COBOL it compiles to on the right." />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og.png" />

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

${siteHeader({
  up: `${up}/../`,
  current: "docs",
  // The page's own contents, beside the menu button rather than inside it: it
  // opens the headings of the document being read, which is not the site's
  // navigation and should not take two taps through a control saying "Menu".
  extra: `          <button id="nav-toggle" type="button" class="ghost narrow-only" aria-expanded="false" aria-controls="side">Contents</button>`,
})}

    <div class="shell">
      <nav class="side" id="side" aria-label="Documentation">
        <form class="search" role="search" id="search">
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
${THEME_SCRIPT}
${NAV_SCRIPT}
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
<p class="lede">The language, the COBOL it generates, and the evidence behind
every claim made on this site.</p>
<p>Three places to start: <a href="getting-started.html">Getting started</a> if
you want to run it, <a href="for-mainframe-engineers.html">For mainframe
engineers</a> if you have to review the COBOL, and
<a href="for-decision-makers.html">For the person deciding</a> if you have to
sign off the risk.</p>
${cards}`,
    text:
      "The language, the COBOL it generates, and the evidence behind every " +
      "claim: the generated code, the rules that refuse a program, the " +
      "numeric model, and how each of them is verified.",
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
 * never on a page that is only read: a quarter of a megabyte to make a
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
