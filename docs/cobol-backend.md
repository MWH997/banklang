# COBOL Backend Specification

## 1. Target

Primary target:

```txt
ibm-enterprise-cobol-zos
```

Secondary local target:

```txt
gnucobol-local
```

The IBM target is the source of truth for generated enterprise COBOL style. The GnuCOBOL target exists for local testing and CI.

## 2. Reference format

Generated COBOL is written in **fixed reference format**, which is the only one
Enterprise COBOL on z/OS reads. A source line is 72 characters: columns 1-6 are
the sequence number area, column 7 is the indicator area, columns 8-11 are Area
A and columns 12-72 are Area B. Columns 73-80 are the identification area and
are not part of the program. `SOURCEFORMAT(EXTEND)` is an AIX option; there is
nothing on z/OS that widens the line.

Nothing warns about crossing the margin. The compiler does not see the text past
column 72, so a name is silently shortened and the compile fails somewhere else
on a name the source appears to define. Every generated line therefore goes
through `packages/cobol-backend/src/reference-format.ts` on its way out:

- a statement too wide for the line is broken at a space and continued in Area B;
- an alphanumeric literal too wide for the line is filled to column 72 exactly
  and reopened on a continuation line carrying a hyphen in column 7, because
  every column of a continued line through 72 is part of the literal;
- a comment continues as a comment;
- a copybook is source too, so it is written in the same format — the 01 sits in
  Area A like any other level indicator.

JCL follows its own version of the same rule: fields end at column 71, and a
parameter field continues by breaking after a complete parameter _including its
comma_, then resuming between columns 4 and 16 of a card beginning `//` and a
blank.

Every `cobc` invocation in this repository passes `-fixed`. GnuCOBOL guesses the
format from the first line and will read a whole program as free format, where
none of these rules exist — which is a validation that proves nothing about the
target. `tests/reference-format.test.ts` checks the margins and the areas over
every generated artifact.

## 3. Generated COBOL style

Generated COBOL must be readable by a COBOL engineer.

Required style:

- meaningful program IDs
- meaningful paragraph names
- deterministic indentation
- stable section ordering
- generated-code banner
- optional source-line comments
- no minified output
- no arbitrary machine-generated garbage names
- clear error paragraphs
- clear audit paragraphs

## 4. Program structure

Generated programs should use standard divisions:

```cobol
IDENTIFICATION DIVISION.
PROGRAM-ID. ACCOUNT-TRANSFER.

ENVIRONMENT DIVISION.

DATA DIVISION.
WORKING-STORAGE SECTION.

PROCEDURE DIVISION.
MAIN-PARA.
```

Generated sections depend on program profile:

- batch
- Db2
- CICS
- VSAM
- copybook-only
- test harness

## 5. Data mapping

### Decimal

```ts
decimal<18, 2>;
```

Default IBM COBOL mapping:

```cobol
PIC S9(16)V99 COMP-3
```

The exact mapping must be controlled by backend profile and documented.

### String

```ts
string<16>;
```

COBOL:

```cobol
PIC X(16)
```

### Bool

Default COBOL representation:

```cobol
PIC X VALUE 'N'
88 TRUE-VALUE VALUE 'Y'
88 FALSE-VALUE VALUE 'N'
```

### Date

Default representation should be explicit and profile-controlled.

Recommended v0.1 representation:

```cobol
PIC 9(8)
```

Format:

```txt
YYYYMMDD
```

## 6. Copybook generation

Generated copybooks must:

- preserve field order
- include stable comments where configured
- use deterministic names
- support group records
- support packed decimal fields
- support bounded arrays
- support condition names where needed

## 7. Paragraph generation

Function:

```ts
function validateAmount(amount: decimal<18, 2>): bool;
```

Generated paragraph name:

```cobol
VALIDATE-AMOUNT.
```

Rules:

- paragraph names are globally unique per program
- source map links paragraph to source span
- no generated paragraph can be unreachable without a warning
- error paragraphs use stable names

## 8. Decimal operations

Decimal operations must preserve:

- precision
- scale
- rounding
- overflow checks
- signedness

Generated COBOL must not silently truncate precision.

If a target COBOL operation may truncate, the compiler must emit either safe generated code or a compile-time diagnostic.

## 9. Db2 generation

Generated Db2 code must use:

```cobol
EXEC SQL
  ...
END-EXEC.
```

Requirements:

- SQLCA declaration
- host variable declaration
- SQLCODE checks
- generated error paragraph
- audit report listing SQL statements
- build report listing precompile/bind needs

## 10. CICS generation

Generated CICS code must use:

```cobol
EXEC CICS
  ...
END-EXEC.
```

Requirements:

- response-code handling
- syncpoint/rollback mapping
- transaction boundary in source map
- generated error paragraphs
- COMMAREA/channel/container strategy documented per profile

## 11. VSAM/file generation

Generated file programs must contain:

- `ENVIRONMENT DIVISION`
- `INPUT-OUTPUT SECTION`
- `FILE-CONTROL`
- `DATA DIVISION`
- `FILE SECTION`
- FD declarations
- file status variables
- open/read/write/close paragraphs
- file status checks

## 12. Source maps

Every emitted artifact must be traceable.

Source map fields:

```json
{
  "sourceFile": "examples/account-transfer/src/main.bank.ts",
  "sourceStart": { "line": 10, "column": 1 },
  "sourceEnd": { "line": 18, "column": 2 },
  "artifact": "dist/cobol/ACCOUNT-TRANSFER.cbl",
  "targetStartLine": 120,
  "targetEndLine": 163,
  "category": "function",
  "symbol": "validateAmount"
}
```

## 13. Generated-code banner

Every generated source file should contain:

```txt
Generated by bankc.
Do not edit this file directly.
Source maps are available in dist/maps.
```

No timestamp in banner by default because output must be deterministic.

## 14. Unsupported target features

Unsupported COBOL features must fail with clear diagnostics, not partial output.

Examples:

- unsupported `REDEFINES` import pattern
- unsupported dynamic SQL
- unsupported recursive function
- unsupported CICS channel operation in current backend
