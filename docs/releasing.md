# Release Checklist

Use this before cutting or publishing a release.

## 1. Tree and policy checks

- Ensure the worktree is clean or that every change is intentional.
- Confirm `.env` is ignored and never committed.
- Confirm `SECURITY.md` exists and still reflects the secret-handling policy.
- Confirm the repository does not make IBM validation claims without evidence.

## 2. Verification

Confirm the runtime before running the checks. Node.js 24 or newer is required:

```bash
node --version # must be v24 or newer
```

Run the repository checks:

```bash
pnpm lint
pnpm format:check
pnpm fmt:check
pnpm typecheck
pnpm test
pnpm test:gnucobol
pnpm lint:conformance
pnpm lint:zos
pnpm sbom:check
pnpm bankc --help
pnpm bankc doctor
pnpm bankc check examples/account-transfer
pnpm bankc build examples/account-transfer --out /tmp/banklang-release-build
pnpm bankc layout examples/account-transfer
pnpm bankc verify examples/account-transfer
pnpm bankc test examples/account-transfer
pnpm bankc emit jcl examples/account-transfer
```

Every example must pass, not only the first one:

```bash
pnpm examples:verify
```

**Not a loop over `examples/*/`.** That is what this checklist used to say, and
it fails: `end-of-day-settlement` is four programs and a sort in one job, so it
has no `src/main.bank.ts` of its own and `bankc test` on the directory reports
that it is not a project. CI made the same mistake and
[CONTRIBUTING.md](../CONTRIBUTING.md) records it. `tools/verify-examples.ts`
knows which entries are jobs.

`pnpm test` includes `tests/cobol-compiles.test.ts`, which compiles every
example with `cobc` when GnuCOBOL is installed. Treat a skipped compile lane as
an unverified release, not a passing one.

## 3. Documentation and evidence

- Update `CHANGELOG.md`.
- Update README command inventory and limitations if behavior changed.
- Update example READMEs and evidence bundle READMEs if generated output changed.
- Add or update tester notes for compiler behavior, generated output, or security changes.
- Keep generated outputs deterministic and avoid timestamps.

## 4. Git hygiene

- Run `git diff --check`.
- Commit with a message that explains why the change was made and what was validated.
- Push only after the release slice is verified.

## 5. Cutting the release

`.github/workflows/release.yml` does the rest, and **refuses an unsigned tag**:
a signature needs a key belonging to a person rather than to a runner, so the
workflow will not pretend it signed one. A lightweight tag has no object to
sign and is rejected the same way.

1. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`.
2. Set `version` in `package.json`, `CITATION.cff` and
   `packages/vscode-extension/package.json` to the same value — `pnpm test`
   fails if the three disagree.
3. `git tag -s vX.Y.Z -m "X.Y.Z"` and push the tag.

The workflow then reruns the whole of `ci.yml` on the tagged commit, builds the
bill of materials and the VSIX, attests both with Sigstore through GitHub's
OIDC identity, and attaches them to a GitHub release. It deliberately does not
run `vsce publish`: that needs a marketplace token belonging to a person, and
the attested `.vsix` on the release is the exact file to upload.

Pre-1.0, so a release that adds language surface, a diagnostic or a CLI command
is a **minor** bump. `1.0` is not a function of the repository becoming public:
there has been no native IBM Enterprise COBOL validation and no production
ledger use, and a `1.0` claiming otherwise would be the least honest thing here.
