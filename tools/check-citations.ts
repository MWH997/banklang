/**
 * Check that every external citation in the documentation still resolves, and
 * still resolves to the page it was cited for.
 *
 * The relative-link check in `tests/documentation.test.ts` has caught dead
 * in-repo links for a long time. External links were never checked at all, and
 * the 2026-08-06 audit found why that mattered: `docs/glossary.md` cited an IBM
 * topic for the FILE STATUS clause that does not exist, one for the z/OS DD
 * statement that does not exist, and a source-map specification that has been
 * 404 since it was replaced by an Ecma standard.
 *
 * An HTTP status code cannot find any of those. IBM Documentation answers 200
 * for a topic slug it has never heard of:
 *
 *     GET /docs/en/cobol-zos/6.4.0?topic=this-topic-does-not-exist -> 200
 *
 * The product path is validated; the `topic=` query is not. So a status-code
 * link checker over ibm.com is itself an assertion that runs, passes, and
 * checks the wrong thing. This tool reads the page title instead, and knows the
 * two shapes IBM serves when a topic is missing:
 *
 *   - `IBM Documentation`, the single-page-app shell, when the topic is unknown
 *     and the product root is served in its place;
 *   - `SSEPEK_13.0.0 - Bot Index`, a sitemap, when the product is known and the
 *     topic under it is not.
 *
 * Both are recorded as failures. A real topic answers with its own heading, and
 * that heading is what gets written to `docs/citations.json` — so a citation
 * that is silently re-slugged to a different page is a diff, not a pass.
 *
 * IBM serves the rendered DITA only to clients it takes for crawlers. Sending a
 * browser user-agent returns the empty shell for every URL, valid or not, which
 * is why this tool deliberately does not send one.
 *
 * Usage:
 *   pnpm docs:citations           report drift against the manifest
 *   pnpm docs:citations --write   record the current state as the manifest
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const MANIFEST = resolve(ROOT, "docs/citations.json");
const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;

/** A title IBM serves in place of a topic it does not have. */
const SHELL_TITLE = "IBM Documentation";
const BOT_INDEX = /^\w+_[\d.x]+ - Bot Index$/;

type Manifest = {
  /** The date the titles below were last confirmed against the live pages. */
  checked: string;
  /** Cited URL to the page title it resolved to. */
  citations: Record<string, string>;
};

/** Every Markdown file in the repository, excluding dependencies. */
function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      return [];
    }
    const path = join(root, entry.name);
    if (statSync(path).isDirectory()) {
      return markdownFiles(path);
    }
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/**
 * The external URLs cited in one document.
 *
 * Only Markdown link targets count. A URL written as prose is usually an
 * example of a shape rather than a citation, and `example.com` in the glossary's
 * own entry template is neither.
 */
export function citedUrls(text: string): string[] {
  return [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((url) => !url.startsWith("https://example.com"))
    .filter((url) => !url.startsWith(OWN_REPOSITORY))
    .filter((url) => !url.startsWith(OWN_SITE));
}

/**
 * The repository's own URLs, which answer 404 to an anonymous request for as
 * long as the repository stays private. `tests/documentation.test.ts` checks
 * the files behind them instead, which is the stronger check anyway: it fails
 * when the CI badge points at a workflow that has been renamed.
 */
const OWN_REPOSITORY = "https://github.com/MWH997/banklang";

/**
 * This project's own site, for the same reason and one more.
 *
 * A citation check exists to notice when *somebody else's* page moves — IBM
 * retiring a topic is the case it was written for. Our own pages move when we
 * move them, and the tests that already cover them are stronger: the playground
 * links in the example READMEs are checked against the example ids the
 * playground actually loads (`tests/playground-links.test.ts`), which catches a
 * broken link the day it breaks rather than the week the schedule next runs.
 *
 * It also has nowhere to resolve to yet. The domain is not served until A1.
 */
const OWN_SITE = "https://banklang.mwhassan.com";

/** Every URL cited anywhere in the repository, with where it was cited. */
export function allCitations(root = ROOT): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of markdownFiles(root)) {
    for (const url of citedUrls(readFileSync(file, "utf8"))) {
      const where = relative(root, file);
      found.set(url, [...(found.get(url) ?? []), where]);
    }
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

function titleOf(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }
  return match[1]!
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

type Result = { url: string; title: string; problem?: string };

async function fetchTitle(url: string): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      // No browser user-agent: see the note at the top of this file.
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      return { url, title: "", problem: `HTTP ${response.status}` };
    }
    // IBM's manuals are also published as PDFs carrying a publication number,
    // which is the citation a mainframe engineer looks up and the one IBM does
    // not re-slug. A PDF has no title element, so the content type stands in —
    // enough to catch an HTML error page served where a manual used to be.
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/pdf")) {
      return { url, title: "(PDF)" };
    }
    const title = titleOf(await response.text());
    if (title === SHELL_TITLE) {
      return {
        url,
        title,
        problem:
          "resolved to the IBM Documentation shell, so the topic is gone",
      };
    }
    if (BOT_INDEX.test(title)) {
      return {
        url,
        title,
        problem: "resolved to a sitemap, so the product has no such topic",
      };
    }
    return { url, title };
  } catch (error) {
    return { url, title: "", problem: `${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function inBatches(urls: string[]): Promise<Result[]> {
  const results: Result[] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(fetchTitle))));
    process.stderr.write(
      `  checked ${Math.min(i + CONCURRENCY, urls.length)}/${urls.length}\n`,
    );
  }
  return results;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const cited = allCitations();
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

  process.stderr.write(`Checking ${cited.size} cited URLs.\n`);
  const results = await inBatches([...cited.keys()]);

  const broken = results.filter((result) => result.problem);
  const moved = results.filter(
    (result) =>
      !result.problem &&
      manifest.citations[result.url] !== undefined &&
      manifest.citations[result.url] !== result.title,
  );
  const unrecorded = results.filter(
    (result) => !result.problem && manifest.citations[result.url] === undefined,
  );

  for (const result of broken) {
    console.log(`BROKEN  ${result.url}`);
    console.log(`        ${result.problem}`);
    for (const where of cited.get(result.url) ?? []) {
      console.log(`        cited in ${where}`);
    }
  }
  for (const result of moved) {
    console.log(`MOVED   ${result.url}`);
    console.log(`        was "${manifest.citations[result.url]}"`);
    console.log(`        now "${result.title}"`);
  }
  for (const result of unrecorded) {
    console.log(`NEW     ${result.url}`);
    console.log(`        "${result.title}"`);
  }

  if (write) {
    const citations: Record<string, string> = {};
    for (const result of results) {
      // Keep the last known good title for a page that is briefly unreachable,
      // so a network blip cannot quietly empty the manifest.
      citations[result.url] = result.problem
        ? (manifest.citations[result.url] ?? "")
        : result.title;
    }
    const next: Manifest = {
      checked: new Date().toISOString().slice(0, 10),
      citations: Object.fromEntries(
        Object.entries(citations).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nWrote ${Object.keys(next.citations).length} citations.`);
  }

  const summary = `${broken.length} broken, ${moved.length} moved, ${unrecorded.length} unrecorded`;
  console.log(`\n${summary}.`);
  if (!write && (broken.length > 0 || moved.length > 0)) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("check-citations.ts")) {
  await main();
}
