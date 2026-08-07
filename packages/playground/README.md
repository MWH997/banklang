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
pnpm playground:budget    # what the bundle weighs, against what it may
```

## What it may weigh

The bundle is a compiler, so it is large: about 222 kB compressed in the first
download, and about 36 kB more when **Run** is first opened.
`tools/bundle-budget.ts` holds the ceiling, and `pnpm build:site` runs it — over
budget stops the build rather than printing a warning past it, which is what
Vite's own "(!) Some chunks are larger than 500 kB" had been doing on every
build for as long as there has been a playground.

Three numbers: the compressed first load, the uncompressed first load, and the
compressed total. The third is what stops a code-splitting change from moving
bytes out of the first download while adding more of them overall. A build well
under budget prints the number to lower it to, so a real reduction gets kept.

**What is not in the first download.** `src/run.ts` is behind a dynamic
`import()`, so the interpreter, the precompiler and the eight `runtime/*.cbl`
programs arrive when somebody asks for a run rather than when the page loads. A
reader who comes for the generated COBOL and leaves never fetches them. The
COBOL CodeMirror mode stays in the first load on purpose: **COBOL** is the tab
the page opens on, so splitting it would buy a second request rather than fewer
bytes.

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
- **Running it.** The Run tab interprets the generated COBOL against the same
  `runtime/*.cbl` reference programs CI compiles and links, so what it shows is
  the postings `BANKLEDG` made, the events `BANKAUDT` recorded, and the return
  code a job step would read. The interpreter is `@banklang/cobol-runtime`, and
  `tests/cobol-runtime-differential.test.ts` runs every example both through it
  and through GnuCOBOL and fails on any disagreement. It is not GnuCOBOL and it
  is not IBM Enterprise COBOL.

  **What it is run on** comes from the **Input** tab beside it: the entry
  record a caller would have filled, the dataset a job step would have
  allocated, the PARM on the EXEC card, or the rows Db2 answers a cursor with.
  Records are built at the offsets the compiler's own layout report gives, in
  the encoding it gives — packed decimal included — and the PARM from
  `batchParmFields`, which is the list the emitter generates the parsing code
  from, so what the program reads in the browser is what it would read on z/OS. A program with none of those says so, and says
  which of four situations it is in, rather than showing a ledger of zeroes and
  leaving the reader to work out why.

  Nothing here is offered that the program does not act on:
  `tests/playground-inputs.test.ts` withholds each surface in turn and fails if
  the run comes out the same, with no exemptions.
  `tests/cobol-runtime-differential.test.ts` passes the same PARM and the same
  cursor script to GnuCOBOL as to the interpreter, because two runtimes that
  both refuse the input agree perfectly and check nothing.

  A cursor is offered the same way a dataset is: the fields its `INTO` names,
  and a row per record. `runtime/DSNHLI.cbl` writes those rows into the host
  variables the generated `FETCH` passes it, so `branch-accrual-cursor` accrues
  interest on accounts rather than reading empty ones — and when the rows run
  out the cursor gets end of data, which is how its loop finishes instead of
  running to its declared bound. It is still a stub: it parses no SQL and binds
  no plan, and [`docs/divergences.md`](../../docs/divergences.md) says what that
  does and does not establish.

- **Formatting.** The Format button is the compiler's own formatter, so it
  produces byte for byte what `pnpm bankc fmt` writes on the command line.
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
| `src/inputs.ts`          | What a program can be given, and the records it becomes |
| `src/run.ts`             | Precompiling and executing what the compiler emitted    |
| `src/examples.ts`        | Pulls example programs from `examples/` at build time   |
| `src/bankts-language.ts` | CodeMirror tokenizer mirroring the real lexer's classes |
| `src/styles.css`         | Light and dark themes                                   |

Because examples are imported from `examples/` rather than duplicated, the
playground always shows the same programs the test suite and evidence bundles
use.
