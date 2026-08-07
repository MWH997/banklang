# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-file-batch/src/main.bank.ts |
| source-artifact-sha256 | 7241aff02790e99f62a8557c129e93e9c4b3542fc73d83d54561262d3b4311ac |
| generated-artifact | evidence/account-file-batch/gnucobol/cobol/ACCOUNTF.cbl |
| generated-artifact-sha256 | 21c3179db4cd5f71723da950a73d7f1be19ce81810fc2678e248c0202ca55a8f |
| source-map-artifact | evidence/account-file-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | fb5938a31973250499460abc3eeacb959bacf380aa6d3d3b70bd2fd293961a8a |
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
