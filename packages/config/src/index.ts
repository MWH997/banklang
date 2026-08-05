import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const CONFIG_FILE_NAME = "banklang.json";

export type BackendProfile = "ibm-enterprise-cobol-zos" | "gnucobol-local";

export interface BankLangConfig {
  /** Entry source file, relative to the config file. */
  entry: string;
  /** Output root for generated artifacts, relative to the config file. */
  outDir: string;
  backendProfile: BackendProfile;
  /** Fail the build when the formatter would change a source file. */
  formatCheck: boolean;
  /**
   * Whether record layouts are written into the program or copied into it.
   *
   * `inline` puts every `01` item in the program, which keeps the artifact
   * self-contained and reviewable on its own — the default, and what the
   * playground and the evidence bundles show.
   *
   * `copy` emits `COPY <NAME>.` instead, which is the shape a shop with a
   * shared copybook library expects: the copybook becomes the contract between
   * programs rather than a document that can drift from them. The generated JCL
   * then carries a SYSLIB for the copybook library, and local validation puts
   * the copybook directory on the compiler's search path.
   */
  copybookMode: CopybookMode;
  /**
   * `DECIMAL-POINT IS COMMA`.
   *
   * Much of Europe writes 1.234,56. The convention is program-wide in COBOL —
   * one `SPECIAL-NAMES` clause swaps the roles of the comma and the point in
   * every picture and every literal — so it belongs to the project rather than
   * to a field.
   */
  decimalPoint: "point" | "comma";
  /**
   * `CURRENCY SIGN IS "<c>"`, for what an edited picture's currency position
   * prints. Defaults to the dollar sign COBOL assumes.
   */
  currencySign: string;
}

export type CopybookMode = "inline" | "copy";

const COPYBOOK_MODES: CopybookMode[] = ["inline", "copy"];

/**
 * Characters a picture clause already means something by.
 *
 * A currency sign is one character, and it cannot be one of these: `E` is
 * exponent notation, `Z` is zero suppression, `V` the implied decimal point,
 * `S` the sign, and so on. Using one produces a program the COBOL compiler
 * rejects.
 */
const RESERVED_PICTURE_CHARACTERS = new Set([
  ..."0123456789",
  ..."ABCDENPRSVXZ",
  ...'*+-,.;()"/= ',
]);

export interface LoadedConfig {
  config: BankLangConfig;
  /** Absolute path to the config file, or null when defaults were used. */
  path: string | null;
  /** Directory that relative paths in the config resolve against. */
  root: string;
  /** Problems found while reading the config. Never thrown. */
  problems: string[];
}

export const DEFAULT_CONFIG: BankLangConfig = {
  entry: "src/main.bank.ts",
  outDir: "dist",
  backendProfile: "ibm-enterprise-cobol-zos",
  formatCheck: false,
  copybookMode: "inline",
  decimalPoint: "point",
  currencySign: "$",
};

const BACKEND_PROFILES: BackendProfile[] = [
  "ibm-enterprise-cobol-zos",
  "gnucobol-local",
];

/**
 * Loads `banklang.json` from a project directory, falling back to defaults.
 *
 * Unknown or malformed fields are reported as problems rather than thrown, so
 * a typo in a config file produces a clear diagnostic instead of a stack trace.
 */
export function loadConfig(projectPath: string, cwd: string): LoadedConfig {
  const root = isAbsolute(projectPath)
    ? projectPath
    : resolve(cwd, projectPath);
  const directory = root.endsWith(".bank.ts") ? dirname(root) : root;
  const path = join(directory, CONFIG_FILE_NAME);

  if (!existsSync(path)) {
    return {
      config: { ...DEFAULT_CONFIG },
      path: null,
      root: directory,
      problems: [],
    };
  }

  const problems: string[] = [];
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      config: { ...DEFAULT_CONFIG },
      path,
      root: directory,
      problems: [
        `${CONFIG_FILE_NAME} is not valid JSON: ${(error as Error).message}`,
      ],
    };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      config: { ...DEFAULT_CONFIG },
      path,
      root: directory,
      problems: [`${CONFIG_FILE_NAME} must contain a JSON object.`],
    };
  }

  const source = raw as Record<string, unknown>;
  const config = { ...DEFAULT_CONFIG };

  for (const key of Object.keys(source)) {
    if (!(key in DEFAULT_CONFIG) && key !== "$schema") {
      problems.push(
        `Unknown option "${key}". Supported: ${Object.keys(DEFAULT_CONFIG).join(", ")}.`,
      );
    }
  }

  if (source.entry !== undefined) {
    if (typeof source.entry === "string" && source.entry.length > 0) {
      config.entry = source.entry;
    } else {
      problems.push(`"entry" must be a non-empty string.`);
    }
  }

  if (source.outDir !== undefined) {
    if (typeof source.outDir === "string" && source.outDir.length > 0) {
      config.outDir = source.outDir;
    } else {
      problems.push(`"outDir" must be a non-empty string.`);
    }
  }

  if (source.copybookMode !== undefined) {
    if (
      typeof source.copybookMode === "string" &&
      (COPYBOOK_MODES as string[]).includes(source.copybookMode)
    ) {
      config.copybookMode = source.copybookMode as CopybookMode;
    } else {
      problems.push(
        `"copybookMode" must be one of: ${COPYBOOK_MODES.join(", ")}.`,
      );
    }
  }

  if (source.decimalPoint !== undefined) {
    if (source.decimalPoint === "point" || source.decimalPoint === "comma") {
      config.decimalPoint = source.decimalPoint;
    } else {
      problems.push(`"decimalPoint" must be "point" or "comma".`);
    }
  }

  if (source.currencySign !== undefined) {
    // COBOL's currency sign is a single character, and not one a picture
    // already uses for something else: `E` is exponent notation, `Z` is
    // suppression, `V` is the implied point. Emitting one of those produces a
    // program the compiler rejects, so it is caught here instead.
    if (
      typeof source.currencySign !== "string" ||
      source.currencySign.length !== 1 ||
      source.currencySign.codePointAt(0)! > 127
    ) {
      // A single byte, because that is what a picture position holds. `£` and
      // `€` are two or three bytes in UTF-8 and belong to a code page rather
      // than to the source.
      problems.push(`"currencySign" must be a single ASCII character.`);
    } else if (
      RESERVED_PICTURE_CHARACTERS.has(source.currencySign.toUpperCase())
    ) {
      problems.push(
        `"currencySign" cannot be ${source.currencySign}: a picture clause already uses that character.`,
      );
    } else {
      config.currencySign = source.currencySign;
    }
  }

  if (source.backendProfile !== undefined) {
    if (
      typeof source.backendProfile === "string" &&
      (BACKEND_PROFILES as string[]).includes(source.backendProfile)
    ) {
      config.backendProfile = source.backendProfile as BackendProfile;
    } else {
      problems.push(
        `"backendProfile" must be one of: ${BACKEND_PROFILES.join(", ")}.`,
      );
    }
  }

  if (source.formatCheck !== undefined) {
    if (typeof source.formatCheck === "boolean") {
      config.formatCheck = source.formatCheck;
    } else {
      problems.push(`"formatCheck" must be a boolean.`);
    }
  }

  return { config, path, root: directory, problems };
}

/** Resolves a config-relative path against the config root. */
export function resolveFromConfig(loaded: LoadedConfig, value: string): string {
  return isAbsolute(value) ? value : join(loaded.root, value);
}

export function renderDefaultConfig(): string {
  return `${JSON.stringify(
    {
      $schema: "https://banklang.dev/schema/banklang.json",
      ...DEFAULT_CONFIG,
    },
    null,
    2,
  )}\n`;
}
