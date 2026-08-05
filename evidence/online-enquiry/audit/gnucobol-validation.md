# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/online-enquiry/src/main.bank.ts |
| source-artifact-sha256 | f52e153c533f7273537df1a1a5183adbd0b55cc1213f52552c3e3727290dcca5 |
| generated-artifact | evidence/online-enquiry/gnucobol/cobol/ONLINEEN.cbl |
| generated-artifact-sha256 | cbb7e2536bb0263212e9a2720752729e66624a1f2d9f6acd10ec5f6e188a1b02 |
| source-map-artifact | evidence/online-enquiry/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 9504651da186133539cc053d472f36441ae1b14106a1a539c90abbe5be41a2bc |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/online-enquiry/gnucobol/copybooks evidence/online-enquiry/gnucobol/cobol/ONLINEEN-PRE.cbl -o evidence/online-enquiry/gnucobol/bin/onlineen |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This program requires db2-precompiler and cics-translator. It was translated by the BankLang precompiler before compiling, which checks the surrounding COBOL and every host variable but does not validate SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
