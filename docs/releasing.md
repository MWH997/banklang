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
2. Set the version everywhere it is stated. `tests/release-version.test.ts`
   enumerates those surfaces and fails if any disagrees with `package.json`:
   the extension manifest, the language server's `SERVER_VERSION`,
   `CITATION.cff`, the extension's own changelog, and the sample `bankc doctor`
   output printed in [toolchain.md](toolchain.md).
3. `git tag -s vX.Y.Z -m "X.Y.Z"` and push the tag.

The workflow then reruns the whole of `ci.yml` on the tagged commit and builds
the three artifacts a release publishes:

| Artifact                                | What it is                                               |
| --------------------------------------- | -------------------------------------------------------- |
| `banklang-vscode-X.Y.Z.vsix`            | The editor extension, compiler bundled inside            |
| `banklang-X.Y.Z.cdx.json`               | CycloneDX bill of materials, every platform              |
| `banklang-zos-conformance-X.Y.Z.tar.gz` | The z/OS bundle: COBOL, copybooks, JCL, expected results |

All three are attested with Sigstore through GitHub's OIDC identity and
attached to a GitHub release. There is no checksum file: the z/OS bundle
carries a SHA-256 per member in its own `manifest.json`, and
`gh attestation verify` covers the archives themselves.

**No npm publish.** Every workspace package is `private: true`, so the
repository is the distribution and nothing goes to a registry. The workflow
also deliberately does not run `vsce publish`: that needs a marketplace token
belonging to a person, and the attested `.vsix` on the release is the exact
file to upload by hand.

Before running the release checklist, take the snapshot the release page and
the README are held to:

```bash
pnpm release:snapshot        # writes evidence/release/X.Y.Z.json
pnpm release:snapshot --check
```

It refuses if the changelog has no dated section for the version, and
`tests/release-claims.test.ts` fails if any figure quoted on the release page —
[docs/releases/0.10.0.md](releases/0.10.0.md) is the current one — disagrees
with it.

Pre-1.0, so a release that adds language surface, a diagnostic or a CLI command
is a **minor** bump. `1.0` is not a function of the repository becoming public:
there has been no native IBM Enterprise COBOL validation and no production
ledger use, and a `1.0` claiming otherwise would be the least honest thing here.

Read `## [Unreleased]` to decide which: a new file organisation, a diagnostic
or a CLI command makes it a minor release rather than a patch.

**The version stays where it is until the release is cut.** The surfaces above
are held to each other, and the changelog is held to them: bumping the version
without renaming `## [Unreleased]` to a dated section names a version the
changelog has never heard of, and the suite says so. The bump, the section
rename and the release snapshot are one commit, and the signed tag follows it.
