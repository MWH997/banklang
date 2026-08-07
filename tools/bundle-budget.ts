/**
 * What the playground is allowed to weigh.
 *
 * The 2026-08-07 audit's F12: `dist/assets/index-*.js` is 879 kB unsplit, Vite
 * prints "(!) Some chunks are larger than 500 kB after minification" on every
 * build, and nothing reads it. This is the target of the home page's primary
 * call to action — parser, typechecker, IR, backend, precompiler, COBOL
 * runtime, CodeMirror and eight `?raw` runtime programs are all in the first
 * download, including for a reader who only opens the COBOL tab.
 *
 * A warning nobody acts on is not a check, and the reason the bundle got here
 * is that nothing ever said no. This does.
 *
 * **Gzip, because that is what crosses the wire.** Cloudflare compresses every
 * text response, so the megabyte on disk is not what anybody waits for.
 * Uncompressed size is budgeted too, at a much looser figure: it is what the
 * browser parses and it grows for reasons compression hides.
 *
 * **The budget is a ratchet, and it only ever goes down.** When D4's split
 * lands — dynamic `import()` for the COBOL runtime and the `?raw` programs, so
 * they arrive when **Run** is first opened — this file is where the win is
 * banked. A build well under budget says so and names the number to write,
 * rather than failing: a build that breaks because it got *smaller* teaches
 * people to change the number without reading it.
 *
 * Usage: pnpm playground:budget, and `pnpm build:site` runs it.
 */

import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * What the browser downloads before the playground is usable.
 *
 * 222 kB of it today, of which the compiler is most. The budget is what that
 * measures plus room for a dependency bump — close enough that adding a library
 * to the initial download is a decision somebody makes on purpose.
 *
 * B2's Input panel spent about 4 kB of the first headroom this had, which is
 * what the number is for: it was a decision, it was measured, and the figure
 * moved with a reason rather than because a build went red.
 *
 * D4's split then took 36 kB back out. The interpreter, the precompiler and the
 * eight `runtime/*.cbl` programs are fetched when **Run** is first opened, so a
 * reader who comes for the COBOL and leaves never downloads them. The ceiling
 * came down with the win rather than being left where it was, which is the only
 * way a budget records a saving instead of quietly absorbing it.
 */
export const FIRST_LOAD_GZIP = 238 * 1024;

/**
 * Everything the page can eventually pull, compressed.
 *
 * Now genuinely more than the first load, since the runtime chunk is real. This
 * is the number that keeps the split honest: moving bytes out of the first
 * download while adding more of them overall makes one figure look good and
 * costs the reader more, and it is the ordinary way a code-splitting change
 * goes wrong.
 */
export const TOTAL_GZIP = 274 * 1024;

/**
 * The uncompressed first load, which is what the browser parses.
 *
 * Deliberately looser than the gzip figure. Minified JavaScript compresses
 * about 3.5:1 and a change that moves this without moving the compressed size
 * is one that added repetition — generated tables, duplicated helpers — which
 * is worth a look but is not a download anybody waits for.
 */
export const FIRST_LOAD_BYTES = 830 * 1024;

/** How far under budget is far enough to say the budget should come down. */
const SLACK = 0.85;

export interface Asset {
  /** Path relative to the bundle root, as the report prints it. */
  name: string;
  bytes: number;
  gzip: number;
  /** True where `index.html` asks for the file before the page is usable. */
  firstLoad: boolean;
}

export interface BudgetResult {
  assets: Asset[];
  report: string;
  /** Budgets exceeded, empty on a build that fits. */
  over: string[];
  /** Budgets with room to come down, which is a note rather than a failure. */
  slack: string[];
}

/**
 * Read a built bundle.
 *
 * The first load is what `index.html` names: its `<script>`, its stylesheet,
 * and every `modulepreload`, which is Vite's way of saying "fetch this now".
 * Anything else in the directory is reachable but not waited for.
 */
export function readBundle(root: string): Asset[] {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const wanted = new Set(
    [
      ...html.matchAll(
        /(?:src|href)="\.?\/?([^"]+\.(?:js|css|mjs))"|modulepreload"[^>]*href="\.?\/?([^"]+)"/g,
      ),
    ].flatMap((match) =>
      [match[1], match[2]].filter((path) => path !== undefined),
    ),
  );

  return files(root)
    .filter((path) => /\.(?:js|mjs|css)$/.test(path))
    .map((path) => {
      const name = relative(root, path).split("\\").join("/");
      const content = readFileSync(path);
      return {
        name,
        bytes: content.byteLength,
        gzip: gzipSync(content, { level: 9 }).byteLength,
        firstLoad: wanted.has(name),
      };
    })
    .sort((left, right) => right.gzip - left.gzip);
}

export function checkBudget(assets: Asset[]): BudgetResult {
  const first = assets.filter((asset) => asset.firstLoad);
  const measured = [
    {
      what: "first load, compressed",
      used: sum(first, "gzip"),
      limit: FIRST_LOAD_GZIP,
      setting: "FIRST_LOAD_GZIP",
    },
    {
      what: "first load, uncompressed",
      used: sum(first, "bytes"),
      limit: FIRST_LOAD_BYTES,
      setting: "FIRST_LOAD_BYTES",
    },
    {
      what: "everything, compressed",
      used: sum(assets, "gzip"),
      limit: TOTAL_GZIP,
      setting: "TOTAL_GZIP",
    },
  ];

  const lines = [
    "Playground bundle",
    "",
    ...assets.map(
      (asset) =>
        `  ${asset.firstLoad ? "*" : " "} ${asset.name.padEnd(34)} ${kb(asset.bytes).padStart(9)}  ${kb(asset.gzip).padStart(9)} gzip`,
    ),
    "",
    "  * arrives before the playground is usable",
    "",
    ...measured.map(
      (budget) =>
        `  ${budget.what.padEnd(26)} ${kb(budget.used).padStart(9)} of ${kb(budget.limit).padStart(9)}  ${percent(budget.used, budget.limit)}`,
    ),
  ];

  return {
    assets,
    report: `${lines.join("\n")}\n`,
    over: measured
      .filter((budget) => budget.used > budget.limit)
      .map(
        (budget) =>
          `The ${budget.what} is ${kb(budget.used)}, over its ${kb(budget.limit)} budget. Split something out of the first load, or decide the budget was wrong and say so in ${budget.setting}.`,
      ),
    slack: measured
      .filter((budget) => budget.used < budget.limit * SLACK)
      .map(
        (budget) =>
          `The ${budget.what} is ${percent(budget.used, budget.limit)} of its budget. Lower ${budget.setting} to about ${kb(Math.ceil(budget.used * 1.08))} so the win is kept.`,
      ),
  };
}

function sum(assets: Asset[], field: "bytes" | "gzip"): number {
  return assets.reduce((total, asset) => total + asset[field], 0);
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function percent(used: number, limit: number): string {
  return `${((used / limit) * 100).toFixed(0)}%`;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The built playground, checked. Throws with the report where it is over. */
export function checkPlaygroundBudget(cwd = process.cwd()): BudgetResult {
  const result = checkBudget(
    readBundle(resolve(cwd, "packages/playground/dist")),
  );
  if (result.over.length > 0) {
    throw new Error(`${result.report}\n${result.over.join("\n")}\n`);
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = checkBudget(
    readBundle(resolve(process.cwd(), "packages/playground/dist")),
  );
  process.stdout.write(result.report);
  for (const note of result.slack) {
    process.stdout.write(`\n${note}\n`);
  }
  for (const failure of result.over) {
    process.stderr.write(`\n${failure}\n`);
  }
  if (result.over.length > 0) {
    process.exitCode = 1;
  }
}
