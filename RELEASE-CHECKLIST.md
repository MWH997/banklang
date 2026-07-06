# Release Checklist

Use this before cutting or publishing a release.

## 1. Tree and policy checks

- Ensure the worktree is clean or that every change is intentional.
- Confirm `.env` is ignored and never committed.
- Confirm `SECURITY.md` exists and still reflects the secret-handling policy.
- Confirm the repository does not make IBM validation claims without evidence.

## 2. Verification

Run the repository checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:gnucobol
pnpm bankc --help
pnpm bankc doctor
pnpm bankc check examples/account-transfer
pnpm bankc build examples/account-transfer --out /tmp/banklang-release-build
pnpm bankc layout examples/account-transfer
pnpm bankc verify examples/account-transfer
pnpm bankc test examples/account-transfer
pnpm bankc emit jcl examples/account-transfer
```

If the second example changed, also verify:

```bash
pnpm bankc build examples/batch-interest-accrual
pnpm bankc verify examples/batch-interest-accrual
pnpm bankc test examples/batch-interest-accrual
```

## 3. Documentation and evidence

- Update `CHANGELOG.md`.
- Update README command inventory and limitations if behavior changed.
- Update example READMEs and evidence bundle READMEs if generated output changed.
- Add or update tester notes for compiler behavior, generated output, or security changes.
- Add or update AI review logs for medium/high-risk changes.
- Keep generated outputs deterministic and avoid timestamps.

## 4. Git hygiene

- Run `git diff --check`.
- Commit with a message that explains why the change was made and what was validated.
- Push only after the release slice is verified.
