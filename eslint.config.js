import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Static analysis, which this repository did without for too long.
 *
 * `pnpm lint` used to be `prettier --check`. TypeScript caught types, Prettier
 * caught whitespace, and the space between them was unwatched — which is where
 * a duplicate `case "RaiseStatement"` sat in the formatter until esbuild
 * happened to mention it while bundling the language server. TypeScript does
 * not flag a duplicate case: the exhaustiveness check over `never` is satisfied
 * by the first one.
 *
 * Type-checked rules rather than syntactic ones. The rules worth having here —
 * a floating promise, a condition that is always true, a comparison between
 * types that cannot be equal — all need the checker, and the project already
 * pays for a full typecheck.
 *
 * `recommendedTypeChecked` and not `stylisticTypeChecked`. The stylistic set
 * reported 108 findings across this repository and not one of them was a
 * defect: sixty-six preferences between `as T` and `!`, twenty-five between a
 * guard and an optional chain. Landing that would have buried the fourteen
 * findings that were real under a hundred that were taste, which is how a
 * linter comes to be ignored. A rule earns its place here by having caught
 * something.
 *
 * `eslint-config-prettier` goes last and turns off everything about layout.
 * Formatting is Prettier's and there is no argument to have.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".stryker-tmp*/**",
      "vendor-docs/**",
      "coverage/**",
      // Generated artifacts and inputs, which are not this project's source.
      "tests/fixtures/**",
      "tests/inputs/**",
      "evidence/**",
      "conversions/**",
      "zos/**",
      // BankTS, which happens to end in .ts and is not TypeScript.
      "examples/**",
      // The same, for the BankTS written against an external benchmark's
      // specification. `validation/tasks/**` holds one `main.bank.ts` per task
      // beside the `spec.json` it was written from.
      "validation/tasks/**",
      "packages/vscode-extension/server/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        // Named rather than discovered. There is no root `tsconfig.json` — the
        // compiler options live in `tsconfig.base.json`, which the typecheck
        // script passes explicitly — so the project service has nothing to find
        // by convention. The extension is excluded from that file and builds
        // under its own, so both are listed.
        project: [
          "./tsconfig.base.json",
          "./packages/vscode-extension/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // Three of the four the 2026-08-06 audit named, because each is a defect
      // this repository has actually shipped or come close to shipping.
      "no-duplicate-case": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        // An unused parameter named with a leading underscore is a signature
        // being honoured, not an oversight.
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      /*
       * The fourth. It spent one release off, and this is why it is back.
       *
       * On its first run it reported forty-two findings and not one was a
       * defect: thirty guarded an index access — `line[7]`, `match[1]`,
       * `MQ_STRUCTURE_LINES[name]`, `program.transactions[0]` — which
       * TypeScript typed as always present because `noUncheckedIndexedAccess`
       * was off. Acting on it would have deleted the guards that make those
       * safe. Turning the flag on made the types honest, at the cost of 366
       * errors across the compiler, and this rule is the payoff: what it says
       * now is true.
       */
      "@typescript-eslint/no-unnecessary-condition": "error",

      // A compiler reads untyped text off disk and narrows it. `unknown` and a
      // cast at the boundary is the pattern used throughout, and warning on
      // every one of them would train the reader to ignore the linter.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      // `interface` and `type` both appear in this codebase and the difference
      // carries no meaning here.
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },

  {
    // Tools are scripts. Writing to the console is what they are for.
    files: ["tools/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    // This file. No tsconfig covers it, so the rules that need the checker
    // cannot run over it.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    /*
     * Script that runs in a browser rather than in Node.
     *
     * `packages/site/src/docs.js` is served to a reader, so `document`,
     * `fetch` and `requestAnimationFrame` are defined and `process` is not.
     * Declared rather than switched off: the point of `no-undef` here is to
     * catch a Node global that would be `undefined` on the page.
     */
    files: ["packages/site/src/*.js"],
    languageOptions: {
      globals: {
        cancelAnimationFrame: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        location: "readonly",
        matchMedia: "readonly",
        requestAnimationFrame: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
  },

  prettier,
);
