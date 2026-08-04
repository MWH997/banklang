import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  // Relative base so the built bundle can be served from any path, including a
  // sub-route of a portfolio site.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    fs: {
      // The playground imports compiler sources and example programs from
      // outside its own package directory.
      allow: [repoRoot],
    },
  },
});
