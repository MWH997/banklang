# Conversions

Existing COBOL on one side, the BankTS it becomes on the other, and what the
compiler produces from that BankTS underneath.

This is the section that answers the only question a bank actually has: **what
happens to what we already have.**

|                                                                 | Shows                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [01 — sequential update](01-sequential-update/)                 | The classic master-file update. Four files opened in one statement and nothing tested.           |
| [02 — CICS commarea enquiry](02-cics-commarea-enquiry/)         | A COMMAREA contract kept byte for byte, and an SQL test with two branches where there are three. |
| [03 — Db2 cursor batch](03-db2-cursor-batch/)                   | `PERFORM UNTIL SQLCODE = 100` over a cursor, and what a deadlock does to it.                     |
| [04 — awkward rounding](04-awkward-rounding/)                   | Fourteen lines of hand-written banker's rounding, and the two things wrong with them.            |
| [05 — REDEFINES and OCCURS DEPENDING ON](05-redefines-and-odo/) | A real copybook, imported rather than retyped.                                                   |

## Provenance

**Every original in this directory was written for this repository, in period
style, by the author of the compiler.** None of it is a bank's code, none of it
was taken from a corpus, and none of it has ever run in production.

That is a weakness and it is stated rather than buried. Programs written to be
converted are programs that convert well, and the defects each original carries
are defects the author knew how to find. What the directory demonstrates is what
the compiler does with a given input, not that a real estate looks like this.

What makes them worth reading anyway is that the defects are real ones: each is
something that has cost a real bank a real night, written the way it is actually
written, and none of them is a strawman that fails to compile or an obvious
mistake. `INTCALC` computes the right answer for every positive balance.

If you have COBOL you can share, converting it is the better test. The
[copybook importer](../docs/toolchain.md) is where to start.

## What each conversion contains

```
01-sequential-update/
  README.md            the four panels, and what changed
  original/            the COBOL as it was
  banklang/src/        the BankTS it becomes
  generated/           what `bankc build` produced from that BankTS
```

`generated/` is checked in so it can be read without a toolchain, and it is
written by `pnpm conversions:refresh` rather than pasted — a checked-in artifact
that has drifted from the compiler is worse than no artifact.
`pnpm conversions:check` fails when it has.

## The measurements

Each page prints the same three, and they are generated:

- **Lines**, because the output is always longer and pretending otherwise would
  be the first thing a reviewer caught.
- **`GO TO` to a paragraph that is not an exit**, because a raw `GO TO` count
  would be dishonest in both directions: the single-exit convention IBM's own
  Programming Guide writes needs one per failure path, and a generated program
  is full of them.
- **File operations whose result is tested**, which is the number that decides
  whether a step that failed can end with return code zero.

## What a conversion is not

It is not automatic. A person reads the original, writes the BankTS, and is
answerable for it. The compiler's contribution is that a translation which is
wrong in one of the ways it knows about will not compile — an unbalanced
posting, a missing idempotency key, an `SQLCODE` test that cannot tell an error
from a missing row, a rounding mode the target does not have.

It also does not preserve behaviour where the original's behaviour was the
defect. Every one of these five changes what the program does on a path the
original got wrong, and each page says which paths those are.
