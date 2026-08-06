# Account File Batch Example

A sequential batch: read every account, flag the overdrawn ones, write a posting
record for each.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- two record declarations, one per file
- two file declarations, one input and one output, each with a `status` clause
- a function that compares a decimal balance
- a read-ahead loop that opens, reads, writes, and closes

## What the example proves

### A file status is declared, and checked

`language-reference.md` section 13 requires file status to be checked. Each file
declaration binds a status field:

```ts
file accountInput sequential input record AccountRecord status accountInputStatus;
```

Removing the `status` clause makes
`pnpm bankc check examples/account-file-batch` fail with `BANK-FILE-001`.

The status is not decoration. Each `OPEN` is followed by a test of it:

```cobol
       OPEN INPUT ACCOUNT-INPUT-FILE
       IF ACCOUNT-INPUT-STATUS(1:1) NOT = "0"
           DISPLAY "OPEN FAILED accountInput STATUS " ACCOUNT-INPUT-STATUS UPON SYSOUT
           MOVE 12 TO RETURN-CODE
           GOBACK
       END-IF
```

An `OPEN` that failed is not recoverable by carrying on: every read afterwards
fails too, and a batch that ignores it writes an empty output file and returns
zero — which looks exactly like a night with nothing to post.

The test is on the first character rather than on `= "00"` because "00" is not
the only success. The first character is the status key, and 0 is successful
completion; "05" is an `OPTIONAL` file that has just been created, and "07" is a
tape-oriented `CLOSE` option on a device that is not tape.

### The read-ahead is guarded

```ts
while accountInputStatus == "00" limit 1000000 {
  read accountInput into account;

  if accountInputStatus == "00" {
    ...
    write postingOutput from posting;
  }
}
```

The iteration that reaches end of file still runs its body — the `while`
condition is not tested again until the body finishes — so an unguarded write
appends one trailing record holding the previous one's values. The `limit` is
mandatory (`BANK-TXN-004`): it is what stops a corrupt file spinning the job
until an operator cancels it.

## Generated file structure

File declarations produce a `FILE-CONTROL` entry and an `FD`:

```cobol
       FILE-CONTROL.
           SELECT ACCOUNT-INPUT-FILE ASSIGN TO ACCOUNTI
               ORGANIZATION IS SEQUENTIAL
               ACCESS MODE IS SEQUENTIAL
               FILE STATUS IS ACCOUNT-INPUT-STATUS.
...
       FD  ACCOUNT-INPUT-FILE.
       01  ACCOUNT-INPUT-RECORD.
           05  ACCOUNT-ID           PIC X(16).
           05  BALANCE              PIC S9(16)V99 COMP-3.
```

The `FD` record carries the field structure and the working-storage record is
declared separately, so `read ... into` and `write ... from` move field by
field. That makes the correspondence visible in the generated COBOL and survives
a layout that is compatible rather than byte-identical.

`string<16>` occupies 16 bytes and `decimal<18, 2>` occupies 10 packed-decimal
bytes, so `AccountRecord` is 26 bytes.

DD names are folded to eight uppercase alphanumeric characters, so
`accountInput` assigns to `ACCOUNTI`.

## Expected artifacts

Running the CLI from the repository root writes generated artifacts to `dist/`:

- `dist/cobol/ACCOUNTF.cbl`
- `dist/copybooks/ACCOUNTR.cpy`
- `dist/copybooks/POSTINGR.cpy`
- `dist/jcl/ACCOUNTF.jcl`
- `dist/maps/source-map.json`
- the audit bundle under `dist/audit/`

## Notes

The generated COBOL is validated locally with GnuCOBOL. No IBM Enterprise COBOL
validation is claimed.
