/**
 * Write the Open Graph card's HTML, from real compiler output.
 *
 * The card is generated from real compiler output rather than mocked up, which
 * takes two halves. This is the first: `packages/site/src/og.html` is filled
 * from the compiler and written to `dist/og/index.html`. The second half is a browser
 * screenshotting it at 1200x630 into `packages/site/src/og.png`, which is
 * checked in because a build should not need a browser.
 *
 * Usage:
 *   pnpm build:og                     write dist/og/index.html
 *   then screenshot it at 1200x630 -> packages/site/src/og.png
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { siteContent } from "./build-site";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The lines that fit the card, which is a fixed box rather than a page.
 *
 * Dedented first. Generated COBOL is in fixed reference format, so every line
 * of a paragraph starts in column 12, eleven columns of margin the card does
 * not have, and the first attempt spent half the pane on them and truncated
 * every line to compensate. The margin is meaningful in a `.cbl` and is noise
 * in a 1200-pixel card.
 */
function fit(text: string, lines: number, width: number): string {
  const kept = text.split("\n").slice(0, lines);
  const indent = Math.min(
    ...kept
      .filter((line) => line.trim() !== "")
      .map((line) => line.length - line.trimStart().length),
  );
  return kept
    .map((line) => line.slice(indent))
    .map((line) =>
      line.length > width ? `${line.slice(0, width - 1)}…` : line,
    )
    .join("\n");
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colour(code: string, cobol: boolean): string {
  return escapeHtml(code)
    .split("\n")
    .map((line) => {
      if (
        line.trimStart().startsWith("*>") ||
        line.trimStart().startsWith("//")
      ) {
        return `<span class="com">${line}</span>`;
      }
      return line
        .replace(/(&quot;[^&]*?&quot;|"[^"]*")/g, '<span class="str">$1</span>')
        .replace(
          cobol
            ? /\b(COMPUTE|MOVE|IF|END-IF|EVALUATE|WHEN|END-EVALUATE|ADD|TO|FUNCTION|ABS|MOD)\b/g
            : /\b(function|return|round|transaction|record|type)\b/g,
          '<span class="kw">$1</span>',
        )
        .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="num">$1</span>');
    })
    .join("\n");
}

function main(): void {
  const content = siteContent();
  const template = readFileSync(
    join(ROOT, "packages/site/src/og.html"),
    "utf8",
  );

  // The rounding sequence is the strongest twelve lines this compiler emits:
  // it is the thing a mainframe engineer recognises and does not expect.
  const cobol = content.accrueCobol
    .split("\n")
    .filter((line) => !line.includes("SIZE ERROR") && !line.includes("SYSOUT"))
    .join("\n");
  const start = cobol.indexOf("           EVALUATE TRUE");

  const page = template
    .replace("{{OG_BANKTS}}", colour(fit(content.accrueSource, 9, 52), false))
    .replace(
      "{{OG_COBOL}}",
      colour(fit(cobol.slice(start > 0 ? start : 0), 9, 48), true),
    );

  mkdirSync(join(ROOT, "dist/og"), { recursive: true });
  writeFileSync(join(ROOT, "dist/og/index.html"), page);
  console.log("Wrote dist/og/index.html. Screenshot it at 1200x630.");
}

main();
