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
 * `tests/blog.test.ts` holds all of it, and holds the prose to the house rules:
 * no em dashes, no filler, and a description short enough for a search result.
 *
 * Usage: `pnpm build:blog`, or `pnpm build:site`, which calls it.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";

import {
  escapeHtml,
  highlightBankTs,
  highlightCobol,
  SITE_ORIGIN,
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
 * The front matter, which is three fields and no library.
 *
 * A YAML parser for `title`, `description` and `date` is a dependency to audit
 * for no benefit, and this repository counts its dependencies. Anything the
 * three lines do not cover belongs in the post.
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
  for (const required of ["title", "description", "date"]) {
    if (!fields.get(required)) {
      throw new Error(`A post needs a ${required} in its front matter.`);
    }
  }
  return {
    meta: {
      title: fields.get("title")!,
      description: fields.get("description")!,
      date: fields.get("date")!,
    },
    body: match[2],
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
  return readdirSync(BLOG)
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

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  structuredData?: string;
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
    <link rel="icon" type="image/svg+xml" href="${options.up}favicon.svg" />
    <link rel="stylesheet" href="${options.up}assets/site.css" />
    <link rel="stylesheet" href="${options.up}assets/blog.css" />

    <meta property="og:type" content="article" />
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
        <button id="theme" type="button" class="ghost" aria-label="Switch between light and dark">Theme</button>
      </nav>
    </header>

${options.body}

    <footer class="foot">
      <p>
        <a href="${options.up}">Home</a> ·
        <a href="${options.up}docs/">Docs</a> ·
        <a href="${options.up}blog/">Writing</a> ·
        <a href="${options.up}playground/">Playground</a>
      </p>
      <p class="muted">
        Generated COBOL is validated locally with GnuCOBOL in CI. No IBM
        Enterprise COBOL validation is claimed. MIT licensed.
      </p>
    </footer>

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

export function renderPost(post: Post): string {
  const canonical = `${SITE_ORIGIN}/blog/${post.slug}.html`;
  const structuredData = `    <script type="application/ld+json">
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    mainEntityOfPage: canonical,
    url: canonical,
    inLanguage: "en",
    isPartOf: {
      "@type": "Blog",
      name: "BankLang",
      url: `${SITE_ORIGIN}/blog/`,
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
        <time datetime="${post.date}">${readableDate(post.date)}</time>
        <span>${String(post.minutes)} minute read</span>
      </p>
      <div class="post__body">
${post.html}
      </div>
      <hr />
      <p class="post__next">
        BankLang is a compiler from a small TypeScript-like language to readable
        IBM Enterprise COBOL.
        <a href="../playground/">Try it in your browser</a> or
        <a href="../docs/">read the documentation</a>.
      </p>
    </main>`,
  });
}

export function renderIndex(all: Post[]): string {
  return shell({
    title: "Writing — BankLang",
    description:
      "Notes on compiling to COBOL, rounding money correctly, and testing a compiler whose target you cannot run.",
    canonical: `${SITE_ORIGIN}/blog/`,
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

function main(): void {
  const written = buildBlog(join(ROOT, "dist/site"));
  console.log(`Rendered ${String(written.length)} posts`);
}

if (process.argv[1]?.endsWith("build-blog.ts")) {
  main();
}
