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

/**
 * `?raw` imports, which is how the reference runtime reaches the browser.
 *
 * The playground runs the same `runtime/*.cbl` files CI compiles and links, so
 * they are bundled as text rather than reimplemented in JavaScript. A
 * JavaScript ledger would be less work and would mean that what runs here and
 * what runs in CI are two different programs.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
