# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/amortisation-schedule/src/main.bank.ts |
| source-artifact-sha256 | 1a2193f454760ceae605f6901d0b6bb6c6e14ce0fb869f34a5e9b02f849cef57 |
| generated-artifact | evidence/amortisation-schedule/gnucobol/cobol/AMORTISA.cbl |
| generated-artifact-sha256 | 93ae7d0baf8e86a578a97dd40efbbf30ad18c46c3d28ce1a803997209b5e86cd |
| source-map-artifact | evidence/amortisation-schedule/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | b39850808b4f66d7d147aeba95ff24a99cf7113b96d8ab78d62124969faeae89 |
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
