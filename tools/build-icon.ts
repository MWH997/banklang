/**
 * The extension's marketplace icon, rasterised without a browser.
 *
 * The Visual Studio Marketplace will not take an SVG as an extension icon — it
 * renders publisher-supplied artwork, and an SVG can carry script — so the
 * listing needs a PNG of at least 128x128. The site's mark is an SVG.
 *
 * `tools/build-og.ts` solves the same problem by screenshotting a page and
 * checking the result in, "because a build should not need a browser". That is
 * the right trade for the Open Graph card, which is a rendered page of real
 * compiler output. It is the wrong one here: this mark is four shapes and two
 * rounded rectangles, and a checked-in binary nobody can regenerate is a file
 * that quietly stops matching the site the day the palette changes.
 *
 * So it is computed. Same geometry as `packages/playground/public/favicon.svg`,
 * evaluated per pixel at 4x and averaged down, encoded as a PNG here rather
 * than by a dependency. `tests/vscode-extension.test.ts` holds the colours to
 * the favicon's and the checked-in file to a fresh render, so the icon cannot
 * drift from either the site or this program.
 *
 * Usage: pnpm build:icon
 */

import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 256, not 128: the minimum is 128 and this is drawn on retina displays. */
export const SIZE = 256;

/** Samples per axis. Four is where the arc's edge stops looking stepped. */
const SUPERSAMPLE = 4;

/**
 * The palette, which is the site's.
 *
 * Held to `favicon.svg` by a test rather than imported from it: parsing an SVG
 * to find three hex strings is more machinery than the thing it protects, and
 * the failure it protects against — a rebrand that moves the site and leaves
 * the extension on the old blue — is one a comparison catches just as well.
 */
export const PALETTE = {
  field: "#0d1117",
  letter: "#58a6ff",
  rule: "#3fb950",
};

/* ------------------------------------------------------------------ *
 * The mark, in the favicon's own 32-unit space.
 * ------------------------------------------------------------------ */

const roundedRect =
  (x0: number, y0: number, x1: number, y1: number, radius: number) =>
  (x: number, y: number): boolean => {
    if (x < x0 || x > x1 || y < y0 || y > y1) {
      return false;
    }
    // Inside the straight part of either axis, the corner radius is irrelevant.
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };

const disc =
  (cx: number, cy: number, radius: number) =>
  (x: number, y: number): boolean =>
    (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;

const box =
  (x0: number, y0: number, x1: number, y1: number) =>
  (x: number, y: number): boolean =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;

const any =
  (...shapes: ((x: number, y: number) => boolean)[]) =>
  (x: number, y: number): boolean =>
    shapes.some((shape) => shape(x, y));

/**
 * `M8 9h7.5a4.2 4.2 0 0 1 0 8.4H8V9Zm0 8.4h8.2a4.3 4.3 0 0 1 0 8.6H8v-8.6Z`
 *
 * Two stacked bowls, each a rectangle closed on the right by a half-circle
 * whose diameter is the rectangle's height — which is what the arc in the path
 * is, so the disc and the box together are exactly the filled region. The B has
 * no counters in this mark; there are no holes to subtract.
 */
const LETTER = any(
  box(8, 9, 15.5, 17.4),
  disc(15.5, 13.2, 4.2),
  box(8, 17.4, 16.2, 26),
  disc(16.2, 21.7, 4.3),
);

const FIELD = roundedRect(0, 0, 32, 32, 7);
const RULE = roundedRect(21, 6, 23.6, 26, 1.3);

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * One pixel, supersampled.
 *
 * Outside the rounded field the icon is transparent, so the corners sit on
 * whatever the marketplace or the editor puts behind them rather than on a
 * white square. That means averaging in the alpha channel too, and premultiply
 * is what keeps the corner from picking up a dark fringe.
 */
function pixel(px: number, py: number): [number, number, number, number] {
  const field = channels(PALETTE.field);
  const letter = channels(PALETTE.letter);
  const rule = channels(PALETTE.rule);

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const x = ((px + (sx + 0.5) / SUPERSAMPLE) / SIZE) * 32;
      const y = ((py + (sy + 0.5) / SUPERSAMPLE) / SIZE) * 32;
      if (!FIELD(x, y)) {
        continue;
      }
      const colour = LETTER(x, y) ? letter : RULE(x, y) ? rule : field;
      r += colour[0];
      g += colour[1];
      b += colour[2];
      a += 255;
    }
  }

  const samples = SUPERSAMPLE * SUPERSAMPLE;
  if (a === 0) {
    return [0, 0, 0, 0];
  }
  // Divided by the covered samples, not by all of them: an edge pixel takes the
  // colour of the part of it that is inside, at the coverage the alpha states.
  const covered = a / 255;
  return [
    Math.round(r / covered),
    Math.round(g / covered),
    Math.round(b / covered),
    Math.round(a / samples),
  ];
}

/* ------------------------------------------------------------------ *
 * PNG, written out rather than depended on.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The icon, as PNG bytes. Deterministic: the same input, the same file. */
export function renderIcon(): Buffer {
  // Filter byte 0 per scanline. The alternatives buy a few hundred bytes on an
  // image this flat and cost the property that makes this worth generating,
  // which is that two runs produce the same file.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (1 + SIZE * 4);
    raw[row] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = row + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Where the extension manifest's `icon` points. */
export const ICON_PATH = join(ROOT, "packages/vscode-extension/icon.png");

/** The three colours the site's favicon uses, in the order they appear. */
export function faviconColours(): string[] {
  const favicon = readFileSync(
    join(ROOT, "packages/playground/public/favicon.svg"),
    "utf8",
  );
  return [...favicon.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map(
    (match) => match[1] ?? "",
  );
}

function main(): void {
  const png = renderIcon();
  writeFileSync(ICON_PATH, png);
  console.log(
    `Wrote ${ICON_PATH.slice(ROOT.length + 1)} — ${String(SIZE)}x${String(SIZE)}, ${String(png.length)} bytes.`,
  );
}

if (process.argv[1]?.endsWith("build-icon.ts")) {
  main();
}
