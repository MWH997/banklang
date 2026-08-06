## What changed

<!-- What this does, and why. -->

## Why

<!-- The problem being solved. Link an issue if one exists. -->

## Validation

- [ ] `pnpm lint` (eslint)
- [ ] `pnpm format:check` (prettier)
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm lint:conformance`
- [ ] `bankc test` passes for every example
- [ ] Generated COBOL compiles with `cobc` (or CI covers it)

## Generated output

- [ ] No generated output changed, **or** the change is explained below and the
      golden fixtures are updated deliberately.

<!-- If goldens changed, paste the diff and explain why it is correct. -->

## Checklist

- [ ] Tests cover the change
- [ ] `CHANGELOG.md` updated (unless typo- or formatting-only)
- [ ] Docs updated if behaviour changed
- [ ] New diagnostics are in `packages/diagnostics` and `docs/diagnostics.md`
- [ ] No IBM validation is claimed
