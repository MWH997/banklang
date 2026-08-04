# Account File Batch Example

This example exercises sequential file declarations and the file-status
diagnostic.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- a record declaration
- two file declarations, one input and one output, each with a `status` clause
- a function that compares a decimal balance

## What the example proves

`language-spec.md` section 13 requires file status to be checked. Each file
declaration binds a status field:

```ts
file accountInput sequential input record AccountRecord status accountInputStatus;
```

Removing the `status` clause makes
`pnpm bankc check examples/account-file-batch` fail with `BANK-FILE-001`.

## Generated file structure

File declarations produce a `FILE-CONTROL` entry and an `FD` in the generated
COBOL:

```cobol
       FILE-CONTROL.
           SELECT ACCOUNT-INPUT ASSIGN TO ACCOUNTI
               ORGANIZATION IS SEQUENTIAL
               FILE STATUS IS ACCOUNT-INPUT-STATUS.
...
       FD  ACCOUNT-INPUT.
       01  ACCOUNT-INPUT-RECORD     PIC X(26).
```

The `FD` record is an unstructured buffer sized from the copybook layout, and
the structured record is declared once in working storage. That keeps field
names unambiguous: emitting the same record inside every `FD` would make each
reference to a shared field name require qualification, which GnuCOBOL rejects.

The 26-byte length is the copybook layout total: `string<16>` occupies 16 bytes
and `decimal<18, 2>` occupies 10 packed-decimal bytes.

DD names are folded to eight uppercase alphanumeric characters, so
`accountInput` assigns to `ACCOUNTI`.

## Expected artifacts

Running the CLI from the repository root writes generated artifacts to `dist/`:

- `dist/cobol/ACCOUNT-FILE-BATCH.cbl`
- `dist/copybooks/ACCOUNT-RECORD.cpy`
- `dist/jcl/ACCOUNT-FILE-BATCH.jcl`
- `dist/maps/source-map.json`
- the audit bundle under `dist/audit/`

## Notes

Read and write statements are not part of the current subset, so the generated
program declares the files without operating on them. The generated COBOL is
validated locally with GnuCOBOL. No IBM Enterprise COBOL validation is claimed.
