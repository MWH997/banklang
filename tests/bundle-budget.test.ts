import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkBudget,
  FIRST_LOAD_GZIP,
  readBundle,
  TOTAL_GZIP,
  type Asset,
} from "../tools/bundle-budget";

/**
 * The size budget, and the wiring that makes it a build failure.
 *
 * The problem was never that the playground is 879 kB. It is that Vite has
 * printed "(!) Some chunks are larger than 500 kB after minification" on every
 * build since there was a playground, and nothing reads it. A number
 * with no consequence is what let the bundle get there.
 *
 * So this file checks two things: that the budget refuses a bundle over it, and
 * that `pnpm build:site` runs the budget. The second is the one that matters:
 * a check nothing invokes is the warning again.
 */

/** Minified JavaScript compresses about 3.5:1, which is what the real one does. */
function asset(name: string, gzip: number, firstLoad = true): Asset {
  return { name, bytes: Math.round(gzip * 3.5), gzip, firstLoad };
}

describe("the budget", () => {
  it("passes a bundle inside it", () => {
    const result = checkBudget([
      asset("assets/app.js", FIRST_LOAD_GZIP - 4096),
    ]);

    expect(result.over).toEqual([]);
  });

  it("refuses a first load over it", () => {
    const result = checkBudget([asset("assets/app.js", FIRST_LOAD_GZIP + 1)]);

    expect(result.over.length).toBeGreaterThan(0);
    expect(result.over[0]).toContain("first load, compressed");
    // The setting to change, named, so the message is actionable rather than
    // an instruction to make the number go down somehow.
    expect(result.over.join("\n")).toContain("FIRST_LOAD_GZIP");
  });

  /**
   * The budget a split can defeat. Moving the COBOL runtime behind a dynamic
   * `import()` takes it out of the first load; it does not take it off the
   * wire, and a reader who presses **Run** downloads it either way.
   */
  it("refuses a total over it however the bundle is split", () => {
    const result = checkBudget([
      asset("assets/app.js", 64 * 1024),
      asset("assets/runtime.js", TOTAL_GZIP, false),
    ]);

    expect(result.over.map((line) => line.split(" is ")[0])).toContain(
      "The everything, compressed",
    );
    expect(result.over.join("\n")).not.toContain("first load, compressed");
  });

  /**
   * A build well under budget says so rather than failing. Failing because
   * something got smaller is how a number gets raised without being read.
   */
  it("asks for the budget to come down when there is room", () => {
    const result = checkBudget([asset("assets/app.js", 16 * 1024)]);

    expect(result.over).toEqual([]);
    expect(result.slack.length).toBeGreaterThan(0);
    expect(result.slack.join("\n")).toContain("Lower FIRST_LOAD_GZIP");
  });

  it("prints every asset with both sizes", () => {
    const result = checkBudget([
      asset("assets/app.js", 1024),
      asset("assets/late.js", 512, false),
    ]);

    expect(result.report).toContain("assets/app.js");
    expect(result.report).toContain("assets/late.js");
    expect(result.report).toContain("gzip");
  });
});

/**
 * What counts as the first load.
 *
 * Read from `index.html` rather than from a list here, because Vite decides it:
 * the entry script, the stylesheet, and every `modulepreload`, which is Vite's
 * way of saying "fetch this now". A chunk that is only reachable by a dynamic
 * `import()` is in the bundle and not in the first load, and telling those
 * apart is the whole point of splitting.
 */
describe("reading a built bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "banklang-bundle-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html><head>
      <link rel="stylesheet" href="./assets/index.css">
      <link rel="modulepreload" href="./assets/vendor.js">
    </head><body><script type="module" src="./assets/index.js"></script></body></html>`,
  );
  for (const [name, size] of [
    ["assets/index.js", 4000],
    ["assets/index.css", 800],
    ["assets/vendor.js", 2000],
    ["assets/runtime.js", 3000],
    ["assets/logo.svg", 100],
  ] as const) {
    writeFileSync(join(root, name), "x".repeat(size));
  }

  const assets = readBundle(root);

  it("counts the entry, the stylesheet and the preloads", () => {
    expect(
      assets
        .filter((entry) => entry.firstLoad)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["assets/index.css", "assets/index.js", "assets/vendor.js"]);
  });

  it("counts a lazily loaded chunk in the total and not the first load", () => {
    expect(
      assets.find((entry) => entry.name === "assets/runtime.js")?.firstLoad,
    ).toBe(false);
  });

  it("ignores what is not script or style", () => {
    expect(assets.map((entry) => entry.name)).not.toContain("assets/logo.svg");
  });

  it("measures compressed and uncompressed separately", () => {
    const entry = assets.find((item) => item.name === "assets/index.js")!;
    expect(entry.bytes).toBe(4000);
    expect(entry.gzip).toBeLessThan(entry.bytes);
  });
});

/**
 * The wiring, asserted on the source.
 *
 * `pnpm build:site` is what CI runs and what Cloudflare Pages runs, so it is
 * the only place a budget can actually stop something. A test that measured the
 * real bundle would need the playground built first and would skip when it was
 * not, which is the shape of check that passes on the day it matters.
 */
describe("the build", () => {
  const source = readFileSync("tools/build-site.ts", "utf8");

  it("checks the budget", () => {
    expect(source).toContain("checkPlaygroundBudget");
  });

  it("checks it before publishing the bundle", () => {
    expect(source.indexOf("checkPlaygroundBudget(ROOT)")).toBeLessThan(
      source.indexOf('cpSync(join(ROOT, "packages/playground/dist")'),
    );
  });
});
