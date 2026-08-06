import {
  BACKEND_PROFILES,
  COPYBOOK_MODES,
  DECIMAL_POINTS,
  DEFAULT_CONFIG,
  SCHEMA_URL,
} from "./index";

/**
 * The JSON Schema for `banklang.json`, built from what the loader accepts.
 *
 * `bankc init` writes a `$schema` line into every generated config, so an
 * editor fetches this and offers completion and validation for a file most
 * people will otherwise fill in by guessing. That only works if the document is
 * actually served — the URL used to name a domain this project does not own,
 * where nothing has ever been published, so every generated config pointed an
 * editor at a 404.
 *
 * Derived from the same constants `loadConfig` validates against rather than
 * written out beside them. A hand-kept schema is a second statement of the
 * rules that drifts from the first one silently: the editor would go on
 * offering `gnucobol-local` after it was renamed, or reject a profile that had
 * just been added. Here a new backend profile appears in both at once, and
 * `tests/config-schema.test.ts` fails if this stops describing the loader.
 */
export function configJsonSchema(): unknown {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_URL,
    title: "BankLang project configuration",
    description:
      "Configuration for a BankLang project, read by bankc from banklang.json.",
    type: "object",
    // The loader reports an unknown key as a problem rather than ignoring it,
    // so the schema says the same thing instead of quietly permitting typos.
    additionalProperties: false,
    properties: {
      $schema: {
        type: "string",
        description: "URL of this schema, for editor completion.",
      },
      entry: {
        type: "string",
        description: "Entry source file, relative to the config file.",
        default: DEFAULT_CONFIG.entry,
      },
      outDir: {
        type: "string",
        description:
          "Output root for generated artifacts, relative to the config file.",
        default: DEFAULT_CONFIG.outDir,
      },
      backendProfile: {
        enum: [...BACKEND_PROFILES],
        description:
          "Which COBOL the backend targets. `ibm-enterprise-cobol-zos` is the target this compiler is written for; `gnucobol-local` is for validating locally.",
        default: DEFAULT_CONFIG.backendProfile,
      },
      formatCheck: {
        type: "boolean",
        description:
          "Fail the build when the formatter would change a source file.",
        default: DEFAULT_CONFIG.formatCheck,
      },
      copybookMode: {
        enum: [...COPYBOOK_MODES],
        description:
          "`inline` writes every record layout into the program; `copy` emits `COPY <NAME>.` and generates the copybook library instead.",
        default: DEFAULT_CONFIG.copybookMode,
      },
      decimalPoint: {
        enum: [...DECIMAL_POINTS],
        description:
          "`comma` emits `DECIMAL-POINT IS COMMA`, swapping the roles of the comma and the point in every picture and literal.",
        default: DEFAULT_CONFIG.decimalPoint,
      },
      currencySign: {
        type: "string",
        minLength: 1,
        maxLength: 1,
        description:
          "The character an edited picture's currency position prints. One character, and not one a picture clause already means something by.",
        default: DEFAULT_CONFIG.currencySign,
      },
      runtimeOptions: {
        type: "array",
        items: { type: "string" },
        description:
          "Language Environment run-time options, written into the job's CEEOPTS DD, one card per entry.",
        default: [...DEFAULT_CONFIG.runtimeOptions],
      },
    },
  };
}
