# High-volume master

A file bigger than the loop bound, which is the case the bound exists for and
the case it used to get wrong.

## Why

Every loop in BankTS carries a limit, because an unbounded `PERFORM UNTIL` over
a corrupt file spins until an operator cancels the job. The limit was reached
silently: the program read its first million records, closed its files, wrote
its audit event and ended with return code zero — a night that accrued a fifth
of the book and reported success.

## What to look at

The two ways out of the loop, now told apart:

```cobol
           IF ACCRUE-MASTER-LOOP-1 >= 1000000 AND (ACCOUNT-MASTER-STATUS
               = "00")
               DISPLAY "LOOP LIMIT 1000000 REACHED, WORK UNFINISHED"
                   UPON SYSOUT
               MOVE 12 TO BANK-RETURN-CODE
               MOVE "BANK-LOOP-EXHAUSTED" TO BANK-FAILURE-CODE
               GO TO ACCRUE-MASTER-EXIT
           END-IF
```

Falling out because the file ended is the ordinary end. Falling out with the
counter at the limit and the condition still true is work that did not finish,
and it fails the step.

## Artifacts

`dist/cobol/HIGHVOLU.cbl`, `dist/jcl/HIGHVOLU.jcl`, two copybooks.

## Related

- [docs/error-handling.md](../../docs/error-handling.md) — what a failure writes

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=high-volume-master) — it compiles in your browser, with the generated COBOL beside it.
