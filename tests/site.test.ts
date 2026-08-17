import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { posts, renderPost } from "../tools/build-blog";
import {
  docFiles,
  navigation,
  renderDoc,
  renderPage,
} from "../tools/build-docs";
import { compile } from "../packages/compiler/src/index";
import {
  DIAGNOSTICS,
  isBankingSafetyRule,
} from "../packages/diagnostics/src/index";
import {
  builtPages,
  inlineScriptHashes,
  render404,
  renderLanding,
  responseHeaders,
  servedPath,
  siteContent,
  SITE_ORIGIN,
  sitemap,
} from "../tools/build-site";

/**
 * The landing page, held to the compiler.
 *
 * The project had no front door for a long time, and this is that page. The
 * failure mode a landing page has is that it ages into a claim the software
 * stopped making. A screenshot of some COBOL
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

  /**
   * The sentence is about a retry that posts twice, money moving with no audit
   * trail, and a ledger that does not balance. It used to print the size of the
   * whole catalogue, which is mostly the type system and the parser: ninety-odd
   * where the claim was sixteen.
   *
   * Asserted against the classifier rather than a number written here, so the
   * page moves when the catalogue does, and bounded above so that filing a
   * rule under the wrong namespace cannot quietly restore the old figure.
   */
  it("counts the safety rules for the safety-rule sentence", () => {
    const safety = DIAGNOSTICS.filter(
      (entry) => entry.implemented && isBankingSafetyRule(entry.id),
    );

    expect(CONTENT.safetyRuleCount).toBe(safety.length);
    expect(CONTENT.safetyRuleCount).toBeGreaterThanOrEqual(10);
    expect(CONTENT.safetyRuleCount).toBeLessThan(CONTENT.diagnosticCount / 2);
    expect(PAGE).toContain(
      `<strong>${CONTENT.safetyRuleCount}</strong> rules of this kind`,
    );

    // The families it is and is not drawn from, named rather than counted, so
    // that "safety rule" keeps meaning a rule about what happens to money.
    for (const id of ["BANK-TXN-001", "BANK-AUD-001", "BANK-LED-001"]) {
      expect(safety.map((entry) => entry.id)).toContain(id);
    }
    for (const id of ["BANK-SYN-001", "BANK-TYPE-001", "BANK-FILE-001"]) {
      expect(safety.map((entry) => entry.id)).not.toContain(id);
    }
  });
});

/**
 * The conversion exhibit used to argue from what was not on screen.
 *
 * It showed six lines from `0000-MAIN.` under a paragraph saying "no
 * `FILE STATUS` field declared for any of them", and a reader who has written
 * COBOL assumes the clauses are in the `FILE-CONTROL` paragraph that is not
 * being shown, because that is exactly where they would be. The argument was
 * sound and the exhibit did not support it.
 */
describe("the conversion exhibit", () => {
  it("shows the SELECT statements the argument is about", () => {
    for (const file of [
      "TRANS-FILE",
      "MASTER-IN",
      "MASTER-OUT",
      "REJECT-FILE",
    ]) {
      expect(CONTENT.originalCobol, file).toContain(`SELECT ${file}`);
    }
    // And nothing on any of them, which is the claim.
    expect(CONTENT.originalCobol).not.toContain("FILE STATUS");
    expect(PAGE).toContain("<code>FILE STATUS</code>");
  });

  it("still shows the OPEN whose outcome nothing tests", () => {
    expect(CONTENT.originalCobol).toContain("OPEN INPUT");
  });

  it("marks the gap between them rather than closing it up", () => {
    // The two are forty lines apart in the original. A listing that silently
    // joins two places is its own small lie.
    expect(CONTENT.originalCobol).toMatch(
      /^ {6}\*\s+\d+ lines: the FDs and WORKING-STORAGE$/m,
    );
  });

  it("is answered by the file declarations that carry a status", () => {
    const declared = CONTENT.convertedBankTs.match(/^file /gm) ?? [];
    expect(declared).toHaveLength(4);
    expect(CONTENT.convertedBankTs.match(/ status \w+;/g) ?? []).toHaveLength(
      4,
    );
  });
});

/**
 * The four page shells carry the same navigation.
 *
 * Landing, documentation, blog and playground are rendered by four different
 * things: a template, `build-docs.ts`, `build-blog.ts`, and a Vite entry. So a
 * nav item added to one is added to one. The theme control is already held
 * together this way; the links were not, and a reader who follows a nav item on
 * the homepage and cannot find it in the docs has been given a site that is
 * three sites.
 *
 * Asserted per link rather than by comparing the four blocks, because the
 * `href`s differ legitimately: the docs shell writes relative paths from
 * whatever depth the page sits at.
 */
describe("every page shell carries the same navigation", () => {
  const shells: [string, string][] = [
    ["landing", PAGE],
    ["documentation", renderPage(renderDoc(docFiles()[0]!), navigation())],
    ["blog", renderPost(posts()[0]!)],
    ["playground", readFileSync("packages/playground/index.html", "utf8")],
  ];

  for (const [name, html] of shells) {
    it(`${name} links back to the author's site`, () => {
      expect(html).toContain('href="https://mwhassan.com"');
    });

    it(`${name} links to the repository`, () => {
      expect(html).toContain("https://github.com/MWH997/banklang");
    });

    /** An external link opened from this origin should not keep a handle on it. */
    it(`${name} opens its external links without a window handle`, () => {
      for (const match of html.matchAll(
        /<a\s([^>]*href="https?:\/\/[^"]*"[^>]*)>/g,
      )) {
        const tag = match[1] as string;
        if (/href="https:\/\/banklang\.mwhassan\.com/.test(tag)) {
          continue;
        }
        expect(tag, `an external link in the ${name} shell: ${tag}`).toContain(
          "rel=",
        );
      }
    });
  }
});

describe("the landing page", () => {
  /**
   * The caveat has to be on the first screen, above everything it qualifies.
   *
   * Asserted as two facts in the hero rather than as an exact string, because
   * the previous version of this pinned one hand-wrapped line of markup and
   * broke on a reflow that changed nothing a reader sees.
   */
  it("says on the first screen that validation is GnuCOBOL and not IBM", () => {
    const hero = /<section id="what"[\s\S]*?<\/section>/.exec(PAGE)?.[0] ?? "";
    expect(hero).toMatch(/GnuCOBOL/);
    expect(hero.replace(/\s+/g, " ")).toMatch(
      /not IBM's compiler|not IBM|never (?:been )?run on a mainframe/,
    );
    expect(hero).toContain("status-and-limits");
  });

  /**
   * D6. At 1280px each column of a `.split` is 470px and the rounding sample
   * is 624px, so a quarter of the widest line sat behind an inner scrollbar,
   * and the lines that were cut were the banker's-rounding arithmetic the
   * section exists to show.
   *
   * Asserted as the rule rather than as a list of two class attributes: a
   * figure holding generated COBOL takes the page's width.
   */
  it("gives a figure holding COBOL the whole width", () => {
    const splits = [
      ...PAGE.matchAll(/<div class="(split[^"]*)">([\s\S]*?)<\/div>/g),
    ];
    expect(splits.length).toBeGreaterThanOrEqual(3);

    const narrow = splits
      .filter(([, , body]) => /class="cobol"/.test(body ?? ""))
      .filter(([, classes]) => !classes!.includes("split--code"));
    expect(
      narrow.length,
      "a COBOL figure is in a two-column split, so its longest lines are clipped",
    ).toBe(0);

    const css = readFileSync("packages/site/src/site.css", "utf8");
    expect(css).toMatch(/\.split--code\s*\{[^}]*grid-template-columns:\s*1fr/);
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

  /**
   * The scripts this page ships, and the whole of what they do.
   *
   * Three blocks: the pre-paint theme read, the theme toggle, and the menu
   * button. Nothing else, and nothing fetched: the budget for this page is
   * that it arrives and is readable before anything has to run.
   *
   * The menu button is the third because the navigation is a disclosure below
   * the breakpoint, and disclosure is the one thing CSS alone cannot do here
   * without a checkbox standing in for a button and losing `aria-expanded`
   * with it.
   */
  it("ships three scripts, for the theme and the menu and nothing else", () => {
    const scripts = [
      ...PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g),
    ].map((match) => match[1]!);
    expect(scripts).toHaveLength(3);
    for (const body of scripts) {
      expect(body).toMatch(/theme|nav-burger/i);
    }
    expect(PAGE).not.toMatch(/<script[^>]+src=/);
  });

  it("is small enough to arrive before the reader decides", () => {
    // Under 50 KB gzipped, for the page and its stylesheet together.
    const css = readFileSync("packages/site/src/site.css", "utf8");
    const total =
      gzipSync(Buffer.from(PAGE)).length + gzipSync(Buffer.from(css)).length;
    expect(total).toBeLessThan(50_000);
  });
});

/**
 * The one file nothing renders.
 *
 * `_headers` is read by Cloudflare Pages and by nothing else: no page links it,
 * no test opened it, and a rule that stops matching fails silently and stays
 * failed. So it is asserted here, against the shape of the site it describes.
 *
 * The launch checklist asked for `X-Robots-Tag: noindex` on
 * `*.pages.dev` and it was never written. Every build is served on a
 * `pages.dev` hostname as well as on the custom domain, so without it the whole
 * site is indexable twice.
 */
describe("the response headers", () => {
  const HEADERS = readFileSync("packages/site/src/_headers", "utf8");

  /** The rules of a block, by the path it applies to. */
  function rulesFor(path: string): string[] {
    const blocks = HEADERS.split(/\n(?=\S)/);
    const block = blocks.find((entry) => entry.split("\n")[0]!.trim() === path);
    if (!block) {
      throw new Error(`_headers has no block for ${path}.`);
    }
    return block
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  }

  /**
   * Both hostname shapes, because a placeholder in the host stops at the first
   * period.
   *
   * `https://:project.pages.dev/*` matches `banklang.pages.dev`, the
   * production alias, and nothing else. Every preview Cloudflare builds is
   * `<hash>.<project>.pages.dev` or `<branch>.<project>.pages.dev`, one label
   * longer, and was indexable with only the first rule present. Previews are
   * the entire reason this block exists.
   */
  it("keeps preview deployments out of the index", () => {
    for (const host of [
      "https://:project.pages.dev/*",
      "https://:version.:project.pages.dev/*",
    ]) {
      expect(rulesFor(host), host).toContain("X-Robots-Tag: noindex");
    }
  });

  /**
   * A file at `packages/site/src/_headers` is a file Cloudflare never sees.
   * Read from the builder's source rather than from `dist/`, because the tests
   * run before the build does and a `dist/` that happens to be there from
   * yesterday would assert nothing.
   */
  it("is written to the root of the built site", () => {
    expect(readFileSync("tools/build-site.ts", "utf8")).toContain(
      'writeFileSync(\n    join(OUT, "_headers"),\n    responseHeaders(',
    );
  });

  it("sets the headers that cost nothing and are always right", () => {
    const rules = rulesFor("/*");
    expect(rules).toContain("X-Content-Type-Options: nosniff");
    expect(rules).toContain("Referrer-Policy: strict-origin-when-cross-origin");
  });

  /** The policy as the build writes it, hashes and all. */
  function policy(): string {
    const filled = responseHeaders(HEADERS, pageHashes());
    const block = filled
      .split(/\n(?=\S)/)
      .find((entry) => entry.startsWith("/*"));
    const csp = block
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("Content-Security-Policy:"));
    if (!csp) {
      throw new Error("_headers no longer sets a content policy.");
    }
    return csp;
  }

  /** Every inline script the four page templates carry. */
  function pageHashes(): string[] {
    return [
      renderLanding(siteContent()),
      renderPage(renderDoc(docFiles()[0]!), navigation()),
      renderPost(posts()[0]!),
      readFileSync("packages/playground/index.html", "utf8"),
    ].flatMap(inlineScriptHashes);
  }

  it("confines the site to its own origin", () => {
    const csp = policy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    // No page fetches one, and the runtime is TypeScript rather than WASM.
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("http://");
  });

  /**
   * The page served for an address that names no file.
   *
   * Cloudflare Pages serves `404.html` with a real 404 status when the build
   * carries one. Without it, every unmatched address was answered with the
   * landing page and a **200**. `/contributing` and `/definitely-not-a-page`
   * both came back as the home page, measured against the live site, which
   * invites a crawler to index an unbounded set of duplicates.
   *
   * The scripts are the landing page's own bytes, so the policy already allows
   * them. That is the assertion worth having: a 404 page written freehand grows
   * `script-src` by a hash for a page almost nobody reaches.
   */
  it("serves a real 404 page that the policy already allows", () => {
    const page = render404();
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).toContain('href="/"');

    const landing = new Set(inlineScriptHashes(renderLanding(siteContent())));
    const hashes = inlineScriptHashes(page);
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(landing, "the 404 page needs a hash of its own").toContain(hash);
    }
  });

  it("keeps the 404 page out of the sitemap and in the build", () => {
    expect(builtPages()).toContain("404.html");
    // From the generator rather than from `dist/site/sitemap.xml`, which exists
    // only on a machine that has run the build.
    const xml = sitemap();
    expect(xml).not.toContain("/404");
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
  });

  /**
   * The one host the policy names, and the reason a test names it back.
   *
   * Cloudflare appends a Web Analytics beacon to every HTML response as it
   * serves it, so the tag exists in no file here and the policy refused it on
   * every page from the day the hashes went in. Allowing the host is what makes
   * the analytics work, and it costs little: the host is the CDN already
   * composing these responses, so the policy was never a boundary against it.
   *
   * What the test is really for is the next person who needs an off-host script
   * and finds a policy that already has one. An exact set fails on any second
   * host, so the argument has to be made again rather than inherited.
   *
   * `connect-src` is asserted alongside it because the beacon never attempts an
   * off-origin request: the injected tag sets `version` in `data-cf-beacon`,
   * which `beacon.min.js` reads to mean report to the same-origin
   * `/cdn-cgi/rum`, answered with a 204. Allowing the script and keeping every
   * fetch on this origin is the pair being held.
   *
   * The other half of making the analytics work was in the Cloudflare account
   * rather than here: the Web Analytics site carried an empty ruleset, so the
   * beacon was injected while the collector accepted data for no host, and the
   * report came back 404 until automatic installation was enabled on it. This
   * test stops at the shape of the policy because that half is a setting no
   * file in this repository holds.
   */
  it("allows the injected analytics beacon, and no other host", () => {
    const csp = policy();
    const hosts = [...csp.matchAll(/https?:\/\/\S+?(?=[\s;])/g)].map(
      (match) => match[0],
    );
    expect(new Set(hosts)).toEqual(
      new Set(["https://static.cloudflareinsights.com"]),
    );
    expect(/script-src ([^;]*)/.exec(csp)?.[1]).toContain(
      "https://static.cloudflareinsights.com",
    );
    expect(csp).toContain("connect-src 'self';");
  });

  /**
   * `script-src` allows each inline script by hash rather than by exemption.
   *
   * This was `'unsafe-inline'` with a note calling the per-page hash "a build
   * change rather than a header change", which is true and is not a reason: the
   * build is right there. What it costs is that the policy is now generated, so
   * the test is on the generator.
   */
  it("names every inline script by hash, and exempts none", () => {
    const csp = policy();
    const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";

    expect(scriptSrc).not.toContain("unsafe-inline");
    for (const hash of new Set(pageHashes())) {
      expect(
        scriptSrc,
        "a page carries a script the policy would refuse",
      ).toContain(hash);
    }
  });

  /**
   * A hash covers a script element. It does not cover an event-handler
   * attribute, and no `'unsafe-hashes'` is granted here, so an `onclick` or an
   * `onsubmit` anywhere in the markup is a control that silently stops working
   * on the deployed site and goes on working locally.
   *
   * The documentation search carried `onsubmit="return false"` on forty-five
   * pages. Enter would have submitted the form and navigated away from the
   * results.
   */
  it("has no inline event handler for the policy to refuse", () => {
    const offenders: string[] = [];
    const surfaces: [string, string][] = [
      ["the home page", renderLanding(siteContent())],
      [
        "a documentation page",
        renderPage(renderDoc(docFiles()[0]!), navigation()),
      ],
      ["a blog post", renderPost(posts()[0]!)],
      [
        "the playground",
        readFileSync("packages/playground/index.html", "utf8"),
      ],
    ];
    for (const [name, html] of surfaces) {
      for (const match of html.matchAll(/\son[a-z]+\s*=\s*"/g)) {
        offenders.push(`${name}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The placeholder is substituted with `String.replace`, which takes the
   * first occurrence, and the first draft of the comment explaining the
   * placeholder named it, so the hashes went into a comment and the policy
   * shipped the literal token. A source expression nothing matches is not a
   * loud failure: it is every inline script on every page refusing to run.
   */
  it("refuses a template that does not name the placeholder exactly once", () => {
    expect(() => responseHeaders("script-src 'self';\n", [])).toThrow(
      /exactly one/,
    );
    expect(() =>
      responseHeaders(
        "# __SCRIPT_HASHES__\nscript-src __SCRIPT_HASHES__;\n",
        [],
      ),
    ).toThrow(/exactly one/);
  });

  /** The hash is over the bytes between the tags, whitespace included. */
  it("hashes a script the way a browser does", () => {
    const digest = createHash("sha256")
      .update("  const a = 1;\n")
      .digest("base64");
    expect(inlineScriptHashes("<script>  const a = 1;\n</script>")).toEqual([
      `'sha256-${digest}'`,
    ]);
    // Anything with a `src` is a file, already covered by `'self'`.
    expect(
      inlineScriptHashes('<script src="/assets/docs.js"></script>'),
    ).toEqual([]);
  });

  /**
   * Vite writes a content hash into every playground bundle name, so those can
   * be immutable. `assets/site.css` is copied under a fixed name, so it cannot:
   * a year of `immutable` there pins a returning visitor to the stylesheet
   * they first saw, and no deploy reaches them.
   */
  it("caches the hashed bundles hard and the fixed names softly", () => {
    expect(rulesFor("/playground/assets/*")).toContain(
      "Cache-Control: public, max-age=31536000, immutable",
    );
    const stable = rulesFor("/assets/*").join(" ");
    expect(stable).toContain("Cache-Control:");
    expect(stable).not.toContain("immutable");

    // And the names really are what each rule assumes.
    expect(
      readFileSync("packages/playground/index.html", "utf8"),
    ).toBeDefined();
    for (const name of ["site.css", "docs.css", "docs.js", "blog.css"]) {
      expect(
        existsSync(`packages/site/src/${name}`),
        `/assets/${name} is copied under a fixed name`,
      ).toBe(true);
    }
  });

  /**
   * The redirect problem, applied to the one file it was never applied to.
   *
   * `_headers` matches the request URL, and Cloudflare Pages does not serve
   * `.html`: `/docs/glossary.html` is answered with a 308 to `/docs/glossary`.
   * So the `/*.html` block that carried the HTML cache policy matched the
   * redirect and never the page, for all fifty-one of them. The fix derived every
   * canonical, `og:url` and sitemap entry through `servedPath` and left this
   * file written in file paths.
   *
   * Held as the rule rather than as the one pattern that was wrong: any rule
   * naming a path this host will never be asked for is the same defect.
   */
  it("has no rule written as a path the host never receives", () => {
    const paths = HEADERS.split(/\n(?=\S)/)
      .map((block) => block.split("\n")[0]!.trim())
      .filter((path) => path !== "" && !path.startsWith("#"));

    expect(paths.length).toBeGreaterThan(2);
    for (const path of paths) {
      expect(path, `${path} matches a redirect, not a page`).not.toMatch(
        /\.html$/,
      );
    }

    // And what the site is actually served at is what the rules are written in.
    for (const page of builtPages()) {
      expect(servedPath(page)).not.toMatch(/\.html$/);
    }
  });

  /**
   * There is exactly one `Cache-Control` per request, because Cloudflare joins
   * duplicate header values with a comma rather than letting the later rule
   * win. A `/*` floor carrying one would comma-join with both asset rules.
   *
   * HTML needs no rule at all: Pages answers every cacheable request with
   * `public, max-age=0, must-revalidate` already, which is the policy the dead
   * `/*.html` block was asking for. The two blocks that remain exist to raise
   * that default, and neither overlaps the other.
   */
  it("never sets the cache lifetime twice for one request", () => {
    const caching = HEADERS.split(/\n(?=\S)/)
      .filter(
        (block) =>
          !block.startsWith("#") &&
          block
            .split("\n")
            .slice(1)
            .some((line) => line.trim().startsWith("Cache-Control:")),
      )
      .map((block) => block.split("\n")[0]!.trim());

    expect(caching).toEqual(["/playground/assets/*", "/assets/*"]);
    expect(rulesFor("/*").join(" ")).not.toContain("Cache-Control");

    // `/assets/*` must not also match a playground bundle, or both apply.
    expect(
      caching.filter((path) =>
        "/playground/assets/x.js".startsWith(path.replace("*", "")),
      ),
    ).toEqual(["/playground/assets/*"]);
  });
});
