# Conversions

Existing COBOL on one side, the BankTS it becomes on the other, and what the
compiler produces from that BankTS underneath.

This is the section that answers the only question a bank actually has: **what
happens to what we already have.**

|                                                                | Shows                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [01. sequential update](01-sequential-update/)                 | The classic master-file update. Four files opened in one statement and nothing tested.           |
| [02. CICS commarea enquiry](02-cics-commarea-enquiry/)         | A COMMAREA contract kept byte for byte, and an SQL test with two branches where there are three. |
| [03. Db2 cursor batch](03-db2-cursor-batch/)                   | `PERFORM UNTIL SQLCODE = 100` over a cursor, and what a deadlock does to it.                     |
| [04. awkward rounding](04-awkward-rounding/)                   | Fourteen lines of hand-written banker's rounding, and the two things wrong with them.            |
| [05. REDEFINES and OCCURS DEPENDING ON](05-redefines-and-odo/) | A real copybook, imported rather than retyped.                                                   |

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

## Third-party COBOL, and what can actually be used

Checked 2026-08-07. The obvious fix for the weakness above is to convert
somebody else's code, and the constraint is finding COBOL that can be published rather than finding
COBOL whose licence permits publishing a derivative of it here.

| Corpus                                                                                       | Licence       | Size                      | Verdict                                      |
| -------------------------------------------------------------------------------------------- | ------------- | ------------------------- | -------------------------------------------- |
| [AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo)          | Apache-2.0    | 44 programs, 30,175 lines | **Usable, and the right domain**             |
| [CICS GENAPP](https://github.com/cicsdev/cics-genapp)                                        | EPL-2.0       | 31 programs, 365 KB       | Usable with care; weak copyleft              |
| [COBOL Programming Course](https://github.com/openmainframeproject/cobol-programming-course) | CC-BY-4.0     | teaching material         | Attribution is fine, CC on code is not       |
| [NIST CCVS85](https://sourceforge.net/projects/gnucobol/files/nist/)                         | Public domain | 512 programs              | Wrong tool: compiler tests, not applications |
| The four repositories [zunit.md](../docs/zunit.md) cites                                     | **None**      | small                     | Cite what they show; copy nothing            |

**CardDemo is the answer.** Apache-2.0 with a per-file licence header and a
`NOTICE`, actively maintained, and it is a credit-card management application,
batch interest calculation over indexed VSAM, CICS screens, Db2, JCL. That is
this compiler's subject matter rather than a general sample. Apache-2.0 permits
a derivative provided the licence, the copyright notice and a statement of
changes travel with it, which is a directory in this repository and a paragraph.

**EPL-2.0 is where it gets awkward**, and GENAPP is the one that carries it. The
EPL's reciprocity applies to modified source, and BankTS written from a reading
of an EPL program is arguably a modified form of it. That is an argument, not a
fact, and a repository that wants to be trusted should not be the place it gets
tested.

**The NIST suite is public domain and still the wrong tool.** 512 programs that
exist to check whether a compiler implements the 1985 standard. They exercise
language features, not banking, and converting one demonstrates nothing about
what happens to an estate. It would be a good corpus for the _reader_, which is
a different exercise.

**The four repositories cited for the zUnit work carry no licence at all.** That
is not a problem for what was done with them, and [zunit.md](../docs/zunit.md)
records what each one _shows_ (an element order, a name truncation, a JCL
parameter), which is a fact about a file format rather than an expressive work,
and no line of any of them is in this repository. It does mean none of them can
become a conversion.

### What the first run over somebody else's code already found

CardDemo has not been converted. `bankc analyse` was run over its thirty-one
`app/cbl` programs, which is the part that needs no licence decision because it
generates nothing, and the report was wrong twice, on shapes that do not occur
in any of the five originals above, because the author of the reader wrote those
too:

- **Nine programs came back with no name.** They write `PROGRAM-ID.` on one line
  and the name on the next, which is legal and which nothing here does. An
  inventory of an estate where a third of the rows say `?` is one nobody reads
  twice.
- **Two files were invented.** `COCRDLIC` declares `05 WS-EDIT-SELECT PIC X(1)`
  and displays `'PLEASE SELECT ONLY ONE RECORD…'`; the reader took `PIC` and
  `ONLY` for file names and then reported that neither declared a `FILE STATUS`.
  A hyphen is a word boundary to a regular expression and a letter to COBOL.

Both are fixed, with the shapes as regression tests. That is the argument for
the corpus in one paragraph. The value is not the conversion itself but the
fact that somebody else's code is written in ways yours is not.

## What each conversion contains

```
01-sequential-update/
  README.md            the four panels, and what changed
  original/            the COBOL as it was
  banklang/src/        the BankTS it becomes
  generated/           what `bankc build` produced from that BankTS
```

`generated/` is checked in so it can be read without a toolchain, and it is
written by `pnpm conversions:refresh` rather than pasted, since a checked-in artifact
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
wrong in one of the ways it knows about will not compile: an unbalanced
posting, a missing idempotency key, an `SQLCODE` test that cannot tell an error
from a missing row, a rounding mode the target does not have.

It also does not preserve behaviour where the original's behaviour was the
defect. Every one of these five changes what the program does on a path the
original got wrong, and each page says which paths those are.
