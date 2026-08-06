# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/amortisation-schedule/src/main.bank.ts |
| source-artifact-sha256 | 1a2193f454760ceae605f6901d0b6bb6c6e14ce0fb869f34a5e9b02f849cef57 |
| generated-artifact | evidence/amortisation-schedule/gnucobol/cobol/AMORTISA.cbl |
| generated-artifact-sha256 | ec3a6ef4602eefe35d068de0bc0bd7090fa52e7a486870f7bed33c3578f63ab1 |
| source-map-artifact | evidence/amortisation-schedule/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | be47f35a61f73b4976f682c106a20be8f850795386fc8591c8238c0688c745cd |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/amortisation-schedule/gnucobol/copybooks evidence/amortisation-schedule/gnucobol/cobol/AMORTISA-PRE.cbl -o evidence/amortisation-schedule/gnucobol/bin/amortisa |
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
