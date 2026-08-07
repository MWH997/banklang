import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  ARCHITECTURES,
  SPEC_VERSION,
  architecturesBlock,
  componentKey,
  declaredLicence,
  generate,
  lockfileFacts,
  mayBeAbsent,
  problems,
  repairLicences,
  supplier,
  uncoveredPlatforms,
  type Bom,
} from "../tools/sbom";

/**
 * The Software Bill of Materials, held to being one.
 *
 * R2. A BOM is read by a machine in somebody else's security function, months
 * after anybody here looked at it, and every way it can be wrong is quiet: a
 * dangling edge makes a scanner report a smaller tree rather than an error, a
 * missing licence becomes a review ticket, a drifted specification version
 * becomes "unsupported format" with no indication of which field moved.
 *
 * Nothing here asserts a literal that the generator also produces. What is
 * checked is either an invariant of the format or a comparison against the file
 * the BOM duplicates — `package.json`, `pnpm-lock.yaml`, `CITATION.cff`.
 */

let bom: Bom;

beforeAll(() => {
  // This platform only. Every assertion below is one that holds whatever is in
  // the pnpm store — the store-dependent half is `strict`, and that is the CI
  // job's business because only a resolved matrix can satisfy it.
  bom = generate(false);
}, 120_000);

describe("the bill of materials this project hands out", () => {
  it("is the CycloneDX version Ecma ratified, and says so", () => {
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe(SPEC_VERSION);
    // 1.7 is ECMA-424 2nd edition. Pinned in the tool rather than left to
    // pnpm's default, which moves.
    expect(SPEC_VERSION).toBe("1.7");
  });

  it("describes this package, at the version everything else names", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      version: string;
      description: string;
    };
    expect(bom.metadata.component.name).toBe(manifest.name);
    expect(bom.metadata.component.version).toBe(manifest.version);
    expect(bom.metadata.component.description).toBe(manifest.description);
  });

  it("is an application rather than a library", () => {
    // A compiler and its toolchain. A scanner that reports on applications
    // separately would otherwise not see this one.
    expect(bom.metadata.component.type).toBe("application");
  });

  it("carries a serial number in the form a consumer keys on", () => {
    expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });

  it("names the author as its supplier", () => {
    expect(bom.metadata.supplier?.name).toBe(supplier());
    expect(supplier()).toBe("Md Wahid Hassan");
  });

  /**
   * pnpm presents the workspace as one application carrying the union of every
   * project's dependencies, rather than as a component per package. That is a
   * reasonable model — there is one thing here to deploy — but it means a
   * workspace project pnpm failed to read would drop out of the BOM without
   * changing its shape. So the union is checked against the manifests.
   */
  it("lists every dependency any workspace package declares", () => {
    const declared = new Set<string>();
    const read = (path: string): void => {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of ["dependencies", "devDependencies"]) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          declared.add(name);
        }
      }
    };

    read("package.json");
    for (const entry of readdirSync("packages")) {
      const manifest = join("packages", entry, "package.json");
      if (existsSync(manifest)) {
        read(manifest);
      }
    }

    const listed = new Set(
      bom.components.map((component) =>
        component.group !== undefined && component.group !== ""
          ? `${component.group}/${component.name}`
          : component.name,
      ),
    );
    const missing = [...declared].filter(
      // Workspace projects link to each other; they are not fetched, and pnpm
      // does not list them as components of the application they make up.
      (name) => !name.startsWith("@banklang/") && !listed.has(name),
    );

    expect(declared.size).toBeGreaterThan(15);
    expect(missing, `declared but absent from the BOM`).toEqual([]);
  });

  it("has no edge naming a component it does not list", () => {
    expect(problems(bom, { strict: false })).toEqual([]);
    expect(bom.dependencies?.length ?? 0).toBeGreaterThan(
      bom.components.length,
    );
  });
});

describe("the licence column, which is why the command is wrapped", () => {
  it("names a licence for everything that is installed here", () => {
    const facts = lockfileFacts();
    const unlicensed = bom.components
      .filter((component) => (component.licenses ?? []).length === 0)
      .map(componentKey)
      .filter((key) => !mayBeAbsent(facts, key));
    expect(unlicensed).toEqual([]);
  });

  /**
   * The other reason a package is not on disk.
   *
   * CI found this on 2026-08-07: `@napi-rs/wasm-runtime` and the `@emnapi/*`
   * packages beneath it are the WebAssembly fallback for the native bundlers.
   * They carry no `os` and no `cpu` — they run anywhere — but they are optional,
   * so a machine whose native binary resolved never downloads them. Five of them
   * reached the BOM with no licence and the platform rule did not excuse them,
   * on Linux, where every developer here had been running macOS.
   */
  it("treats an optional package as one that may be absent", () => {
    const facts = lockfileFacts();
    expect(facts.optional.size).toBeGreaterThan(50);
    expect(facts.optional.has("@emnapi/core@1.11.1")).toBe(true);
    expect(mayBeAbsent(facts, "@emnapi/core@1.11.1")).toBe(true);

    // Not a blanket excuse: a package that is neither optional nor
    // platform-specific still has to carry one.
    expect(facts.optional.has("typescript@5.9.3")).toBe(false);
    expect(mayBeAbsent(facts, "typescript@5.9.3")).toBe(false);
  });

  /**
   * The alternative was a list of name prefixes — `@esbuild/`, `@rolldown/`,
   * `lightningcss-` — which goes stale the first time a dependency ships a
   * native binary under a name nobody predicted, and goes stale silently:
   * the BOM keeps generating, with one more component of unknown licence.
   */
  it("takes the prebuilt binaries from the lockfile, not from their names", () => {
    const { platformConstrained } = lockfileFacts();
    expect(platformConstrained.size).toBeGreaterThan(50);

    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    for (const key of platformConstrained) {
      expect(lockfile).toContain(key);
    }
    // A package with no `os`/`cpu`/`libc` in the lockfile is not one of them,
    // however much it looks like a build tool.
    expect(platformConstrained.has("markdown-it@15.0.0")).toBe(false);
    expect(platformConstrained.has("typescript@5.9.3")).toBe(false);
  });

  /**
   * The check that keeps CI's zero-gap number honest.
   *
   * `--all-platforms` closes the gap by resolving the matrix in
   * `ARCHITECTURES`. A dependency introducing a binary for a platform outside
   * that matrix would reintroduce the gap, and the BOM would look exactly as
   * complete as before.
   */
  it("resolves every platform the lockfile names", () => {
    expect(uncoveredPlatforms()).toEqual([]);
  });

  /**
   * The licences pnpm drops, and why they are the ones that matter.
   *
   * pnpm writes `licenses[].license.id`, which CycloneDX defines as an SPDX
   * identifier, and drops anything that is not one instead of writing it to
   * `license.name`. Every component in this tree that is *not* open source
   * declares `SEE LICENSE IN LICENSE.txt` — so before `repairLicences`, the ten
   * proprietary components were exactly the ten the BOM said nothing about.
   */
  it("carries a licence for every package on disk that declares one", () => {
    const missing = bom.components
      .filter((component) => (component.licenses ?? []).length === 0)
      .filter(
        (component) =>
          declaredLicence(process.cwd(), componentKey(component)) !== undefined,
      )
      .map(componentKey);
    expect(
      missing,
      "on disk, declaring a licence, absent from the BOM",
    ).toEqual([]);
  });

  it("records a proprietary licence as such, not as unknown", () => {
    // The ten `@vscode/vsce-sign` packages are the only components here that
    // are not open source, and were the only ten pnpm emitted with no licence
    // at all. Whichever of them this platform installs must say so.
    const proprietary = bom.components.filter(
      (component) =>
        componentKey(component).startsWith("@vscode/vsce-sign") &&
        (component.licenses ?? []).length > 0,
    );
    expect(proprietary.length).toBeGreaterThan(0);

    for (const component of proprietary) {
      const licences = component.licenses as {
        license?: { id?: string; name?: string };
      }[];
      expect(
        licences[0]?.license?.name ?? "",
        `${componentKey(component)} is in the BOM without its licence text`,
      ).toContain("SEE LICENSE IN");
    }
  });

  it("reads that licence out of the package, and invents nothing", () => {
    expect(declaredLicence(process.cwd(), "@vscode/vsce-sign@2.0.9")).toBe(
      "SEE LICENSE IN LICENSE.txt",
    );
    expect(declaredLicence(process.cwd(), "typescript@5.9.3")).toBe(
      "Apache-2.0",
    );
    // Not installed, not on disk, therefore not asserted about.
    expect(declaredLicence(process.cwd(), "left-pad@1.3.0")).toBeUndefined();
  });

  it("repairs nothing when there is nothing on disk to read", () => {
    const invented: Bom = {
      ...structuredClone(bom),
      components: [
        { type: "library", name: "left-pad", version: "1.3.0" },
        { type: "library", name: "not-a-package", version: "9.9.9" },
      ],
    };
    expect(repairLicences(invented, process.cwd())).toBe(0);
    expect(invented.components[0]?.licenses).toBeUndefined();
  });

  it("writes those platforms in the block pnpm reads", () => {
    const block = architecturesBlock();
    expect(block).toContain("supportedArchitectures:");
    for (const key of ["os", "cpu", "libc"] as const) {
      expect(block).toContain(`  ${key}:`);
      for (const value of ARCHITECTURES[key]) {
        expect(block).toContain(`    - ${value}`);
      }
    }
  });
});

/**
 * The other half: that the checks above fail when they should.
 *
 * Each of these is a BOM that parses, validates as JSON, and is wrong in a way
 * a consumer discovers late. If `problems()` returns nothing for one of them,
 * every green run above meant nothing.
 */
describe("what problems() catches", () => {
  const damaged = (change: (copy: Bom) => void): string[] => {
    const copy = structuredClone(bom);
    change(copy);
    return problems(copy, { strict: false });
  };

  it("a specification version that drifted", () => {
    expect(damaged((copy) => (copy.specVersion = "1.6"))).toContainEqual(
      expect.stringContaining("specVersion"),
    );
  });

  it("a serial number that is not a URN", () => {
    expect(
      damaged((copy) => (copy.serialNumber = "45d791ec-de25-4773-8f5b-9d28")),
    ).toContainEqual(expect.stringContaining("serialNumber"));
  });

  it("a root component describing some other package", () => {
    expect(
      damaged((copy) => (copy.metadata.component.version = "0.8.0")),
    ).toContainEqual(expect.stringContaining("package.json says"));
  });

  it("a root component demoted to a library", () => {
    expect(
      damaged((copy) => (copy.metadata.component.type = "library")),
    ).toContainEqual(expect.stringContaining("not application"));
  });

  it("a BOM with no supplier", () => {
    expect(damaged((copy) => delete copy.metadata.supplier)).toContainEqual(
      expect.stringContaining("no supplier"),
    );
  });

  it("an edge naming a component the BOM does not list", () => {
    expect(
      damaged((copy) => {
        copy.dependencies?.[0]?.dependsOn?.push("pkg:npm/left-pad@1.3.0");
      }),
    ).toContainEqual(expect.stringContaining("which the BOM does not list"));
  });

  it("two components sharing a bom-ref", () => {
    expect(
      damaged((copy) => {
        const first = copy.components[0];
        const second = copy.components[1];
        if (first && second) {
          second["bom-ref"] = first["bom-ref"];
        }
      }),
    ).toContainEqual(expect.stringContaining("share the bom-ref"));
  });

  it("a component with no purl", () => {
    expect(
      damaged((copy) => {
        delete copy.components[0]?.purl;
      }),
    ).toContainEqual(expect.stringContaining("no purl"));
  });

  it("a real dependency with no licence, even outside strict mode", () => {
    const found = damaged((copy) => {
      const real = copy.components.find(
        (component) => componentKey(component) === "typescript@5.9.3",
      );
      if (real) {
        delete real.licenses;
      }
    });
    expect(found).toContainEqual(
      expect.stringContaining("does not mark it optional or platform-specific"),
    );
  });

  /**
   * The cold-store BOM, reconstructed.
   *
   * On a machine whose pnpm store holds only this platform, 79 of the 392
   * components come out with no licence and all 79 are prebuilt binaries. That
   * is the state every check above has to tolerate, and it is a state this
   * machine cannot reach once `--all-platforms` has run here even once, because
   * the store is global. So it is built rather than waited for: strip the
   * licence from every component the lockfile marks platform-constrained.
   *
   * It also exercises the mapping from a CycloneDX `group`/`name`/`version`
   * back to a lockfile key across all of them at once. One name that does not
   * round-trip and the whole tolerance collapses into 79 spurious problems on
   * anybody else's first checkout.
   */
  it("a whole cold store's worth of them, but only in strict mode", () => {
    const copy = structuredClone(bom);
    const facts = lockfileFacts();

    let stripped = 0;
    for (const component of copy.components) {
      if (mayBeAbsent(facts, componentKey(component))) {
        delete component.licenses;
        stripped += 1;
      }
    }
    expect(stripped).toBeGreaterThan(50);

    expect(problems(copy, { strict: false })).toEqual([]);
    expect(problems(copy, { strict: true })).toHaveLength(stripped);
  });
});

/**
 * The supply-chain policy, held to being configured rather than described.
 *
 * Found by the pre-publication audit on 2026-08-07. Three files — this
 * workspace's own manifest, the scheduled advisory job, and `tools/sbom.ts` —
 * described a `minimumReleaseAge` policy the repository held, and the
 * repository held a comment about one. `pnpm config get minimumReleaseAge`
 * answered `undefined`.
 *
 * The protection was real, because pnpm 11 turns it on at 1440 minutes by
 * itself. That is the part worth stating precisely: a default is a control
 * somebody else owns. A pnpm release that lowers it, or a contributor on the
 * version before the setting existed, gets none of it — and every document here
 * would go on saying the policy was in force.
 */
describe("the release-age policy the documentation describes", () => {
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");

  it("is a setting, not a comment about one", () => {
    const configured = /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(workspace);
    expect(
      configured,
      "pnpm-workspace.yaml describes minimumReleaseAge without setting it",
    ).not.toBeNull();
    expect(Number(configured?.[1])).toBeGreaterThanOrEqual(1440);
  });

  it("is what pnpm actually resolves with", () => {
    // Read back through pnpm rather than from the file: the question is what
    // the package manager applies, which is what the comment claims.
    const applied = execSync("pnpm config get minimumReleaseAge", {
      encoding: "utf8",
    }).trim();
    expect(applied).not.toBe("undefined");
    expect(Number(applied)).toBeGreaterThanOrEqual(1440);
  });

  it("takes no blanket exemption, which is what it exists to prevent", () => {
    // pnpm offers `minimumReleaseAgeExclude` for the one package the policy
    // just stopped, which is the opposite of what the policy is for.
    expect(workspace).not.toMatch(/^minimumReleaseAgeExclude:/m);
    expect(workspace).not.toMatch(/^minimumReleaseAge:\s*0\s*$/m);
  });
});
