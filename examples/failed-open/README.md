# Failed open

What happens when the OPEN fails, which is the first thing that goes wrong in a
real batch and the one no example showed.

## Why

A step whose input dataset is not catalogued gets file status 35. A program that
tests only for `"00"` before reading then reads end-of-file immediately, closes,
and reports success over an empty run — indistinguishable from a night that had
no work.

Three of the four statuses here look identical to an empty file from inside the
loop:

| Status | Means                                                      |
| ------ | ---------------------------------------------------------- |
| `35`   | Not in the catalogue, or the DD is missing from the JCL    |
| `37`   | Opened for a mode the device or organisation cannot do     |
| `39`   | The JCL's LRECL, BLKSIZE or RECFM disagrees with the FD    |
| other  | Something else, named in the job log rather than swallowed |

## What to look at

The `on error` handler, which becomes a `USE AFTER STANDARD ERROR` declarative:

```cobol
       PROCEDURE DIVISION.
       DECLARATIVES.
       ACCOUNT-MASTER-ERROR-SECTION SECTION.
           USE AFTER STANDARD ERROR PROCEDURE ON ACCOUNT-MASTER-FILE.
```

A status test covers the statement that thought to look. The declarative covers
the ones that did not, wherever in the program they were written — which is why
`DECLARATIVES` is the standard error path in COBOL rather than a convenience.
Everything after it moves into a `BANK-BODY SECTION`, because everything
following `DECLARATIVES` has to be in a section.

## Artifacts

`dist/cobol/FAILEDOP.cbl`, `dist/jcl/FAILEDOP.jcl`, two copybooks.

## Related

- [docs/error-handling.md](../../docs/error-handling.md) — file status, and the 88-levels

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=failed-open) — it compiles in your browser, with the generated COBOL beside it.
