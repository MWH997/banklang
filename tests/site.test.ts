import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { renderLanding, siteContent, SITE_ORIGIN } from "../tools/build-site";

/**
 * The landing page, held to the compiler.
 *
 * The 2026-08-06 audit's central finding was that the project has no front
 * door. This is that page — and the failure mode a landing page has is that it
 * ages into a claim the software stopped making. A screenshot of some COBOL
 * pasted in eighteen months ago is worse than no page, because it is a specific
 * false statement about what the compiler emits.
 *
 * So nothing on the page is written. The diagnostics come from compiling the
 * program printed beside them; the COBOL comes from compiling the BankTS
 * printed beside it. What is checked here is that this stays true: if the
 * compiler's output changes and the page does not, the page cannot be rendered
 * at all, and if the claims drift these fail.
 */

const CONTENT = siteContent();
const PAGE = renderLanding(CONTENT);

describe("the landing page's code is the compiler's code", () => {
  it("prints the diagnostics the compiler produces for the program beside them", () => {
    // The three that make the claim: a retry that posts twice, money with no
    // audit trail, and a ledger that does not balance.
    for (const id of ["BANK-TXN-001", "BANK-AUD-001", "BANK-LED-001"]) {
      expect(CONTENT.diagnostics, `${id} is no longer reported`).toContain(id);
      expect(PAGE).toContain(id);
    }
    expect(CONTENT.diagnostics.split("\n")).toHaveLength(3);
  });

  it("prints the COBOL the compiler emits today", () => {
    // Rebuilt here rather than trusted: the page is only as honest as this.
    const fresh = compile(
      readFileSync("examples/interest-posting-batch/src/main.bank.ts", "utf8"),
      { sourceFile: "main.bank.ts" },
    );
    expect(fresh.cobol).toContain(
      CONTENT.accrueCobol.trimStart().split("\n")[0],
    );
    for (const line of CONTENT.accrueCobol.split("\n")) {
      expect(
        fresh.cobol,
        `the page prints a line the compiler does not emit`,
      ).toContain(line);
    }
  });

  it("shows the banker's rounding sequence, which is the point of the section", () => {
    expect(CONTENT.accrueCobol).toContain("EVALUATE TRUE");
    expect(CONTENT.accrueCobol).toContain("FUNCTION MOD");
    // COBOL has one rounding phrase and it is not this one.
    expect(PAGE).not.toContain("ROUNDED MODE IS");
  });

  it("counts what it claims to count", () => {
    expect(CONTENT.examples).toBeGreaterThanOrEqual(20);
    expect(CONTENT.diagnosticCount).toBeGreaterThanOrEqual(50);
    expect(PAGE).toContain(String(CONTENT.diagnosticCount));
    expect(PAGE).toContain(String(CONTENT.examples));
  });
});

describe("the landing page", () => {
  it("says validation is GnuCOBOL and not IBM", () => {
    expect(PAGE).toContain("No IBM Enterprise\n          COBOL validation");
  });

  it("carries the metadata a shared link needs", () => {
    for (const tag of [
      '<link rel="canonical"',
      'property="og:title"',
      'property="og:description"',
      'property="og:image"',
      'property="og:image:alt"',
      'name="twitter:card" content="summary_large_image"',
      'name="description"',
    ]) {
      expect(PAGE, `${tag} is missing`).toContain(tag);
    }
    expect(PAGE).toContain(`${SITE_ORIGIN}/og.png`);
  });

  it("fetches nothing from another host", () => {
    // Links out are the point of a landing page; *sub-resources* from another
    // host are not. A page for a compiler that makes a point of having no
    // network call in its own pipeline should not fetch a font from Google in
    // order to say so.
    const resources = [
      ...PAGE.matchAll(
        /<(link|script|img|iframe|source)\b([^>]*?)(?:href|src)="([^"]+)"/g,
      ),
    ]
      // `rel="canonical"` names this page rather than fetching anything, so it
      // is the one absolute URL in a head that is allowed to be absolute.
      .filter(([, , attrs]) => !/rel="(?:canonical|alternate)"/.test(attrs!))
      .map((match) => match[3]!);
    const offsite = resources.filter((url) => /^(?:https?:)?\/\//.test(url));
    expect(
      offsite,
      "every sub-resource must be served from this origin",
    ).toEqual([]);
    expect(resources.length).toBeGreaterThan(1);
  });

  it("ships one script, and it only switches the theme", () => {
    const scripts = [
      ...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g),
    ].map((match) => match[1]!);
    // Two blocks: the pre-paint theme read, and the toggle.
    expect(scripts).toHaveLength(2);
    for (const body of scripts) {
      expect(body).toMatch(/theme/i);
    }
    expect(PAGE).not.toMatch(/<script[^>]+src=/);
  });

  it("is small enough to arrive before the reader decides", () => {
    // L2: under 50 KB gzipped, for the page and its stylesheet together.
    const css = readFileSync("packages/site/src/site.css", "utf8");
    const total =
      gzipSync(Buffer.from(PAGE)).length + gzipSync(Buffer.from(css)).length;
    expect(total).toBeLessThan(50_000);
  });
});
