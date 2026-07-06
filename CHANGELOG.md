# Changelog

## Unreleased

### Added

- Added `bankc verify <project>` to write a deterministic verification report alongside the emitted COBOL, copybooks, source map, and JCL.
- Added `bankc test <project>` to run the verification flow and record the local GnuCOBOL validation report under `dist/audit/gnucobol-validation.md`.
- Added `bankc emit jcl <project>` to emit a readable JCL skeleton for the generated COBOL artifact.
- Added `bankc copybook inspect --json` / `types --json` / `diff --json` output for the generated copybook subset.
- Added `examples/batch-interest-accrual` as a second BankTS example that exercises deterministic `if` / `else` control flow.
- Added a control-flow expansion through the parser, typechecker, IR, and COBOL backend for the narrow `if` / `else` subset used by the second example.
- Added verification and GnuCOBOL evidence to the account-transfer bundle, including `dist/jcl/ACCOUNT-TRANSFER.jcl`, `dist/audit/verification-report.md`, and `dist/audit/gnucobol-validation.md`.
- Added `bankc layout <project>` to emit a deterministic copybook layout report in `dist/layout/copybook-layout.md` and `dist/layout/copybook-layout.json`, and wired the audit bundle to include `dist/audit/copybook-layout.md`.
- Added `bankc copybook types <file>` for the generated copybook subset, with a field type summary and CLI/unit coverage against `TRANSFER-REQUEST.cpy`.
- Added `bankc copybook diff <left> <right>` for the generated copybook subset, with identical/different exit handling and layout comparison tests for generated copybooks.
- Added `bankc copybook inspect <file>` for the generated copybook subset, with layout recovery tests and CLI coverage for the emitted `TRANSFER-REQUEST.cpy`.
- Added a real `bankc build` command that emits COBOL, copybooks, source maps, and audit evidence for the account-transfer example, including the layout report and validation matrix.
- Added a local `pnpm test:gnucobol` smoke-validation lane that emits a GnuCOBOL report under `dist/audit/gnucobol-validation.md`, captures artifact hashes, records the known backend gaps, and compiles the generated COBOL with `cobc`.
- Added deterministic copybook emission for the account-transfer record, with a golden copybook fixture, numeric byte-length tests, and a dedicated AI review trail/tester note.
- Added a a model capacity-probe design stub, two ADRs, and README/prompts updates to surface the research baseline, validation ladder, and evidence folders.
- Updated the account-transfer example documentation and quick start to mention the emitted copybook artifact.
- Added an `evidence/account-transfer/` bundle that captures the source, generated COBOL, generated copybook, source map, audit artifacts, validation matrix, and tester-note links.
- Added README linkage to the `evidence/account-transfer/` bundle.
- Added the initial BankLang TypeScript repository scaffold, including the account-transfer example, shared AST/typechecker/IR/backend packages, deterministic `bankc` CLI shell, source-map emission, audit-report generation, tests, and governance docs.
- Added `.env.example`, `.gitignore`, expanded `RUN-ASSISTANT-NOW.md` into a 24-hour execution plan, and added Phase 1B tickets for decimal metadata, COMP-3 mapping, copybook generation, audit artifacts, and evidence bundle.
- Final preflight pass: added `RUN-ASSISTANT-NOW.md`, final preflight checklist, quota-aware model routing, a model specialist policy/prompt, final plan audit, and corrected stale a model-as-workhorse wording.
- Integrated a model 4 as the high-volume free API workhorse, reclassified a model 2.5 Flash free tier as scarce specialist, added a model prompt template, and updated AI orchestration/risk/definitions/research docs.
- Added multi-AI orchestration layer: the assistant supervisor, a model targeted workhorse validation, local a model review, feature Q/A review loops, AI review templates, risk updates, and a model rate-limit/privacy nuance.
- Added curated research baseline: research dossier, source-of-truth matrix, IBM/GnuCOBOL backend profiles, numeric semantics, copybook, Db2, CICS, DBB, ZUnit, LSP/editor, z/OS Connect, open testing ecosystem, research context, benchmark corpus plan, and Phase 0C tickets.
- Added IBM-facing seriousness layer: strategic positioning, technical moat, enterprise readiness levels, validation lab plan, benchmark/evidence plan, demo strategy, IBM engagement strategy, IBM-facing roadmap, research/funding proposal, Medium article brief, IBM email brief, risk register, and Phase 0B tickets.
- Added `definitions.md` as the canonical glossary requirement, with detailed term definitions and reference links for compiler, COBOL, mainframe, testing, governance, and security terminology.
- Added initial planning pack for BankLang, including product specification, execution plan, architecture, language specification, COBOL backend specification, banking safety specification, verification specification, migration tooling, roadmap, agent rules, phase tickets, and the assistant warm-up prompt.
- Added repository conventions for private GitHub setup through `gh`, commit discipline, changelog policy, feature scrutiny, web documentation verification, compiler validation, layered testing, and tester notes.

### Changed

- Hardened the audit bundle and verification flow so build/verify/test output includes JCL, verification evidence, and the generated-artifacts list for the current compiler slice.
- Updated the account-transfer example and evidence bundle to surface the new JCL and verification artifacts.
- Updated the repository formatter ignore list to exclude scratch `tmp/` outputs and generated `.jcl` files.
- Enabled pnpm workspace build approval for `esbuild` so Docker-based install/verification can complete without the interactive purge gate.

### Fixed

- Fixed `bankc layout <project>` so it writes the JSON layout report as well as the markdown report.
- Fixed the command help text and CLI routing so the new commands are discoverable and executable.

### Security

### Testing

- Verified the new command surface with `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm bankc build examples/account-transfer`, `pnpm bankc verify examples/account-transfer`, `pnpm bankc test examples/account-transfer`, and `pnpm test:gnucobol` in Docker.
- Added tests for the second BankTS example, JCL emission, verification output, copybook JSON output, and the expanded CLI surface.
- Verified the current compiler slice with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the `bankc` help/doctor/check/build/layout/emit cobol/emit copybooks/audit-report commands in Docker.
- Verified copybook emission with `pnpm bankc emit copybooks examples/account-transfer` in Docker and added golden coverage for `TRANSFER-REQUEST.cpy`.
- Verified the local GnuCOBOL smoke lane with `pnpm test:gnucobol` and a direct `cobc` compile of the generated COBOL.
- Verified a model API access with a minimal `generateContent` request and confirmed a model availability with `a model --version`, `a model list`, and the local HTTP tags endpoint.

### Documentation

- Expanded `examples/account-transfer/README.md`, `examples/account-transfer/expected/README.md`, and `evidence/account-transfer/README.md` to reflect the new JCL, verification, and GnuCOBOL artifacts.
- Added a second example README and a command-surface feature proposal/tester-note trail.
- Expanded `README.md` with the current command inventory, generated artifact map, evidence directories, validation commands, and AI review workflow.
- Expanded the README scope/status language to reflect the current account-transfer slice and the local validation path.
- Added a concrete BankTS example to `README.md` and defined BankTS inline so the repository entry point is self-contained.

### Documentation

### Internal

- Added an `allowBuilds` entry for `esbuild` in `pnpm-workspace.yaml` so Docker-based pnpm verification can proceed non-interactively.
- Added a feature proposal and AI review trail for the command-surface and control-flow expansion work.
