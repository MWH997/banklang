# Backend Profile: GnuCOBOL Local

## Status

Local validation profile only.

## Purpose

GnuCOBOL gives BankLang a free/open local validation lane for generated COBOL syntax and behaviour where the supported subset overlaps.

## Non-goal

GnuCOBOL validation does not prove IBM Enterprise COBOL compatibility.

## Allowed uses

- local smoke tests
- CI-friendly generated COBOL tests
- pure function behaviour tests
- simple batch examples
- generated output sanity checks

## Disallowed claims

Do not claim:

- IBM Enterprise COBOL compatibility
- z/OS compatibility
- CICS validation
- Db2 precompile validation
- production readiness

## Required evidence

Every GnuCOBOL validation report must include:

- GnuCOBOL version
- compiler command
- source artifact hash
- generated artifact hash
- pass/fail result
- known backend gaps
- report file location, typically `dist/audit/gnucobol-validation.md`

## References

- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)
- [GnuCOBOL guides](https://gnucobol.sourceforge.io/guides.html)
