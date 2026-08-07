# BankTS Language Reference

BankTS is a restricted TypeScript-like language for banking workloads that
compiles to COBOL. It is deliberately less expressive than TypeScript: the goal
is safety, auditability, and predictable COBOL generation.

This page is the contents. Every rule lives on one of the pages below.

Until 2026-08-06 all of it was one 108 KB file whose sections were numbered in a
single sequence — a sequence that had gone wrong, with two sections numbered 14,
two numbered 15, and 3a before 3c before 3b. The numbers are gone with the file
they belonged to. Each page is a topic, and each diagnostic cites the page.

---

## The whole language, formally

| Page                               | What is in it                                                         |
| ---------------------------------- | --------------------------------------------------------------------- |
| [Grammar](language/grammar.md)     | Every production in EBNF, and every word the language reserves        |
| [Stability](language/stability.md) | What is settled, what is not, and what a change to the language costs |

## The program

| Page                                        | What is in it                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Programs and modules](language/program.md) | What a module is, how names are chosen, what BankTS will not let you write, and what the backend needs before it can build |

## The data

| Page                           | What is in it                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| [Types](language/types.md)     | Primitives and how each is stored, dates and times, edited fields, currency, nullability |
| [Records](language/records.md) | Layout, inheritance, generics, variant records, bounded arrays, imported copybooks       |

## The code

| Page                                                  | What is in it                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| [Functions and calls](language/functions.md)          | Functions, strings, calls between routines and to another program |
| [Control flow and operators](language/expressions.md) | Branching and loops, and every operator with the COBOL it becomes |
| [Transactions](language/transactions.md)              | Entry points, ledger postings, failures, audit events             |

## The environment

| Page                                    | What is in it                                                  |
| --------------------------------------- | -------------------------------------------------------------- |
| [Files](language/files.md)              | Declarations, organisation, keys, file status                  |
| [Batch operations](language/batch.md)   | The PARM, sorting, procedures on the way through, restart      |
| [Reports](language/reports.md)          | Report Writer: control breaks, totals, pagination              |
| [Db2 and embedded SQL](language/sql.md) | Statements, host variables, SQLCODE, cursors, units of work    |
| [CICS](language/cics.md)                | Online transactions, the communication area, response handling |
| [IMS DL/I](language/ims.md)             | Databases, segments, the PCB list                              |
| [IBM MQ](language/mq.md)                | Queues, messages, syncpoint                                    |

---

## Where these rules are enforced

Every rule on these pages that can be broken has a diagnostic, and every
diagnostic names the page it came from. `bankc explain BANK-LED-001` prints any
of them with an explanation and a remediation.

- [Diagnostics](diagnostics.md) — the full catalogue
- [Generated code standards](generated-code-standards.md) — what the output
  looks like, as a contract
- [Target conformance](target-conformance.md) — the Enterprise COBOL rules the
  output obeys, each with a manual citation
- [Status and honest limits](status-and-limits.md) — what none of this claims

## Trying it

[`examples/`](../examples/) carries twenty-three worked programs, each with its
generated COBOL, copybooks, JCL and verification report. The
[playground](../packages/playground/) runs the whole compiler in a browser.
