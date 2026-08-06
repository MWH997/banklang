# Deadlock retry

SQLCODE -911 and -913, which every Db2 batch meets.

## Why

Two units of work touch the same rows in a different order, Db2 picks one to
break, and the loser is told so. Neither program has a bug and the step has no
reason to fail: the answer is to start the unit of work again.

| SQLCODE | Means                                                          |
| ------- | -------------------------------------------------------------- |
| `-911`  | Deadlock or timeout; **the unit of work has been rolled back** |
| `-913`  | Deadlock or timeout; the unit of work is **still open**        |

The `ROLLBACK` covers both, because rolling back what Db2 has already rolled
back is a no-op and leaving a -913 open is not.

## What makes a retry safe

**A bound.** Three attempts. A retry loop with no limit turns a lock somebody is
holding over lunch into a step that runs until an operator cancels it, and the
cancel is the only record of what happened.

**Telling contention from an error.** Anything else negative — an authorisation
failure, a check constraint, a tablespace in recovery — will not come right on
the third attempt, so retrying it fails three times instead of once.

**Telling both from a missing row.** An UPDATE that matched nothing returns
`+100`, and an account that does not exist is not a lock problem.
`BANK-SQL-007` refuses a program that tests `SQLCODE` without separating an
error from a not-found.

## Artifacts

`dist/cobol/DEADLOCK.cbl`, `dist/jcl/DEADLOCK.jcl`, two copybooks. The job runs
under the DSN command processor with a BIND step, because a program with
embedded SQL cannot be started by `EXEC PGM=`.

## Related

- [docs/error-handling.md](../../docs/error-handling.md) — SQLCODE handling

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=deadlock-retry) — it compiles in your browser, with the generated COBOL beside it.
