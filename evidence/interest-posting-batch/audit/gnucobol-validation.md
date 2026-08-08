# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/interest-posting-batch/src/main.bank.ts |
| source-artifact-sha256 | faccdd6801f0039055b3a674577e71116d324253c9713b79998437625b54a69c |
| generated-artifact | evidence/interest-posting-batch/gnucobol/cobol/INTEREST.cbl |
| generated-artifact-sha256 | 930f64de7fe878b78af3e4da591bcb78aae53638314069383c2f8b0de3b0a8be |
| source-map-artifact | evidence/interest-posting-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 5045400fff9329e38956668dd40c9aee59f264e8705a6f1135a4d619f0b6a87b |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/interest-posting-batch/gnucobol/copybooks evidence/interest-posting-batch/gnucobol/cobol/INTEREST-PRE.cbl -o evidence/interest-posting-batch/gnucobol/bin/interest |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
