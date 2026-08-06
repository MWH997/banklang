# PARM-driven batch

The batch entry convention: a program that is told what run it is, rather than
one that assumes.

## Why

A settlement run needs three things that are not in the data — which day, which
branch, and the key that makes a rerun idempotent. Before this convention
existed the compiler declared those parameters in working storage and nothing
ever wrote to them, so `BANK-TXN-001` was satisfied by a field holding whatever
the region had left there.

## What to look at

```cobol
       LINKAGE SECTION.
       01  BANK-PARM.
           05  BANK-PARM-LENGTH         PIC S9(4) COMP.
           05  BANK-PARM-DATA.
               10  BANK-PARM-RUN-DATE   PIC 9(8).
               10  BANK-PARM-BRANCH-ID  PIC X(8).
               10  BANK-PARM-IDEMPOTENCY-KEY PIC X(36).
       PROCEDURE DIVISION USING BANK-PARM.
```

The halfword length in front is what a `PARM=` actually is; a program that
declares only the data reads the length as two characters of it. `BANK-PARM` is
checked for `NULL` (no PARM at all), for being long enough, and each numeric
field for `IS NUMERIC`, before anything is moved out of it. A PARM that is too
short ends the step with return code 12 rather than reading past what was
passed.

The `RESTART` section of the generated prologue and the `restart` / `checkpoint`
pair are the second half: the restart record is keyed and rewritten in place,
because a sequential one is truncated by the next `OPEN` and a rerun that died
before its own first checkpoint would destroy the position it was resuming from.

## Artifacts

`bankc build examples/parm-driven-batch` writes `dist/cobol/PARMDRIV.cbl`,
`dist/jcl/PARMDRIV.jcl`, three copybooks, the source map and the audit bundle.
The job's `PARM='...'` template and a comment giving the field layout are in the
JCL.

## Related

- [docs/jcl-model.md](../../docs/jcl-model.md) — the generated job
- [docs/error-handling.md](../../docs/error-handling.md) — return codes
