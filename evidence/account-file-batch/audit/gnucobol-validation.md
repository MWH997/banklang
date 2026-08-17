# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-file-batch/src/main.bank.ts |
| source-artifact-sha256 | 78fc6ae7bc500ace48c2a47a4d291dc96624bc28d251237ffa0a871c240cee2f |
| generated-artifact | evidence/account-file-batch/gnucobol/cobol/ACCOUNTF.cbl |
| generated-artifact-sha256 | 6a8e337e1eb0c1748bacdbcf144b3dd1a758069ce1cd2c86560d0c4833f8a5b8 |
| source-map-artifact | evidence/account-file-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 694bbd497da16151ab8b56f2f915ab387ceee999f63497b53769fb3464c2003d |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -m -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-file-batch/gnucobol/copybooks evidence/account-file-batch/gnucobol/cobol/ACCOUNTF-PRE.cbl -o evidence/account-file-batch/gnucobol/bin/accountf |
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
