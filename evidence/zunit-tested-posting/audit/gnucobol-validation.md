# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/zunit-tested-posting/src/main.bank.ts |
| source-artifact-sha256 | db571f9e0dd04ccab6eecb02089f33c25ad76d5a53af5570c28cdf479f707ef8 |
| generated-artifact | evidence/zunit-tested-posting/gnucobol/cobol/ZUNITTES.cbl |
| generated-artifact-sha256 | 580e4f2786429399edc9edd435bf18b87745d226f79f70bd396d52784419f64f |
| source-map-artifact | evidence/zunit-tested-posting/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 1c528b351eb781cc4ff734fd5d6d9f3d8e2291b1da868ebbbe162b4bf930ccef |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -m -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/zunit-tested-posting/gnucobol/copybooks evidence/zunit-tested-posting/gnucobol/cobol/ZUNITTES-PRE.cbl -o evidence/zunit-tested-posting/gnucobol/bin/zunittes |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

```text
ld: warning: -undefined suppress is deprecated
ld: warning: -undefined suppress is deprecated
```

## Known Backend Gaps

- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
