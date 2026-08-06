# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/zunit-tested-posting/src/main.bank.ts |
| source-artifact-sha256 | e956d5884443bb70dfa500e17a97bd9ebf5831f8cc29dd58d194ac7b75668902 |
| generated-artifact | evidence/zunit-tested-posting/gnucobol/cobol/ZUNITTES.cbl |
| generated-artifact-sha256 | 6ac967619b6098727c95b299f28777a12d91cd3040c455a8eb347f9855f7870e |
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
