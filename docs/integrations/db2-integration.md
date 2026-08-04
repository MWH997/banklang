# Db2 Integration

## Purpose

Db2 support must model embedded SQL as a first-class compiler feature.

## Source of truth

Use IBM Db2 for z/OS embedded SQL documentation.

## Required model

BankLang must model:

- `EXEC SQL`
- host variables
- SQLCA or SQLCODE/SQLSTATE variables
- SQLCODE paths
- SQL INCLUDE constraints
- precompile/build notes
- bind/package/plan notes
- generated SQL inventory in audit artifacts

## Diagnostics

Required:

- SQLCODE not handled
- host variable layout mismatch
- unsupported dynamic SQL
- unsafe transaction boundary
- SQL include misuse for selected profile

## Audit artifact fields

```json
{
  "sqlStatements": [],
  "hostVariables": [],
  "sqlcaPolicy": "SQLCA",
  "requiresPrecompile": true,
  "requiresBind": true,
  "validationStatus": "not-validated"
}
```

## References

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)
- [COBOL applications that issue SQL statements](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=programming-cobol-applications-that-issue-sql-statements)
- [Db2 PRECOMPILE command](https://www.ibm.com/docs/en/db2/11.1.0?topic=commands-precompile)
