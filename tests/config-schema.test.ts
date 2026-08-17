import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  BACKEND_PROFILES,
  CONFIG_FILE_NAME,
  COPYBOOK_MODES,
  DECIMAL_POINTS,
  DEFAULT_CONFIG,
  loadConfig,
  renderDefaultConfig,
  SCHEMA_URL,
} from "../packages/config/src/index";
import { configJsonSchema } from "../packages/config/src/schema";
import { SITE_ORIGIN } from "../tools/build-site";

/**
 * The schema `bankc init` points every generated config at.
 *
 * It used to name `banklang.dev`, a domain this project does not own and has
 * never published to, so an editor following the `$schema` line got a 404
 * from the first file a new user ever sees. The URL now names this project's
 * own site and `pnpm build:site` writes the document there.
 *
 * What these check is the part that can rot quietly: a schema is a second
 * statement of rules the loader already enforces, and the failure mode is not
 * that it breaks but that it starts describing a compiler that no longer
 * exists. Every enum below is compared against the loader's own constants, and
 * each value is put through `loadConfig` to confirm it is really accepted.
 */

interface JsonSchema {
  $id: string;
  additionalProperties: boolean;
  properties: Record<string, { enum?: unknown[]; default?: unknown }>;
}

const schema = configJsonSchema() as JsonSchema;

const dirs: string[] = [];

function projectWith(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "banklang-schema-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, CONFIG_FILE_NAME),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the published banklang.json schema", () => {
  it("is identified by the URL bankc init writes into a project", () => {
    expect(schema.$id).toBe(SCHEMA_URL);
    expect(JSON.parse(renderDefaultConfig())).toMatchObject({
      $schema: SCHEMA_URL,
    });
  });

  it("is served from this project's own domain, not a namespace it does not own", () => {
    // The defect this replaced: `banklang.dev` is not ours, so `bankc init`
    // wrote a config pointing every editor at somebody else's namespace.
    expect(new URL(SCHEMA_URL).origin).toBe(SITE_ORIGIN);
  });

  it("names a field for everything the default config sets, and no more", () => {
    const documented = Object.keys(schema.properties).filter(
      (key) => key !== "$schema",
    );
    expect(documented.sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort());
  });

  it("offers each field's default as the loader's own default", () => {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      expect(schema.properties[key]?.default).toEqual(value);
    }
  });

  it("rejects unknown keys, as the loader does", () => {
    expect(schema.additionalProperties).toBe(false);
    const { problems } = loadConfig(
      projectWith({ notAField: true }),
      process.cwd(),
    );
    expect(problems.join("\n")).toMatch(/notAField/);
  });
});

describe("every value the schema offers", () => {
  const cases: [string, readonly string[]][] = [
    ["backendProfile", BACKEND_PROFILES],
    ["copybookMode", COPYBOOK_MODES],
    ["decimalPoint", DECIMAL_POINTS],
  ];

  for (const [field, accepted] of cases) {
    it(`lists exactly the ${field} values the loader takes`, () => {
      expect(schema.properties[field]?.enum).toEqual([...accepted]);
    });

    it(`is accepted by the loader for ${field}`, () => {
      for (const value of accepted) {
        const { config, problems } = loadConfig(
          projectWith({ [field]: value }),
          process.cwd(),
        );
        expect(problems, `${field}: ${value}`).toEqual([]);
        expect(config[field as keyof typeof config]).toBe(value);
      }
    });

    it(`is the complete set, so a value outside it is refused for ${field}`, () => {
      const { problems } = loadConfig(
        projectWith({ [field]: "not-a-real-value" }),
        process.cwd(),
      );
      expect(problems.join("\n")).toMatch(new RegExp(`"${field}"`));
    });
  }
});
