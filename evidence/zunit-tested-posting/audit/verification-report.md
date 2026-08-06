# Verification Report

Project: examples/zunit-tested-posting/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | evidence/zunit-tested-posting/cobol/ZUNITTES.cbl |
| Copybook emit | passed | 0 copybook file(s) |
| Source map emit | passed | evidence/zunit-tested-posting/maps/source-map.json |
| JCL emit | passed | evidence/zunit-tested-posting/jcl/ZUNITTES.jcl |
| Audit artifacts | passed | evidence/zunit-tested-posting/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 2/2 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 2
- traced-symbols: 2
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -m -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/zunit-tested-posting/gnucobol/copybooks evidence/zunit-tested-posting/gnucobol/cobol/ZUNITTES-PRE.cbl -o evidence/zunit-tested-posting/gnucobol/bin/zunittes
- compiler-exit-code: 0
