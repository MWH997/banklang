import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { allCitations, landedOnFrontPage } from "../tools/check-citations";

/**
 * The sources the documentation cites, and the glossary's own contract.
 *
 * `docs/glossary.md` opens by requiring every entry to carry "reference links
 * to primary documentation", and the entry for "Reference link" says the point
 * is that a contributor "can check the terminology against IBM, GnuCOBOL,
 * TypeScript, SPDX or OpenSSF rather than against this page's own wording".
 *
 * The 2026-08-06 audit checked that claim for the first time and found nine
 * citations that resolved to nothing: a source-map specification 404 since it
 * became an Ecma standard, an IBM topic for the FILE STATUS clause that does
 * not exist, one for the z/OS DD statement that does not exist, and six bare
 * product roots that answer with the IBM Documentation shell. Two more resolved
 * to the wrong product entirely — Db2 for Linux, UNIX and Windows cited for a
 * z/OS precompile — and seven cited Db2 12 for z/OS, out of service since
 * 31 December 2025.
 *
 * The live check is `pnpm docs:citations`, which needs the network. What runs
 * here is what a hermetic test can hold: that every citation has been through
 * that check, that none of them resolved to one of the pages IBM serves when a
 * topic is missing, and that no citation names a product this project does not
 * target or a release it does not support.
 */

type Manifest = { checked: string; citations: Record<string, string> };

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST: Manifest = JSON.parse(
  readFileSync(resolve(ROOT, "docs/citations.json"), "utf8"),
);
const CITED = allCitations(ROOT);
const GLOSSARY = readFileSync(resolve(ROOT, "docs/glossary.md"), "utf8");

describe("every source the documentation cites", () => {
  it("has been checked against the live page", () => {
    const unchecked = [...CITED.keys()].filter(
      (url) => MANIFEST.citations[url] === undefined,
    );
    expect(
      unchecked,
      "run `pnpm docs:citations --write` to record what these resolve to",
    ).toEqual([]);
  });

  it("is still cited, so the manifest does not accumulate", () => {
    const orphans = Object.keys(MANIFEST.citations).filter(
      (url) => !CITED.has(url),
    );
    expect(orphans).toEqual([]);
  });

  it("resolved to a page rather than to a product shell", () => {
    // An IBM topic slug that does not exist still answers 200. The product root
    // is served in its place, titled "IBM Documentation", or a crawler sitemap
    // titled "SSEPEK_13.0.0 - Bot Index". Neither is a citation.
    const empty = Object.entries(MANIFEST.citations)
      .filter(
        ([, title]) =>
          title === "" ||
          title === "IBM Documentation" ||
          /^\w+_[\d.x]+ - Bot Index$/.test(title),
      )
      .map(([url, title]) => `${url} → ${title || "(no title)"}`);
    expect(empty).toEqual([]);
  });
});

describe("the products the documentation cites", () => {
  const urls = [...CITED.keys()];

  it("are the ones this project targets", () => {
    // ibm.com/docs/en/db2/ is Db2 for Linux, UNIX and Windows. Its PRECOMPILE
    // command is a CLP command that does not exist on z/OS, where SQL is
    // prepared by the Db2 precompiler or, preferably, the COBOL coprocessor.
    const wrongProduct = urls.filter((url) =>
      url.startsWith("https://www.ibm.com/docs/en/db2/"),
    );
    expect(
      wrongProduct,
      "Db2 for LUW is a different product from Db2 for z/OS",
    ).toEqual([]);
  });

  it("are releases IBM still supports", () => {
    // Db2 12 for z/OS left service on 31 December 2025.
    const unsupported = urls.filter((url) =>
      /db2-for-zos\/(?!1[3-9])/.test(url),
    );
    expect(unsupported).toEqual([]);
  });

  it("name a version, so the citation cannot drift with the product", () => {
    const roots = urls.filter((url) =>
      /^https:\/\/www\.ibm\.com\/docs(\/en\/[a-z0-9-]+)?\/?$/.test(url),
    );
    expect(
      roots,
      "cite a versioned topic or a publication number, not a product root",
    ).toEqual([]);
  });

  it("is Enterprise COBOL 6.4, the release the compiler targets", () => {
    const other = urls.filter(
      (url) =>
        url.includes("/docs/en/cobol-zos/") && !url.includes("cobol-zos/6.4"),
    );
    expect(other).toEqual([]);
  });
});

describe("the README's badges", () => {
  it("point at a workflow that exists", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    const workflows = [
      ...readme.matchAll(/actions\/workflows\/([\w.-]+\.yml)/g),
    ].map((match) => match[1]!);
    expect(workflows.length).toBeGreaterThan(0);
    for (const workflow of new Set(workflows)) {
      expect(
        existsSync(resolve(ROOT, ".github/workflows", workflow)),
        `.github/workflows/${workflow} is missing`,
      ).toBe(true);
    }
  });
});

/** The glossary's entries, in the order they appear. */
function entries(): { term: string; body: string }[] {
  // Everything after the entry template's own closing rule.
  const body = GLOSSARY.slice(GLOSSARY.indexOf("\n---\n\n## "));
  // Entries are level three under a level-two letter section. They were level
  // two under a level-one letter, which gave the rendered page twenty `h1`
  // elements: a screen reader announced twenty page titles and a search engine
  // had no single statement of what the page is.
  return [...body.matchAll(/\n### (.+)\n([\s\S]*?)(?=\n### |\n## |$)/g)].map(
    (match) => ({ term: match[1]!.trim(), body: match[2]! }),
  );
}

describe("the glossary", () => {
  const all = entries();

  it("still defines the mainframe terms it was cut down to", () => {
    // A floor, not a target, and it has moved once. The file held 98 entries
    // and 48 KB. Seven went because they defined this project's own model
    // tooling — which one supervised which, and what each one's free-tier quota
    // was — in the canonical glossary of a COBOL compiler. Forty-three
    // more went under D3: how this repository is written, general computing a
    // reader of a compiler already knows, and adjacent IBM products that are
    // roadmap notes rather than terms. What is left is what a reader of the
    // generated COBOL, the JCL or the diagnostics needs, and it should not
    // shrink further without a reason.
    expect(all.length).toBeGreaterThanOrEqual(47);
  });

  it("defines the COBOL a reader of the generated output meets", () => {
    // The point of the cut was to leave the terms that earn their place. If one
    // of these goes missing, the file has been trimmed past what it is for.
    const terms = new Set(all.map((entry) => entry.term));
    for (const required of [
      "COMP-3 / Packed decimal",
      "PIC / PICTURE clause",
      "OCCURS",
      "REDEFINES",
      "88-level condition name",
      "File status",
      "DD name",
      "JCL / Job Control Language",
      "SQLCA",
      "EIBRESP",
      "EBCDIC",
      "VSAM",
    ]) {
      expect(terms, `the glossary no longer defines ${required}`).toContain(
        required,
      );
    }
  });

  it("keeps every entry to the four parts it requires of itself", () => {
    const incomplete = all
      .filter(
        (entry) =>
          !entry.body.includes("**Definition:**") ||
          !entry.body.includes("**Why it matters to BankLang:**") ||
          !entry.body.includes("**References:**"),
      )
      .map((entry) => entry.term);
    expect(incomplete).toEqual([]);
  });

  it("gives every entry at least one reference link", () => {
    const unreferenced = all
      .filter((entry) => {
        const references = entry.body.slice(
          entry.body.indexOf("**References:**"),
        );
        return !/^- \[.+\]\(.+\)$/m.test(references);
      })
      .map((entry) => entry.term);
    expect(unreferenced).toEqual([]);
  });

  it("is in one alphabetical sequence", () => {
    // The file used to run A–Z and then append an "Additional strategic terms"
    // section holding twenty more, which is how "DD name" came to sit after
    // "Differential testing" and "File status" after "Fuzz testing". A reader
    // looking a term up had two places to look and no way to know which.
    const key = (term: string) =>
      term.replace(/^[^A-Za-z0-9]+/, "").toLowerCase();
    const terms = all.map((entry) => entry.term);
    const sorted = [...terms].sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      const [da, db] = [/^\d/.test(ka), /^\d/.test(kb)];
      return da !== db ? Number(da) - Number(db) : ka.localeCompare(kb);
    });
    expect(terms).toEqual(sorted);
  });

  it("files every entry under the letter it starts with", () => {
    const body = GLOSSARY.slice(GLOSSARY.indexOf("\n---\n\n# "));
    let heading = "";
    for (const line of body.split("\n")) {
      if (/^# \S/.test(line)) {
        heading = line.slice(2).trim();
        continue;
      }
      if (!line.startsWith("## ")) {
        continue;
      }
      const term = line
        .slice(3)
        .trim()
        .replace(/^[^A-Za-z0-9]+/, "");
      const expected = /^\d/.test(term) ? "Numerals" : term[0]!.toUpperCase();
      expect(heading, `"${term}" is filed under "${heading}"`).toBe(expected);
    }
  });
});

/**
 * A redirect that answers 200 and is not the page.
 *
 * `redirect: "follow"` makes a dead citation look alive: the fetch succeeds,
 * the title parses, and the recorded entry says the source resolves. This is
 * how it was found — NIST's COBOL-85 test suite page,
 * `itl.nist.gov/div897/ctg/cobol_form.htm`, now answers `302` to `nist.gov/itl`,
 * the laboratory's home page, which has nothing about COBOL on it. The checker
 * recorded it as fine.
 *
 * Tested as a rule rather than over the network: the network half is the
 * weekly job, and what has to be right here is which redirects count.
 */
describe("a citation that redirects", () => {
  it("is a problem when it lands on a front page", () => {
    expect(
      landedOnFrontPage(
        "https://www.itl.nist.gov/div897/ctg/cobol_form.htm",
        "https://www.nist.gov/itl",
      ),
    ).toBe(true);
    expect(
      landedOnFrontPage("https://example.com/a/b/c", "https://example.com/"),
    ).toBe(true);
  });

  it("is not a problem when the page simply moved", () => {
    // A reslug at the same depth. `MOVED` reports that by the title changing,
    // which is a thing to read rather than a thing to fail on.
    expect(
      landedOnFrontPage(
        "https://www.ibm.com/docs/en/cobol-zos/6.4.0",
        "https://www.ibm.com/docs/en/cobol-zos/6.5.0",
      ),
    ).toBe(false);
    expect(
      landedOnFrontPage("https://example.com/a/b", "https://example.com/x/y/z"),
    ).toBe(false);
  });

  it("is not a problem for a citation that was a front page already", () => {
    // `https://gnucobol.sourceforge.io/` is cited as itself.
    expect(
      landedOnFrontPage("https://example.com/", "https://example.com/"),
    ).toBe(false);
  });
});
