# Backend Profile: IBM Enterprise COBOL for z/OS

## Status

Primary target. Validation pending until actual IBM Enterprise COBOL compiler access exists.

## Source of truth

Use IBM Enterprise COBOL documentation and IBM support pages.

## Current target line

IBM Enterprise COBOL for z/OS 6.5.x is treated as the current primary target line for research and future validation planning.

## Validation claim policy

Allowed before IBM compiler access:

> BankLang emits IBM Enterprise COBOL-oriented artifacts.

Not allowed before IBM compiler access:

> Validated with IBM Enterprise COBOL.
> IBM-compatible.
> Production-ready on z/OS.

Allowed after real validation:

> Selected generated artifacts were validated with IBM Enterprise COBOL for z/OS under the documented environment, compiler version, and compiler options.

## Output expectations

Generated COBOL should include:

- readable `IDENTIFICATION DIVISION`
- `ENVIRONMENT DIVISION` when needed
- `DATA DIVISION`
- `WORKING-STORAGE SECTION`
- `FILE SECTION` when needed
- `PROCEDURE DIVISION`
- meaningful paragraph names
- stable data names
- generated source map
- no timestamps by default
- no random names

## Numeric mapping policy

Decimal mapping must be explicit.

Initial default mapping for signed fixed decimal:

```txt
decimal<p, s> -> PIC S9(p-s)V9(s) COMP-3
```

This mapping must be validated through numeric-semantics tests and backend documentation.

## Build/middleware assumptions

This profile must eventually document:

- COBOL compiler options
- CICS translator/preprocessor/coprocessor expectations
- Db2 precompile/coprocessor expectations
- JCL/DBB build metadata
- COPY library assumptions

## References

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)
- [IBM Enterprise COBOL documentation library](https://www.ibm.com/support/pages/enterprise-cobol-zos-documentation-library)
- [IBM Enterprise COBOL for z/OS 6.5.x lifecycle/support](https://www.ibm.com/support/pages/ibm-enterprise-cobol-zos65x)
