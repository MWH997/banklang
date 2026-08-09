/**
 * Render `blog/` as part of the site.
 *
 * The documentation answers "how does this work". The blog answers "why would
 * anybody do this", which is a different question and a different reader: it is
 * the page somebody arrives at from a search or a link, having never heard of
 * BankLang, and it has to be readable without any of that context.
 *
 * Posts are ordinary Markdown with a small front matter block. Nothing here
 * rewrites the content — the same rule the documentation build follows — and
 * the same two syntax highlighters are used, so a COBOL block reads identically
 * on a blog post, a documentation page and the landing page.
 *
 * SEO is deliberate rather than incidental:
 *
 * - one `<h1>` per page, taken from the front matter;
 * - a `<meta name="description">` written by the author, not truncated prose;
 * - a canonical URL, Open Graph and Twitter cards;
 * - `BlogPosting` structured data with the publication date;
 * - every post in `sitemap.xml`, and the index linked from the site header.
 *
 * `tests/blog.test.ts` holds all of it, including a description short enough for
 * a search result. The house prose rules are in `tests/prose.test.ts`, which
 * applies them to the documentation and the site copy too — they were enforced
 * on these five files and on nothing else, which is what F26 was about.
 *
 * Usage: `pnpm build:blog`, or `pnpm build:site`, which calls it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";

import { titleOf } from "./build-docs";
import {
  escapeHtml,
  highlightBankTs,
  highlightCobol,
  servedUrl,
  SITE_ORIGIN,
  THEME_BUTTON,
  THEME_SCRIPT,
} from "./build-site";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG = join(ROOT, "blog");

export interface PostMeta {
  /** File name without the extension, and the URL segment. */
  slug: string;
  title: string;
  /** One sentence, used as the meta description and on the index. */
  description: string;
  /** ISO date the post was published. */
  date: string;
  /** Reading time in minutes, counted rather than guessed. */
  minutes: number;
  /**
   * Who wrote it.
   *
   * F25: five essays arguing for a change in how banks build core systems,
   * published with no byline at all, while `CITATION.cff` carried the full
   * identity — name, email and ORCID — and the string "Wahid" appeared zero
   * times on the built site. Held to that file by `tests/blog.test.ts`, so
   * there is one place the author is recorded and the byline cannot drift from
   * the citation metadata.
   */
  author: string;
  /**
   * Two other posts, by slug.
   *
   * F28: each post dead-ended. Written per post rather than computed, because
   * "newest two" is a list nobody chose and the pairs that are worth reading
   * together are not the ones that were published together.
   */
  related: string[];
  /**
   * The documentation page this essay is the argument for, under `docs/`.
   *
   * The title comes from the page's own heading rather than being written
   * again here. Each post used to close with an italic paragraph about
   * BankLang that carried the same link — F27, the template — and this is
   * where that link went.
   */
  reading: string;
}

export interface Post extends PostMeta {
  html: string;
  /** Plain text, for counting and for tests. */
  text: string;
}

/**
 * A link written for GitHub, made to work on the site.
 *
 * Posts are ordinary Markdown files and read correctly in the repository, so
 * they link to `../docs/numeric-model.md` the way every other document does.
 * The site serves the rendered page, so that one suffix is rewritten here and
 * nothing else is. `tests/documentation.test.ts` checks the link against the
 * file on disk, which only works while the link names the file.
 */
export function rewriteLink(href: string): string {
  if (/^([a-z]+:|#|\/)/i.test(href)) {
    return href;
  }
  const [path, anchor] = href.split("#");
  if (!path?.endsWith(".md")) {
    return href;
  }
  return `${path.replace(/\.md$/, ".html")}${anchor ? `#${anchor}` : ""}`;
}

const markdown = MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  highlight: (code: string, language: string): string => {
    if (/^(cobol|cbl|jcl)$/i.test(language)) {
      return `<pre class="code"><code>${highlightCobol(code)}</code></pre>`;
    }
    if (/^(ts|typescript|bankts)$/i.test(language)) {
      return `<pre class="code"><code>${highlightBankTs(code)}</code></pre>`;
    }
    return `<pre class="code"><code>${escapeHtml(code)}</code></pre>`;
  },
});

/**
 * The front matter, which is a handful of fields and no library.
 *
 * A YAML parser for six one-line fields is a dependency to audit for no
 * benefit, and this repository counts its dependencies. Anything the lines do
 * not cover belongs in the post.
 */
export function parseFrontMatter(source: string): {
  meta: Omit<PostMeta, "slug" | "minutes">;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error("A post must open with a --- front matter block.");
  }
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (field?.[1]) {
      fields.set(field[1], (field[2] ?? "").replace(/^"|"$/g, "").trim());
    }
  }
  // `author`, `related` and `reading` are required rather than optional, which
  // is the whole of H1's "so this cannot be half-applied": an optional byline
  // is one four posts have and the fifth does not.
  for (const required of [
    "title",
    "description",
    "date",
    "author",
    "related",
    "reading",
  ]) {
    if (!fields.get(required)) {
      throw new Error(`A post needs a ${required} in its front matter.`);
    }
  }
  return {
    meta: {
      title: fields.get("title")!,
      description: fields.get("description")!,
      date: fields.get("date")!,
      author: fields.get("author")!,
      related: fields
        .get("related")!
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug !== ""),
      reading: fields.get("reading")!,
    },
    body: match[2],
  };
}

/**
 * The author, from the one file that holds the identity.
 *
 * `CITATION.cff` already carries the name, the email and the ORCID, and GitHub
 * and Zenodo read it. A second copy in a template is a second thing to update,
 * so the byline and `/about/` are rendered from this rather than from a string
 * typed into the shell.
 *
 * Read with a regular expression rather than a YAML parser, for the reason
 * `parseFrontMatter` is: there is exactly one author and five fields.
 */
export interface SiteAuthor {
  name: string;
  email: string;
  orcid: string;
  github: string;
}

export function citationAuthor(root = ROOT): SiteAuthor {
  const cff = readFileSync(join(root, "CITATION.cff"), "utf8");
  const field = (name: string): string => {
    const found = new RegExp(`^\\s*-?\\s*${name}:\\s*"?([^"\\n]+?)"?\\s*$`, "m")
      .exec(cff)?.[1]
      ?.trim();
    if (!found) {
      throw new Error(`CITATION.cff has no ${name}, which the byline needs.`);
    }
    return found;
  };
  return {
    name: `${field("given-names")} ${field("family-names")}`,
    email: field("email"),
    orcid: field("orcid"),
    github: `https://github.com/${field("alias")}`,
  };
}

/** Markdown with the syntax removed, for counting words. */
function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two hundred words a minute, rounded up, which is the usual reading rate. */
function minutesToRead(text: string): number {
  return Math.max(1, Math.round(text.split(" ").length / 200));
}

/** Renders a post's body, rewriting the document links on the way through. */
function renderBody(body: string): string {
  const tokens = markdown.parse(body, {});
  for (const token of tokens) {
    for (const child of token.children ?? []) {
      if (child.type !== "link_open") {
        continue;
      }
      const href = child.attrGet("href");
      if (href !== null && href !== "") {
        const rewritten = rewriteLink(String(href));
        child.attrSet("href", rewritten);
        if (/^https?:/i.test(rewritten)) {
          child.attrSet("rel", "noopener");
        }
      }
    }
  }
  return markdown.renderer.render(tokens, markdown.options, {});
}

export function posts(): Post[] {
  const all = readdirSync(BLOG)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const source = readFileSync(join(BLOG, file), "utf8");
      const { meta, body } = parseFrontMatter(source);
      const text = plainText(body);
      return {
        ...meta,
        slug: file.replace(/\.md$/, ""),
        minutes: minutesToRead(text),
        html: renderBody(body),
        text,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  // A cross-link that points at nothing is worse than no cross-link, and the
  // rendered page cannot tell: it would print an anchor to a 404. Checked here
  // so the build stops instead.
  const slugs = new Set(all.map((post) => post.slug));
  for (const post of all) {
    if (post.related.length !== 2) {
      throw new Error(
        `${post.slug} names ${String(post.related.length)} related posts; two is the pair the footer renders.`,
      );
    }
    for (const slug of post.related) {
      if (slug === post.slug) {
        throw new Error(`${post.slug} is related to itself.`);
      }
      if (!slugs.has(slug)) {
        throw new Error(
          `${post.slug} is related to ${slug}, which is not a post.`,
        );
      }
    }
    if (!existsSync(join(ROOT, "docs", post.reading))) {
      throw new Error(
        `${post.slug} reads on to docs/${post.reading}, which is not there.`,
      );
    }
  }
  return all;
}

/* ------------------------------------------------------------------ *
 * The pages.
 * ------------------------------------------------------------------ */

function readableDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The `<link>` that makes a feed discoverable.
 *
 * Every page carries it, not only the blog: a reader who wants to follow this
 * is as likely to be on a documentation page as on a post, and a feed reader
 * finds a feed by looking at whatever page it was given.
 */
export function feedLink(up: string): string {
  return `<link rel="alternate" type="application/rss+xml" title="BankLang — Writing" href="${up}blog/feed.xml" />`;
}

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  structuredData?: string;
  ogType?: string;
  up: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <meta name="description" content="${escapeHtml(options.description)}" />
    <link rel="canonical" href="${options.canonical}" />
    ${feedLink(options.up)}
    <link rel="icon" type="image/svg+xml" href="${options.up}favicon.svg" />
    <link rel="stylesheet" href="${options.up}assets/site.css" />
    <link rel="stylesheet" href="${options.up}assets/blog.css" />

    <meta property="og:type" content="${options.ogType ?? "article"}" />
    <meta property="og:url" content="${options.canonical}" />
    <meta property="og:title" content="${escapeHtml(options.title)}" />
    <meta property="og:description" content="${escapeHtml(options.description)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(options.title)}" />
    <meta name="twitter:description" content="${escapeHtml(options.description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og.png" />
${options.structuredData ?? ""}
    <script>
      (() => {
        const saved = localStorage.getItem("banklang-theme");
        if (saved) document.documentElement.dataset.theme = saved;
      })();
    </script>
  </head>

  <body class="blog">
    <a class="skip" href="#post">Skip to content</a>

    <header class="top">
      <a class="wordmark" href="${options.up}">BankLang</a>
      <nav>
        <a href="${options.up}docs/">Docs</a>
        <a href="${options.up}blog/">Writing</a>
        <a href="${options.up}playground/">Playground</a>
        <a href="https://github.com/MWH997/banklang" rel="noopener">GitHub</a>
        <a href="https://mwhassan.com" rel="noopener">mwhassan.com</a>
        ${THEME_BUTTON}
      </nav>
    </header>

${options.body}

    <footer class="foot">
      <p>
        <a href="${options.up}">Home</a> ·
        <a href="${options.up}docs/">Docs</a> ·
        <a href="${options.up}blog/">Writing</a> ·
        <a href="${options.up}playground/">Playground</a> ·
        <a href="${options.up}about/">About</a> ·
        <a href="${options.up}blog/feed.xml">Feed</a>
      </p>
      <p class="muted">
        Generated COBOL is validated locally with GnuCOBOL in CI. No IBM
        Enterprise COBOL validation is claimed. MIT licensed.
      </p>
    </footer>

${THEME_SCRIPT}
  </body>
</html>
`;
}

/**
 * What follows the essay.
 *
 * It used to be one paragraph, identical on all five posts, saying what
 * BankLang is and inviting the reader to try it — F27, and visible as a
 * template in a single sitting. What a reader who has finished an essay wants
 * is the next thing to read, so that is what is there: the two posts this one
 * was written beside, and the documentation page it is the argument for.
 *
 * Navigation rather than a pitch. Its shape repeating across posts is correct
 * for navigation and was the whole objection to the paragraph it replaced.
 */
function furtherReading(post: Post): string {
  const other = post.related.map((slug) => ({
    slug,
    title: postTitles().get(slug) ?? slug,
  }));
  return `      <nav class="post__related" aria-labelledby="related">
        <h2 id="related">Read next</h2>
        <ul>
${other
  .map(
    (entry) =>
      `          <li><a href="${entry.slug}.html">${escapeHtml(entry.title)}</a></li>`,
  )
  .join("\n")}
          <li>
            <a href="../docs/${post.reading.replace(/\.md$/, ".html")}">${escapeHtml(titleOf(post.reading))}</a>,
            in the documentation
          </li>
        </ul>
      </nav>`;
}

/**
 * Slug to title, for the cross-links.
 *
 * Read once per build rather than once per post: `posts()` renders every body
 * through markdown-it, and calling it from inside the renderer would do that
 * work again for each of the two links on each of the pages.
 */
let titleCache: Map<string, string> | undefined;
function postTitles(): Map<string, string> {
  titleCache ??= new Map(posts().map((post) => [post.slug, post.title]));
  return titleCache;
}

export function renderPost(post: Post): string {
  const canonical = servedUrl(`blog/${post.slug}.html`);
  const author = citationAuthor();
  const structuredData = `    <script type="application/ld+json">
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: {
      "@type": "Person",
      name: post.author,
      url: author.orcid,
    },
    mainEntityOfPage: canonical,
    url: canonical,
    inLanguage: "en",
    isPartOf: {
      "@type": "Blog",
      name: "BankLang",
      url: servedUrl("blog/index.html"),
    },
  },
  null,
  2,
)}
    </script>`;

  return shell({
    title: `${post.title} — BankLang`,
    description: post.description,
    canonical,
    structuredData,
    up: "../",
    body: `    <main class="post" id="post">
      <p class="post__back"><a href="./">All writing</a></p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="post__meta">
        <span class="post__author">by <a href="../about/" rel="author">${escapeHtml(post.author)}</a></span>
        <time datetime="${post.date}">${readableDate(post.date)}</time>
        <span>${String(post.minutes)} minute read</span>
      </p>
      <div class="post__body">
${post.html}
      </div>
      <hr />
${furtherReading(post)}
    </main>`,
  });
}

export function renderIndex(all: Post[]): string {
  return shell({
    title: "Writing — BankLang",
    description:
      "Notes on compiling to COBOL, rounding money correctly, and testing a compiler whose target you cannot run.",
    canonical: servedUrl("blog/index.html"),
    ogType: "website",
    up: "../",
    body: `    <main class="post" id="post">
      <h1>Writing</h1>
      <p class="lede">
        Why a compiler for banking logic looks the way it does, and what the
        problems underneath it actually are.
      </p>
      <ul class="post__list">
${all
  .map(
    (post) => `        <li>
          <a href="${post.slug}.html">${escapeHtml(post.title)}</a>
          <p>${escapeHtml(post.description)}</p>
          <p class="post__meta">
            <time datetime="${post.date}">${readableDate(post.date)}</time>
            <span>${String(post.minutes)} minute read</span>
          </p>
        </li>`,
  )
  .join("\n")}
      </ul>
      <!--
        F28. Five posts on five consecutive days and then nothing reads as a
        launch batch, and a reader deciding whether this project exists in a
        year reads the blog for exactly that. The honest answer is not a
        schedule nobody will keep.
      -->
      <p class="post__cadence">
        These went out together, and what follows them will not: a post here is
        written when something has been finished and is worth the argument,
        which is a few times a year rather than weekly.
        <a href="feed.xml">The feed</a> is how to hear about the next one.
      </p>
    </main>`,
  });
}

/* ------------------------------------------------------------------ *
 * The feed, and the page the byline points at.
 * ------------------------------------------------------------------ */

/** RFC 822, which is the date format RSS 2.0 requires. */
export function rfc822(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toUTCString();
}

/**
 * RSS 2.0 rather than Atom.
 *
 * Both are read by everything. RSS is what the readers that are left default
 * to, and `<atom:link rel="self">` is the one Atom element RSS validators want,
 * so it is the namespace that appears here and nothing else of it.
 *
 * `guid` is the post's URL with `isPermaLink="true"`, which is the same string
 * as `link`. A separate identifier would be one more thing that can drift from
 * the canonical URL, and the canonical URL is already stable.
 */
export function renderFeed(all: Post[]): string {
  const author = citationAuthor();
  const self = `${SITE_ORIGIN}/blog/feed.xml`;
  const items = all.map(
    (post) => `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${servedUrl(`blog/${post.slug}.html`)}</link>
      <guid isPermaLink="true">${servedUrl(`blog/${post.slug}.html`)}</guid>
      <pubDate>${rfc822(post.date)}</pubDate>
      <dc:creator>${escapeHtml(post.author)}</dc:creator>
      <description>${escapeHtml(post.description)}</description>
    </item>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>BankLang — Writing</title>
    <link>${servedUrl("blog/index.html")}</link>
    <atom:link href="${self}" rel="self" type="application/rss+xml" />
    <description>Why a compiler for banking logic looks the way it does, and what the problems underneath it actually are.</description>
    <language>en</language>
    <managingEditor>${escapeHtml(author.email)} (${escapeHtml(author.name)})</managingEditor>
${items.join("\n")}
  </channel>
</rss>
`;
}

/**
 * `/about/`, rendered from `CITATION.cff`.
 *
 * F25. The byline on each post has to land somewhere, and the somewhere has to
 * answer the first question `docs/for-decision-makers.md` exists for and does
 * not answer: who wrote this. Everything on it is generated from the citation
 * metadata, so there is one record of the identity rather than two.
 */
export function renderAbout(): string {
  const author = citationAuthor();
  return shell({
    title: `About — BankLang`,
    description: `BankLang is written by ${author.name}. What it is, who wrote it, and how to get in touch.`,
    canonical: servedUrl("about/index.html"),
    ogType: "website",
    up: "../",
    body: `    <main class="post" id="post">
      <h1>About</h1>
      <p class="lede">
        BankLang is written by ${escapeHtml(author.name)}.
      </p>
      <div class="post__body">
        <p>
          It is a deterministic compiler from BankTS, a small banking language
          with TypeScript's type syntax, to readable IBM Enterprise COBOL. The
          design and the decisions are mine; much of the implementation was
          written with an AI coding assistant under review. That is how it was
          written rather than what it does, and nothing in the compiler is a
          model.
        </p>
        <p>
          It has never run on z/OS. Generated COBOL is validated locally with
          GnuCOBOL under a configuration shaped towards Enterprise COBOL 6.4,
          and
          <a href="../docs/status-and-limits.html">the limits are written down</a>
          rather than left for a reader to discover.
        </p>
        <h2>Getting in touch</h2>
        <ul>
          <li><a href="mailto:${escapeHtml(author.email)}">${escapeHtml(author.email)}</a></li>
          <li><a href="${author.github}" rel="noopener me">GitHub</a></li>
          <li><a href="${author.orcid}" rel="noopener me">ORCID</a></li>
        </ul>
        <p>
          To cite the work, GitHub's "Cite this repository" reads
          <a href="https://github.com/MWH997/banklang/blob/main/CITATION.cff" rel="noopener">CITATION.cff</a>,
          which is also where this page comes from.
        </p>
      </div>
    </main>`,
  });
}

/** Writes the blog under `outRoot` and returns the posts it rendered. */
export function buildBlog(outRoot: string): Post[] {
  const all = posts();
  const out = join(outRoot, "blog");
  mkdirSync(out, { recursive: true });

  for (const post of all) {
    writeFileSync(join(out, `${post.slug}.html`), renderPost(post), "utf8");
  }
  writeFileSync(join(out, "index.html"), renderIndex(all), "utf8");
  return all;
}

/** Writes `/blog/feed.xml`. */
export function buildFeed(outRoot: string, all: Post[]): void {
  const out = join(outRoot, "blog");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "feed.xml"), renderFeed(all), "utf8");
}

/** Writes `/about/`. */
export function buildAbout(outRoot: string): void {
  const out = join(outRoot, "about");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), renderAbout(), "utf8");
}

function main(): void {
  const root = join(ROOT, "dist/site");
  const written = buildBlog(root);
  buildFeed(root, written);
  buildAbout(root);
  console.log(`Rendered ${String(written.length)} posts`);
}

if (process.argv[1]?.endsWith("build-blog.ts")) {
  main();
}
