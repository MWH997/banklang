# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-file-batch/src/main.bank.ts |
| source-artifact-sha256 | 7241aff02790e99f62a8557c129e93e9c4b3542fc73d83d54561262d3b4311ac |
| generated-artifact | evidence/account-file-batch/gnucobol/cobol/ACCOUNTF.cbl |
| generated-artifact-sha256 | 07f32c390dcefc84c0b1787cdecddfd8ccceb943eac7d38dfecd23d08de7a875 |
| source-map-artifact | evidence/account-file-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 70e203a9fb0abe0f616b1506c0d551b75c30e1015bc4383ad29a751340b06a1f |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -m -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-file-batch/gnucobol/copybooks evidence/account-file-batch/gnucobol/cobol/ACCOUNTF.cbl -o evidence/account-file-batch/gnucobol/bin/accountf |
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
