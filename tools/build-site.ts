/**
 * Build the whole site: landing page, playground, assets.
 *
 * The 2026-08-06 audit's central finding was that this project has no front
 * door — a visitor arriving from a link lands in a split-pane editor with no
 * context. This is that front door, and A2 in `docs/launch-tickets.md`.
 *
 * **Every claim on the page is generated, not written.** The diagnostics in the
 * refusal section come from running the compiler over the program printed
 * beside them. The COBOL comes from compiling the BankTS printed beside it, cut
 * to the paragraph by name. The counts come from counting. Nothing on the page
 * is a string somebody typed and nobody checked again, which is the failure
 * mode a landing page has: it ages into a claim the software stopped making.
 *
 * `tests/site.test.ts` holds that: it builds the page and asserts the COBOL on
 * it is the COBOL the compiler emits today.
 *
 * Output:
 *
 *     dist/site/
 *       index.html          the landing page
 *       assets/site.css     its stylesheet, and nothing else
 *       docs/               every page under docs/, rendered
 *       playground/         the existing bundle, unchanged
 *       schema/banklang.json  the config schema `bankc init` points at
 *       favicon.svg  og.png  robots.txt  sitemap.xml
 *
 * Usage: pnpm build:site
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBlog, posts } from "./build-blog";
import { buildDocs, docFiles } from "./build-docs";
import { compile } from "../packages/compiler/src/index";
import { SCHEMA_URL } from "../packages/config/src/index";
import { configJsonSchema } from "../packages/config/src/schema";
import { DIAGNOSTICS } from "../packages/diagnostics/src/index";
import { gradeExamples } from "./evidence-grades";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/site");
const SITE = join(ROOT, "packages/site/src");

/** The domain the site is served from, for canonical and Open Graph URLs. */
export const SITE_ORIGIN = "https://banklang.mwhassan.com";

/* ------------------------------------------------------------------ *
 * Syntax highlighting, at build time.
 *
 * L2: no runtime JavaScript beyond the theme toggle. A highlighter shipped to
 * the browser to colour four code blocks is 40 KB to do what a build can do
 * once. These are deliberately small — enough for the constructs on this page.
 * ------------------------------------------------------------------ */

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const BANKTS_KEYWORDS =
  /\b(module|type|record|function|transaction|return|let|if|else|for|each|in|raise|on|failure|file|test|currency|decimal|string|bool|date|enum|extends)\b/g;

export function highlightBankTs(code: string): string {
  return escapeHtml(code)
    .replace(/(\/\/[^\n]*)/g, '<span class="c-com">$1</span>')
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="c-str">$1</span>')
    .replace(BANKTS_KEYWORDS, '<span class="c-kw">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="c-num">$1</span>');
}

/**
 * COBOL in fixed reference format.
 *
 * The indicator area matters: an asterisk or `*>` in column 7 is a comment, and
 * colouring it as code would misrepresent the output on the one page where a
 * mainframe engineer is deciding whether the output is readable.
 */
export function highlightCobol(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (/^.{6}[*/]/.test(line) || /^\s*\*>/.test(line)) {
        return `<span class="c-com">${escaped}</span>`;
      }
      return escaped
        .replace(/(&quot;[^&]*?&quot;)/g, '<span class="c-str">$1</span>')
        .replace(
          /\b(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE|DIVISION|SECTION|PROGRAM-ID|MOVE|COMPUTE|IF|ELSE|END-IF|EVALUATE|WHEN|END-EVALUATE|PERFORM|CALL|GO TO|GOBACK|ADD|SUBTRACT|MULTIPLY|DIVIDE|OPEN|CLOSE|READ|WRITE|EXEC|END-EXEC|PIC|VALUE|COMP-3|OCCURS|FUNCTION|ON SIZE ERROR|END-COMPUTE|DISPLAY|UPON|THRU|USING|TO|FROM|BY|INTO)\b/g,
          '<span class="c-kw">$1</span>',
        )
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="c-num">$1</span>');
    })
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * The content, taken from the compiler.
 * ------------------------------------------------------------------ */

/** The program the refusal section shows, and the diagnostics it earns. */
const UNSAFE = `transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}`;

const UNSAFE_MODULE = `module Unsafe;

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  fee: MoneyBDT;
}

${UNSAFE}
`;

/** One paragraph of a compiled program, found by its own label. */
function paragraph(cobol: string, label: string): string {
  const lines = cobol.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${label}.`);
  if (start < 0) {
    throw new Error(`No paragraph ${label} in the generated COBOL.`);
  }
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^ {7}[A-Z][A-Z0-9-]*\.\s*$/.test(line.trimEnd()),
  );
  return lines
    .slice(start, end < 0 ? lines.length : end)
    .join("\n")
    .trimEnd();
}

export interface SiteContent {
  diagnostics: string;
  /** Examples run against the reference runtime, counted from the grades. */
  executed: number;
  /** Of those, the ones with hand-written expected values. */
  asserted: number;
  accrueSource: string;
  accrueCobol: string;
  originalCobol: string;
  convertedBankTs: string;
  examples: number;
  diagnosticCount: number;
}

export function siteContent(): SiteContent {
  const grades = gradeExamples(ROOT);
  const unsafe = compile(UNSAFE_MODULE, { sourceFile: "unsafe.bank.ts" });
  if (unsafe.diagnostics.length === 0) {
    throw new Error(
      "The refusal example compiled cleanly. The page would be showing a claim the compiler no longer makes.",
    );
  }

  const interest = readFileSync(
    join(ROOT, "examples/interest-posting-batch/src/main.bank.ts"),
    "utf8",
  );
  const compiled = compile(interest, { sourceFile: "main.bank.ts" });
  if (!compiled.cobol) {
    throw new Error("interest-posting-batch no longer compiles.");
  }

  // The `accrue` function as it is written, with the comment above it: it says
  // why the rounding mode is required, which is the point of the section.
  const accrueStart = interest.indexOf("function accrue(");
  const lines = interest.slice(0, accrueStart).split("\n");
  let comment = lines.length - 1;
  while (comment > 0 && lines[comment - 1]!.startsWith("//")) {
    comment -= 1;
  }
  const accrueSource = (
    lines.slice(comment).join("\n") +
    interest.slice(accrueStart, interest.indexOf("\n}\n", accrueStart) + 2)
  ).trim();

  const original = readFileSync(
    join(ROOT, "conversions/01-sequential-update/original/ACCTUPDT.cbl"),
    "utf8",
  );
  const converted = readFileSync(
    join(ROOT, "conversions/01-sequential-update/banklang/src/main.bank.ts"),
    "utf8",
  );

  return {
    diagnostics: unsafe.diagnostics
      .map((entry) => `${entry.id.padEnd(14)}${entry.message}`)
      .join("\n"),
    accrueSource,
    accrueCobol: paragraph(compiled.cobol, "ACCRUE"),
    // The `OPEN` with no status checked on any of its four files, which is what
    // the conversion is about.
    originalCobol: lineRange(original, "0000-MAIN.", 6),
    convertedBankTs: fileDeclarations(converted),
    // Both counts from the same list, or the sentence is nonsense. `examples/`
    // holds 21 directories and 23 programs, because one of them is a job of
    // several; counting directories for the denominator and programs for the
    // numerator read as "21 of 21 are executed" when two are not.
    examples: grades.length,
    // Counted from the same grader `evidence/GRADES.md` is generated by, not
    // written on the page. The landing page said "three of 22 are executed"
    // for as long as that was true and for a while after it stopped being.
    executed: grades.filter((entry) => entry.grade === "executed").length,
    asserted: grades.filter(
      (entry) => entry.grade === "executed" && entry.reason === "",
    ).length,
    diagnosticCount: DIAGNOSTICS.filter((entry) => entry.implemented).length,
  };
}

/** `count` lines from the one containing `marker`. */
function lineRange(text: string, marker: string, count: number): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  if (start < 0) {
    throw new Error(`No line contains ${marker}.`);
  }
  return lines
    .slice(start, start + count)
    .join("\n")
    .trimEnd();
}

/** The `file` declarations of the converted program, which carry the status. */
function fileDeclarations(source: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.startsWith("file "));
  if (start < 0) {
    throw new Error("The converted program declares no files.");
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("}"),
  );
  return lines
    .slice(start, end + 1)
    .join("\n")
    .trimEnd();
}

/* ------------------------------------------------------------------ *
 * The page.
 * ------------------------------------------------------------------ */

export function renderLanding(content: SiteContent): string {
  const template = readFileSync(join(SITE, "index.html"), "utf8");
  const fills: Record<string, string> = {
    UNSAFE_BANKTS: highlightBankTs(UNSAFE),
    DIAGNOSTICS: escapeHtml(content.diagnostics),
    ACCRUE_BANKTS: highlightBankTs(content.accrueSource),
    ACCRUE_COBOL: highlightCobol(content.accrueCobol),
    ORIGINAL_COBOL: highlightCobol(content.originalCobol),
    CONVERTED_BANKTS: highlightBankTs(content.convertedBankTs),
    EXAMPLE_COUNT: String(content.examples),
    EXECUTED_COUNT: String(content.executed),
    ASSERTED_COUNT: String(content.asserted),
    DIAGNOSTIC_COUNT: String(content.diagnosticCount),
    ORIGIN: SITE_ORIGIN,
  };

  let page = template;
  for (const [key, value] of Object.entries(fills)) {
    if (!page.includes(`{{${key}}}`)) {
      throw new Error(`The template has no {{${key}}} to fill.`);
    }
    page = page.replaceAll(`{{${key}}}`, value);
  }
  const leftover = /\{\{([A-Z_]+)\}\}/.exec(page);
  if (leftover) {
    throw new Error(`{{${leftover[1]}}} was never filled.`);
  }
  return page;
}

function sitemap(): string {
  const today = new Date().toISOString().slice(0, 10);
  // Every rendered document, not just the two hand-written entries. Forty-two
  // pages that nothing links to from outside the site are forty-two pages a
  // search engine has no reason to fetch.
  const pages = [
    "/",
    "/playground/",
    "/docs/",
    "/blog/",
    ...posts().map((post) => `/blog/${post.slug}.html`),
    ...docFiles().map((file) => `/docs/${file.replace(/\.md$/, ".html")}`),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map(
      (path) =>
        `  <url><loc>${SITE_ORIGIN}${path}</loc><lastmod>${today}</lastmod></url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");
}

function main(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "assets"), { recursive: true });

  const content = siteContent();
  writeFileSync(join(OUT, "index.html"), renderLanding(content));
  cpSync(join(SITE, "site.css"), join(OUT, "assets/site.css"));
  cpSync(join(SITE, "docs.css"), join(OUT, "assets/docs.css"));
  cpSync(join(SITE, "docs.js"), join(OUT, "assets/docs.js"));
  cpSync(join(SITE, "blog.css"), join(OUT, "assets/blog.css"));

  // D1: every document under `docs/`, rendered, with the sidebar grouped as the
  // README groups it and a search index built from the same pass.
  const documents = buildDocs(OUT);

  // And the writing, which is the front door for a reader who arrives from a
  // search rather than from the repository.
  const written = buildBlog(OUT);

  // The playground, built by its own tooling and copied in unchanged. Its
  // `base: "./"` is what lets it work from `/playground/`.
  execFileSync("pnpm", ["playground:build"], { cwd: ROOT, stdio: "inherit" });
  cpSync(join(ROOT, "packages/playground/dist"), join(OUT, "playground"), {
    recursive: true,
  });

  cpSync(
    join(ROOT, "packages/playground/public/favicon.svg"),
    join(OUT, "favicon.svg"),
  );
  const og = join(SITE, "og.png");
  if (existsSync(og)) {
    cpSync(og, join(OUT, "og.png"));
  } else {
    console.warn("No og.png; run tools/build-og.ts to regenerate it.");
  }

  // The schema `bankc init` writes into every generated `banklang.json`.
  //
  // The path comes from the URL rather than being written out again beside it:
  // a generated config points an editor at `SCHEMA_URL`, and the only thing
  // that makes that resolve is this file landing at exactly that path. Deriving
  // it means the two cannot be changed apart.
  const schemaPath = join(OUT, new URL(SCHEMA_URL).pathname);
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, `${JSON.stringify(configJsonSchema(), null, 2)}\n`);

  writeFileSync(
    join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );
  writeFileSync(join(OUT, "sitemap.xml"), sitemap());

  console.log(
    `Built ${OUT} (${String(documents)} documents, ${String(written.length)} posts)`,
  );
}

if (process.argv[1]?.endsWith("build-site.ts")) {
  main();
}
