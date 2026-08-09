/**
 * The CycloneDX Software Bill of Materials.
 *
 * Release hygiene, from the launch checklist. The first thing a bank's security function
 * asks for is an inventory of what is in the build, and the format they ask for
 * it in is CycloneDX — ratified as **ECMA-424**, 1st edition for 1.6 and 2nd
 * edition (December 2025) for 1.7, which is what this emits.
 *
 * ## No new dependency
 *
 * pnpm 11 generates CycloneDX natively. That is not a convenience: CycloneDX
 * abandoned their own `cyclonedx-node-pnpm` in favour of it, so the native
 * command *is* the maintained implementation. It also means the tool that
 * inventories the supply chain is not itself a new link in it — which matters
 * here, where `pnpm-workspace.yaml` sets a `minimumReleaseAge` precisely to
 * avoid being first to install a fresh release.
 *
 * ## Why this wraps the command instead of being one line of YAML
 *
 * Two things a bare `pnpm sbom` gets wrong, and both are silent.
 *
 * **The licence column is a property of the store, not of the project.** pnpm
 * reads each licence out of the package's own `package.json` in the content
 * store, and a package that does not run on this platform was never downloaded
 * into it. Measured against an empty store on 2026-08-07: a normal install and
 * `pnpm sbom` produce **79 of 392 components with no licence**, every one a
 * prebuilt native binary — `@esbuild/*`, `@rolldown/binding-*`,
 * `lightningcss-*`. A licence scanner reads that as 79 components needing
 * manual review.
 *
 * It is worse than machine-dependent. The store is global and shared across
 * every project on the machine, so the same commit produces a different BOM
 * depending on what else has been installed there — running the
 * `--all-platforms` path once fills the store, and every plain `pnpm sbom`
 * afterwards reports full coverage from packages that are not in this
 * project's `node_modules` at all. An artifact that gets *more* complete
 * because of unrelated work is one nobody can reproduce.
 *
 * `--all-platforms` resolves the whole matrix first, which takes the count to
 * zero from a cold store — 32 seconds and about a gigabyte, which is why it is
 * a flag and not the default.
 *
 * (`--lockfile-only` is the opposite trade, and worth naming so nobody reaches
 * for it as the fix: it never touches the store, so all 392 come out with no
 * licence at all.)
 *
 * **A dangling reference drops a subtree.** `dependencies[].dependsOn` is how a
 * scanner walks the graph; a ref that names nothing makes it stop, quietly, at
 * a smaller tree than the one you shipped. `problems()` walks it here instead.
 *
 * ## Not checked in
 *
 * A BOM carries a timestamp and a fresh `serialNumber` per document — required
 * by the spec, since two BOMs of the same tree are still two documents. So it
 * cannot be committed and held to `git diff` the way every other generated file
 * here is. It is built in CI and attached to the release, and what is committed
 * is this program and the tests that hold its output to the invariants above.
 *
 * Usage:
 *   pnpm sbom:check      report problems, write nothing — the quick one
 *   pnpm sbom:build      write dist/sbom/, resolving this platform only
 *   pnpm sbom:release    resolve every platform first; what CI runs
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pinned rather than left to pnpm's default.
 *
 * The default moves when pnpm adopts a new specification, and a BOM that
 * changes specification version between two releases is a change a consumer
 * discovers by failing to parse it. 1.7 is ECMA-424 2nd edition.
 */
export const SPEC_VERSION = "1.7";

/**
 * Every platform the locked tree has a prebuilt binary for.
 *
 * This is not a wish list — it is derived from the lockfile, and
 * `tests/sbom.test.ts` fails if the lockfile ever names an `os`, `cpu` or
 * `libc` that is missing here. That check is the point: a new dependency
 * bringing in, say, a `powerpc64` build would otherwise reintroduce exactly the
 * silent licence gap this exists to close, and the BOM would still look
 * complete.
 *
 * pnpm's `"*"` is not a wildcard over unknown values — asking for it returns
 * the same set as naming the three common operating systems, so the values are
 * listed.
 */
export const ARCHITECTURES: Record<"os" | "cpu" | "libc", string[]> = {
  os: [
    "aix",
    // Not a `process.platform` value. `@vscode/vsce-sign` ships an
    // `alpine-x64` build and declares `os: [alpine]` where the convention is
    // `os: [linux], libc: [musl]`. pnpm records what the package says, so this
    // does too — the alternative is a platform binary nobody resolves.
    "alpine",
    "android",
    "darwin",
    "freebsd",
    "linux",
    "netbsd",
    "openbsd",
    "openharmony",
    "sunos",
    "win32",
  ],
  cpu: [
    "arm",
    "arm64",
    "ia32",
    "loong64",
    "mips64el",
    "ppc64",
    "riscv64",
    "s390x",
    "wasm32",
    "x64",
  ],
  libc: ["glibc", "musl"],
};

/** The `supportedArchitectures` block, as pnpm reads it. */
export function architecturesBlock(): string {
  const section = (key: "os" | "cpu" | "libc"): string =>
    `  ${key}:\n${ARCHITECTURES[key].map((value) => `    - ${value}`).join("\n")}`;
  return [
    "",
    "# Added by tools/sbom.ts in a throwaway copy of this workspace, never here:",
    "# resolving every platform is how the BOM gets a licence for the prebuilt",
    "# binaries, and is a gigabyte of downloads nobody working on the compiler",
    "# needs.",
    "supportedArchitectures:",
    section("os"),
    section("cpu"),
    section("libc"),
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The lockfile, read for the two things the BOM cannot say about itself.
 * ------------------------------------------------------------------ */

export interface LockfileFacts {
  /** `name@version` of every package the lockfile restricts to a platform. */
  platformConstrained: Set<string>;
  /**
   * `name@version` of every package the lockfile marks `optional: true`.
   *
   * A package can be absent for two reasons, and only one of them is a
   * platform. `@napi-rs/wasm-runtime` and the `@emnapi/*` packages under it are
   * the WebAssembly fallback for the native bundlers: no `os` or `cpu` — they
   * run anywhere — but optional, so a machine that resolved the native binary
   * never downloads them. Found by CI on 2026-08-07, where five of them arrived
   * in the BOM with no licence and the platform rule did not excuse them.
   */
  optional: Set<string>;
  /** Every distinct `os`, `cpu` and `libc` value the lockfile names. */
  platforms: Record<"os" | "cpu" | "libc", Set<string>>;
}

/**
 * Whether a package may legitimately be missing from this machine's store.
 *
 * Both reasons mean the same thing for a licence: there is nothing on disk to
 * read one out of, so its absence is the store's doing rather than the BOM's.
 * `--all-platforms` resolves both sets, which is why the strict run still
 * demands a licence for every one of them.
 */
export function mayBeAbsent(facts: LockfileFacts, key: string): boolean {
  return facts.platformConstrained.has(key) || facts.optional.has(key);
}

/**
 * Which packages are prebuilt binaries, taken from the lockfile rather than
 * from their names.
 *
 * The alternative is a list of prefixes — `@esbuild/`, `@rolldown/`,
 * `lightningcss-` — which is a list that goes stale the first time a dependency
 * ships a native binary under a name nobody predicted. `os:`, `cpu:` and
 * `libc:` are what pnpm itself uses to decide whether to install one.
 */
export function lockfileFacts(): LockfileFacts {
  const lockfile = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
  const platformConstrained = new Set<string>();
  const optional = new Set<string>();
  const platforms = {
    os: new Set<string>(),
    cpu: new Set<string>(),
    libc: new Set<string>(),
  };

  let current = "";
  for (const line of lockfile.split("\n")) {
    const entry = /^ {2}(?!\s)(.+):$/.exec(line);
    if (entry) {
      // `pkg@1.0.0(peer@2.0.0)` — the peer suffix is pnpm's, not the package's.
      current = (entry[1] ?? "")
        .replace(/^["']|["']$/g, "")
        .replace(/\(.*$/, "");
      continue;
    }
    if (/^ {4}optional: true$/.test(line) && current !== "") {
      optional.add(current);
    }
    const field = /^ {4}(os|cpu|libc): \[(.+)\]$/.exec(line);
    if (field && current !== "") {
      const key = field[1] as "os" | "cpu" | "libc";
      platformConstrained.add(current);
      for (const value of (field[2] ?? "").split(",")) {
        platforms[key].add(value.trim().replace(/^["']|["']$/g, ""));
      }
    }
  }

  return { platformConstrained, optional, platforms };
}

/* ------------------------------------------------------------------ *
 * Generation.
 * ------------------------------------------------------------------ */

export interface BomComponent {
  type: string;
  name: string;
  version?: string;
  group?: string;
  purl?: string;
  "bom-ref"?: string;
  licenses?: unknown[];
}

export interface Bom {
  bomFormat: string;
  specVersion: string;
  serialNumber?: string;
  version: number;
  metadata: {
    timestamp?: string;
    component: BomComponent & { description?: string };
    supplier?: { name?: string };
    authors?: { name?: string }[];
    tools?: unknown;
  };
  components: BomComponent[];
  dependencies?: { ref: string; dependsOn?: string[] }[];
}

/** `@types/node@24.0.0`, from the pieces CycloneDX splits it into. */
export function componentKey(component: BomComponent): string {
  const name =
    component.group !== undefined && component.group !== ""
      ? `${component.group}/${component.name}`
      : component.name;
  return `${name}@${component.version ?? ""}`;
}

/* ------------------------------------------------------------------ *
 * The licences pnpm drops.
 * ------------------------------------------------------------------ */

/**
 * A package's own declared licence, read from its own `package.json`.
 *
 * `undefined` when the package is not on disk or declares nothing. Nothing is
 * inferred: this is the string the publisher wrote, or nothing at all.
 */
export function declaredLicence(cwd: string, key: string): string | undefined {
  // pnpm's store directory names escape the scope slash and nothing else:
  // `@vscode/vsce-sign@2.0.9` lives under `@vscode+vsce-sign@2.0.9`.
  const name = key.slice(0, key.lastIndexOf("@"));
  const path = join(
    cwd,
    "node_modules/.pnpm",
    key.replace("/", "+"),
    "node_modules",
    name,
    "package.json",
  );

  let manifest: { license?: unknown; licenses?: unknown };
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as typeof manifest;
  } catch {
    return undefined;
  }

  if (typeof manifest.license === "string" && manifest.license !== "") {
    return manifest.license;
  }
  // The pre-2015 forms, still in the wild on old packages.
  const legacy = manifest.license ?? manifest.licenses;
  if (Array.isArray(legacy)) {
    const first = legacy[0] as { type?: unknown } | undefined;
    return typeof first?.type === "string" ? first.type : undefined;
  }
  const single = legacy as { type?: unknown } | undefined;
  return typeof single?.type === "string" ? single.type : undefined;
}

/**
 * Put back the licences pnpm's generator silently drops.
 *
 * Found on 2026-08-07, by this repository's own tests, the day `@vscode/vsce`
 * was added to package the extension. Ten components arrived with **no licence
 * field at all** — `@vscode/vsce-sign` and its nine platform binaries — and
 * every one of them is installed, on disk, declaring
 * `"license": "SEE LICENSE IN LICENSE.txt"` in its own `package.json`.
 *
 * pnpm emits `licenses[].license.id`, which CycloneDX defines as an SPDX
 * identifier. `SEE LICENSE IN …` is not one, so the entry is dropped rather
 * than written to `license.name`, which is the field the specification provides
 * for exactly this. The direction of that error is the problem: the only
 * proprietary components in this tree are the only ones the BOM says nothing
 * about, and "unknown licence" is a weaker finding than "Microsoft's own terms,
 * in a file". A reviewer chasing the first one has to go and find the second.
 *
 * So the value is read back out of the package the BOM is describing and
 * written where the specification puts it. Nothing is guessed — a package that
 * declares no licence still comes out with none, and `problems()` still fails
 * on it.
 */
export function repairLicences(bom: Bom, cwd: string): number {
  let repaired = 0;
  for (const component of bom.components) {
    if ((component.licenses ?? []).length > 0) {
      continue;
    }
    const declared = declaredLicence(cwd, componentKey(component));
    if (declared === undefined) {
      continue;
    }
    component.licenses = [{ license: { name: declared } }];
    repaired += 1;
  }
  return repaired;
}

/**
 * Every list in the document, in a fixed order.
 *
 * pnpm walks the store and emits components in whatever order it arrives at
 * them, so two runs a second apart put `@stryker-mutator/vitest-runner` and
 * `@stryker-mutator/core` in different places, and the `dependencies` graph
 * comes out in a third order again. Nothing downstream cares. A reader
 * comparing one release's bill of materials against the next does: an
 * unordered list makes a diff that is almost entirely reordering, with the one
 * dependency that actually changed hidden somewhere inside it.
 *
 * `bom-ref` is the purl and is unique — `problems()` fails when two components
 * share one — so it is a total order, and the `?? ""` is for the type rather
 * than for a case that occurs.
 *
 * This does not make the file reproducible byte for byte, and it is worth being
 * exact about what is left. `serialNumber` and `metadata.timestamp` differ per
 * run by design — CycloneDX defines both as identifying the document rather
 * than its contents. Beyond those, the `dependsOn` edges themselves vary: two
 * runs a second apart disagree about whether
 * `@babel/plugin-proposal-decorators` depends on `@babel/helper-plugin-utils`.
 * That is the generator's own resolution, not an ordering this can impose, and
 * sorting a list whose membership changes would hide it rather than fix it.
 *
 * So: the component list — the bill of materials proper, and the thing a
 * reviewer diffs between releases — is stable. The dependency graph is not,
 * and no claim is made that it is.
 */
export function sortBom(bom: Bom): void {
  const byRef = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

  bom.components.sort((left, right) =>
    byRef(left["bom-ref"] ?? "", right["bom-ref"] ?? ""),
  );
  for (const dependency of bom.dependencies ?? []) {
    dependency.dependsOn?.sort(byRef);
  }
  bom.dependencies?.sort((left, right) => byRef(left.ref, right.ref));
}

/** The author, taken from `CITATION.cff` so the two cannot disagree. */
export function supplier(): string {
  const citation = readFileSync(join(ROOT, "CITATION.cff"), "utf8");
  const family = /^\s*-?\s*family-names:\s*(.+)$/m.exec(citation)?.[1]?.trim();
  const given = /^\s*given-names:\s*(.+)$/m.exec(citation)?.[1]?.trim();
  if (family === undefined || given === undefined) {
    throw new Error("CITATION.cff names no author to put in the BOM.");
  }
  return `${given} ${family}`;
}

function pnpmSbom(cwd: string): Bom {
  const output = execFileSync(
    "pnpm",
    [
      "sbom",
      "--sbom-format",
      "cyclonedx",
      "--sbom-spec-version",
      SPEC_VERSION,
      // The root of this tree is a compiler and its toolchain, not a library
      // somebody links against. CycloneDX distinguishes the two, and a scanner
      // that reports on applications separately would otherwise miss it.
      "--sbom-type",
      "application",
      "--sbom-supplier",
      supplier(),
      "--sbom-authors",
      supplier(),
    ],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const bom = JSON.parse(output) as Bom;
  repairLicences(bom, cwd);
  return bom;
}

/**
 * A copy of the workspace with every platform resolved.
 *
 * Only the manifests and the lockfile are copied — that is everything pnpm
 * needs to install, and it means the real `node_modules` is never replaced with
 * a gigabyte of binaries for platforms this machine cannot run. The working
 * tree is not written to at all: the `supportedArchitectures` block goes into
 * the copy's `pnpm-workspace.yaml` and dies with the directory.
 */
function inEveryPlatform<T>(use: (cwd: string) => T): T {
  const scratch = mkdtempSync(join(tmpdir(), "banklang-sbom-"));
  try {
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
      cpSync(join(ROOT, file), join(scratch, file));
    }
    writeFileSync(
      join(scratch, "pnpm-workspace.yaml"),
      readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8") +
        architecturesBlock(),
      "utf8",
    );
    for (const entry of readdirSync(join(ROOT, "packages"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifest = join(ROOT, "packages", entry.name, "package.json");
      if (!existsSync(manifest)) {
        // `packages/site` is sources the site build reads, not a workspace
        // project. It has no manifest, so it contributes nothing to install.
        continue;
      }
      mkdirSync(join(scratch, "packages", entry.name), { recursive: true });
      cpSync(manifest, join(scratch, "packages", entry.name, "package.json"));
    }

    // `--ignore-scripts`: nothing here is built, and running a postinstall for
    // a platform this machine is not would fail or, worse, not.
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: scratch,
      stdio: "inherit",
    });
    return use(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Build the BOM. `allPlatforms` is what closes the licence gap. */
export function generate(allPlatforms: boolean): Bom {
  return allPlatforms ? inEveryPlatform(pnpmSbom) : pnpmSbom(ROOT);
}

/* ------------------------------------------------------------------ *
 * What makes it a BOM rather than a file that parses.
 * ------------------------------------------------------------------ */

export interface Options {
  /**
   * Whether a missing licence on a prebuilt binary is a problem.
   *
   * On a developer's machine it is not — those packages are not installed, so
   * there is nothing to read a licence out of. In CI, where `--all-platforms`
   * resolved the lot, it is: it means the matrix above stopped covering the
   * tree.
   */
  strict: boolean;
}

export function problems(bom: Bom, options: Options): string[] {
  const found: string[] = [];
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { name: string; version: string; license: string };

  if (bom.bomFormat !== "CycloneDX") {
    found.push(`bomFormat is ${bom.bomFormat}, not CycloneDX`);
  }
  if (bom.specVersion !== SPEC_VERSION) {
    found.push(`specVersion is ${bom.specVersion}, not ${SPEC_VERSION}`);
  }
  // A consumer keys on the serial number to tell two BOMs of the same tree
  // apart. The spec requires the RFC 4122 URN form; a bare UUID is dropped.
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(bom.serialNumber ?? "")) {
    found.push(
      `serialNumber is not a UUID URN: ${bom.serialNumber ?? "(none)"}`,
    );
  }

  const root = bom.metadata.component;
  if (root.name !== manifest.name || root.version !== manifest.version) {
    found.push(
      `the BOM describes ${componentKey(root)}, package.json says ${manifest.name}@${manifest.version}`,
    );
  }
  if (root.type !== "application") {
    found.push(`root component type is ${root.type}, not application`);
  }
  if (
    (bom.metadata.supplier?.name ?? "") === "" ||
    (bom.metadata.authors ?? []).length === 0
  ) {
    found.push("the BOM names no supplier or author");
  }

  const refs = new Set<string>();
  for (const component of [root, ...bom.components]) {
    const ref = component["bom-ref"] ?? "";
    if (ref === "") {
      found.push(`${componentKey(component)} has no bom-ref`);
      continue;
    }
    if (refs.has(ref) && component !== root) {
      found.push(`two components share the bom-ref ${ref}`);
    }
    refs.add(ref);
    if ((component.purl ?? "") === "") {
      found.push(`${componentKey(component)} has no purl`);
    }
    if ((component.version ?? "") === "") {
      found.push(`${component.name} is listed with no version`);
    }
  }

  // The graph, walked. A `dependsOn` naming nothing is not a parse error: the
  // scanner simply reports a smaller tree than the one that was shipped.
  for (const node of bom.dependencies ?? []) {
    if (!refs.has(node.ref)) {
      found.push(`the dependency graph has a node for unknown ${node.ref}`);
    }
    for (const on of node.dependsOn ?? []) {
      if (!refs.has(on)) {
        found.push(`${node.ref} depends on ${on}, which the BOM does not list`);
      }
    }
  }

  const facts = lockfileFacts();
  for (const component of bom.components) {
    if ((component.licenses ?? []).length > 0) {
      continue;
    }
    const key = componentKey(component);
    if (!mayBeAbsent(facts, key)) {
      found.push(
        `${key} has no licence, and the lockfile does not mark it optional or platform-specific`,
      );
    } else if (options.strict) {
      found.push(`${key} has no licence`);
    }
  }

  return found;
}

/** Every platform value the lockfile names that `ARCHITECTURES` does not. */
export function uncoveredPlatforms(): string[] {
  const { platforms } = lockfileFacts();
  const missing: string[] = [];
  for (const key of ["os", "cpu", "libc"] as const) {
    for (const value of [...platforms[key]].sort()) {
      if (!ARCHITECTURES[key].includes(value)) {
        missing.push(`${key}: ${value}`);
      }
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ */

function main(): void {
  const allPlatforms = process.argv.includes("--all-platforms");
  const check = process.argv.includes("--check");

  const uncovered = uncoveredPlatforms();
  if (uncovered.length > 0) {
    console.error(
      `pnpm-lock.yaml names platforms ARCHITECTURES in tools/sbom.ts does not:\n${uncovered
        .map((entry) => `  ${entry}`)
        .join(
          "\n",
        )}\n\nAdd them, or the BOM loses a licence for every binary built for one.`,
    );
    process.exit(1);
  }

  const bom = generate(allPlatforms);
  const found = problems(bom, { strict: allPlatforms });

  const missingLicences = bom.components.filter(
    (component) => (component.licenses ?? []).length === 0,
  ).length;
  console.log(
    `${String(bom.components.length)} components, ${String(bom.components.length - missingLicences)} with a licence, CycloneDX ${bom.specVersion}.`,
  );

  if (found.length > 0) {
    console.error(
      `\nThe BOM is not one this project would hand to anybody:\n${found
        .map((problem) => `  ${problem}`)
        .join("\n")}`,
    );
    process.exit(1);
  }

  if (check) {
    console.log("No problems.");
    return;
  }

  const out = join(ROOT, "dist/sbom");
  mkdirSync(out, { recursive: true });
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { name: string; version: string };
  // `.cdx.json` is the extension CycloneDX's own tooling recognises.
  const file = join(out, `${manifest.name}-${manifest.version}.cdx.json`);
  sortBom(bom);
  writeFileSync(file, `${JSON.stringify(bom, null, 2)}\n`, "utf8");
  console.log(`Wrote ${file.slice(ROOT.length + 1)}.`);

  if (!allPlatforms) {
    console.log(
      `\n${String(missingLicences)} components carry no licence, because they are prebuilt\nbinaries for platforms this machine does not install. Use --all-platforms\nfor the BOM that goes to anybody else.`,
    );
  }
}

if (process.argv[1]?.endsWith("sbom.ts")) {
  main();
}
