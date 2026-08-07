# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/online-enquiry/src/main.bank.ts |
| source-artifact-sha256 | ae18dc58acab2d8521edaee85d0727e214a30c61302cf9ed7ea361c2c1708e89 |
| generated-artifact | evidence/online-enquiry/gnucobol/cobol/ONLINEEN.cbl |
| generated-artifact-sha256 | a19d2481ba10901fd6aeae61ee2f2b4444c5ff3a940a9ea71b5cfb7a0e018f48 |
| source-map-artifact | evidence/online-enquiry/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 8cfc9a0492064325109069d1a826258e7ed8dd01589935146c2204e08f2b2fdf |
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
