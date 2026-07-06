# ADR-0002: Make IBM Enterprise COBOL the primary backend target

## Status

Accepted

## Context

BankLang needs a primary COBOL backend target that reflects real enterprise
usage rather than only a local compiler dialect.

## Decision

IBM Enterprise COBOL for z/OS is the primary backend target. GnuCOBOL remains a
local validation target only.

## Consequences

- Generated COBOL must stay readable and IBM-oriented.
- Local validation evidence must not be confused with IBM validation.
- Documentation and tests need to distinguish primary and secondary backends.

## References

- [IBM Enterprise COBOL for z/OS documentation](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)
