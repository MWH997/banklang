# BankTS language reference

BankTS is a small banking language that compiles to COBOL. Its types are
TypeScript's (`decimal<18, 2>`, `string<16>`, `record`, aliases), and its
statements are its own: `transaction`, `file … sequential input`, `cursor`,
`queue`, `on error`. The goal is safety, auditability, and predictable COBOL
generation, not TypeScript compatibility; a BankTS module is not a TypeScript
module and `tsc` cannot read one.

This page is the contents. Every rule lives on one of the pages below, one topic
per page, and every diagnostic cites the page its rule comes from.

New to the language? Read [Programs and modules](language/program.md), then
[Types](language/types.md), then [Records](language/records.md). Those three
cover any program that does arithmetic on money, and the rest of the pages are
there when you reach a subsystem that needs them.

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

- [Diagnostics](diagnostics.md): the full catalogue
- [Generated code standards](generated-code-standards.md): what the output
  looks like, as a contract
- [Target conformance](target-conformance.md): the Enterprise COBOL rules the
  output obeys, each with a manual citation
- [Status and limits](status-and-limits.md): what none of this claims

## Trying it

[`examples/`](../examples/) carries twenty-three worked examples, each with its
generated COBOL, copybooks, JCL and verification report. The
[playground](../packages/playground/) runs the whole compiler in a browser.
