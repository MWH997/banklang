# ADR-0005: No `index` type; tables are traversed, not subscripted

## Status

Accepted

## Context

`USAGE INDEX` and `INDEXED BY` appear in 452 of X-COBOL's 5,195 files — 8.7%,
the fourth most common construct BankTS does not offer directly. That frequency
is a reason to look, and the horizontal validation programme's rule is that a
construct is implemented because it earns its place, not because it is common.

So the question was asked of the corpus rather than of intuition: **what is an
index actually used for in real COBOL?** Counted across every file that declares
one:

|                                         | Occurrences |
| --------------------------------------- | ----------- |
| `INDEXED BY` on an `OCCURS` clause      | 11,499      |
| `SET x UP BY` / `SET x DOWN BY`         | 2,086       |
| `SEARCH` (sequential)                   | 1,359       |
| `SEARCH ALL` (binary)                   | 392         |
| **standalone `USAGE INDEX` data items** | **98**      |

The shape is unambiguous. An index is overwhelmingly _machinery attached to a
table_: 11,499 declarations bound to an `OCCURS`, against 98 items declared as
an index in their own right — less than one percent. What programs do with them
is walk a table (`SET UP BY`) and search one (`SEARCH`, `SEARCH ALL`). An index
is almost never data a program computes with, passes around, or writes to a
file; it is how COBOL says "where I am in this table".

That matters because BankTS already has the operations, without the register:

```ts
for each entry in rates { ... }        // the walk
search rates by rateCode { ... }       // SEARCH / SEARCH ALL
```

The generated COBOL for those already carries `INDEXED BY` where it needs one —
`AMORTISA.cbl` and `STATEMEN.cbl` in the evidence bundles both have it. The
abstraction is not hypothetical; it is what the backend does today.

The argument for exposing an index type is that a program which needs to save
its position across a paragraph boundary, or hold two positions at once, cannot
say so. The corpus says that program is rare: 98 items in 5,195 files.

The argument against is stronger than "it is rare". An index is a raw offset
into storage with no bounds attached to it, and its value is meaningless outside
the table it was declared against. Handing one to a programmer reintroduces
exactly the failure BankTS refuses elsewhere — `SET NI UP BY 1` past the end of
a table is the OpenCBS defect family `table-bounds`, six of the 41 reconstructed
defects, and BankTS answers it with `BANK-TYPE-009` at compile time and a bounds
check at run time. A language that refuses an unchecked subscript cannot then
offer an unchecked cursor into the same storage.

## Decision

**BankTS will not have an `index` type.**

Tables are traversed with `for each` and searched with `search`. The compiler
emits `INDEXED BY`, `SET` and `SEARCH` as the implementation of those, and the
index remains something the generated COBOL has rather than something the source
language names.

`usage-index` stays classified `adaptation` in the representability rules: a
program written around `SET NI UP BY 1` is expressible in BankTS, and becomes a
loop rather than a translated register. That is an honest label — the program
has to be restructured — and it is not a gap to be closed.

## Consequences

A COBOL program being read in migration whose logic depends on holding several
positions into one table at once, or on an index outliving the paragraph that
set it, has no one-to-one BankTS form. It has to be rewritten around the data
rather than around the cursor. On the evidence that is 98 items across a corpus
of five thousand programs, and the rewrite is the kind that makes the program
easier to read afterwards.

If that judgement turns out to be wrong, the evidence to reverse it is the same
evidence that produced it: a rerun of `pnpm horizontal:analyse` with a
`standalone-usage-index` feature counted separately, showing a materially larger
number than 98. This decision is recorded so that a future one can disagree with
it on the same terms.

## Related

- [ADR-0001](0001-bankts-restricted-language.md) — what BankTS refuses and why
- [docs/validation/horizontal-validation.md](../validation/horizontal-validation.md)
  — where the corpus figures come from
- `packages/horizontal-validation/src/representability.ts` — the `usage-index`
  row this decision fixes
