# Zunit Tested Posting Evidence Bundle

Generated artifacts for the zunit-tested-posting example, including the zUnit
test case its `test` declaration becomes.

`zunit/` is the part worth reading: a `.bzucfg` configuration, a COBOL test case
program, and the job that submits them. Every shape in those files is copied
from a test case IBM's own generator produced, and
[docs/zunit.md](../../docs/zunit.md)
cites which one for each.

The program's own COBOL is byte for byte what it would be with no tests written
against it.

## Contents

- `audit/bankc-test-report.md`
- `audit/copybook-layout.json`
- `audit/copybook-layout.md`
- `audit/decimal-analysis.json`
- `audit/diagnostics.json`
- `audit/generated-artifacts.json`
- `audit/gnucobol-validation.md`
- `audit/source-map.json`
- `audit/transaction-analysis.json`
- `audit/validation-matrix.md`
- `audit/verification-report.json`
- `audit/verification-report.md`
- `cobol/ZUNITTES.cbl`
- `jcl/ZUNITTES.jcl`
- `maps/source-map.json`
- `source/main.bank.ts`
- `zunit/TZUNITTE.bzucfg`
- `zunit/TZUNITTE.cbl`
- `zunit/TZUNITTE.jcl`

## Regeneration

```bash
pnpm evidence:refresh
```

## Notes

No IBM validation claim is made here. The bundle records local deterministic
outputs only, and the zUnit case is narrower still: it has never been run,
locally or on z/OS. See divergences D20 and D21.
