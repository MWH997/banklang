# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/interest-posting-batch/src/main.bank.ts |
| source-artifact-sha256 | ef58c82912d516afa7026a754b713c8eb0a03be6e78df2686dd3c0966c3f5c07 |
| generated-artifact | evidence/interest-posting-batch/gnucobol/cobol/INTEREST.cbl |
| generated-artifact-sha256 | 4904d363f504ae6f9e112ac5044467ab3d512bf22a471deee3d28ec80643343c |
| source-map-artifact | evidence/interest-posting-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 28fce270288e0b7d30096a741b6bbcfc3352e30605271ea1305527c4d1c63084 |
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
