# CICS Integration

## Purpose

CICS support must be designed around transaction safety and response-code handling.

## Source of truth

Use IBM CICS Transaction Server documentation.

## Required model

BankLang must model:

- transaction declaration
- `EXEC CICS` command nodes
- response-code strategy
- EIBRESP/EIBRCODE checks
- syncpoint/rollback notes
- COMMAREA first milestone
- channel/container roadmap
- generated transaction evidence

## Diagnostics

Required:

- unhandled CICS response
- unsupported command in selected backend profile
- syncpoint misuse
- missing transaction boundary
- unsafe rollback mapping

## Generated evidence

- CICS command inventory
- response-code handling report
- transaction boundary source map
- unsupported feature list

## References

- [EXEC CICS command format and programming considerations](https://www.ibm.com/docs/en/cics-ts/6.x?topic=reference-exec-cics-command-format-programming-considerations)
- [Response codes of EXEC CICS commands](https://www.ibm.com/docs/en/cics-ts/6.x?topic=codes-response-exec-cics-commands)
