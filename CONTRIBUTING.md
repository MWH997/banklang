# Contributing

BankLang contributions should be small, deterministic, and reviewable.

## Before changing code

Read:

- `spec.md`
- `architecture.md`
- `language-spec.md`
- `cobol-backend-spec.md`
- `verification-spec.md`
- `repo-conventions.md`

## Workflow

1. Make the smallest coherent change.
2. Add or update tests.
3. Update `CHANGELOG.md` when the change is meaningful.
4. Add tester notes for compiler, generated-output, or safety changes.
5. Run the repository checks.

## Toolchain

Use Node.js 24 or newer. Node 24 is the supported runtime for local
development, CI, and Docker-based verification. Use pnpm 11.7.0 as pinned by
the `packageManager` field.

```bash
node --version # must be v24 or newer
```

## Local checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm bankc check examples/account-transfer
pnpm bankc emit cobol examples/account-transfer
```

## Rules

- Do not weaken type checks to make examples pass.
- Do not use AI output as compiler truth.
- Do not silently update golden outputs.
- Do not commit secrets.
