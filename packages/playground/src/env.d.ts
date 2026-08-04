/**
 * Minimal ambient declarations for the bundler features the playground uses.
 *
 * Declared locally rather than pulling in `vite/client` so the repository-wide
 * typecheck does not depend on a package-level devDependency being hoisted to
 * the workspace root.
 */

interface ImportMetaGlobOptions {
  query?: string;
  import?: string;
  eager?: boolean;
}

interface ImportMeta {
  glob(
    pattern: string,
    options?: ImportMetaGlobOptions,
  ): Record<string, unknown>;
}

declare module "*.css";
