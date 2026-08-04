# BankLang Playground

A browser playground that runs the **real compiler** — the same packages the CLI
uses — entirely client-side. There is no backend, no API, and no network call
during compilation.

This is possible because the compiler core has no Node dependencies. Only
`@banklang/bankc-cli` touches the file system; everything from the parser to the
COBOL backend is pure.

## Running it

```bash
pnpm playground:dev       # dev server with hot reload
pnpm playground:build     # static bundle in packages/playground/dist
pnpm playground:preview   # serve the built bundle locally
```

## What it demonstrates

- **Live compilation.** Every keystroke recompiles, typically in 1–3 ms.
- **A clickable source map.** Click any line in either pane and the
  corresponding lines in the other are highlighted, with the traced symbol shown
  underneath. This is the traceability claim made checkable rather than asserted.
- **Banking safety diagnostics.** The "Unsafe posting" example violates
  `BANK-TXN-001`, `BANK-AUD-001`, and `BANK-LED-001` on purpose. Each diagnostic
  expands to explain why the rule exists, pulled from the shared catalogue in
  `@banklang/diagnostics`.
- **Every generated artifact.** COBOL, copybooks, source map JSON, and the
  analysis bundle including copybook byte layout and JCL.
- **Shareable links.** The editor contents are encoded into the URL hash.

## Deploying

The build output is a static bundle in `dist/`, with a relative `base`, so it
can be served from any path — including a sub-route of a larger site.

For Cloudflare Pages or Workers static assets:

| Setting       | Value                                   |
| ------------- | --------------------------------------- |
| Build command | `pnpm install && pnpm playground:build` |
| Build output  | `packages/playground/dist`              |
| Node version  | `24`                                    |

No environment variables or bindings are required, because nothing runs
server-side.

## Layout

| File                     | Role                                                    |
| ------------------------ | ------------------------------------------------------- |
| `src/main.ts`            | Editor wiring, compile loop, source-map cross-linking   |
| `src/examples.ts`        | Pulls example programs from `examples/` at build time   |
| `src/bankts-language.ts` | CodeMirror tokenizer mirroring the real lexer's classes |
| `src/styles.css`         | Light and dark themes                                   |

Because examples are imported from `examples/` rather than duplicated, the
playground always shows the same programs the test suite and evidence bundles
use.
