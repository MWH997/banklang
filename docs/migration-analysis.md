# Migration analysis

Reading COBOL that already exists, and saying what is in it.

```bash
pnpm bankc analyse path/to/programs
pnpm bankc analyse path/to/programs --out dist/analysis
```

This is the one part of the toolchain that generates nothing. Before a bank asks
whether a compiler produces COBOL it likes, it asks what would happen to the two
thousand programs it already has — and the honest first answer is a count.

---

## What it reads

Reference-format text. It parses nothing semantically and compiles nothing,
which is what lets it work on a member that will not compile without copybooks
the tool does not have — and on an estate, that is most of them.

| Found                   | How                                                                    |
| ----------------------- | ---------------------------------------------------------------------- |
| Program name            | `PROGRAM-ID`                                                           |
| Paragraphs and sections | A name and a period in Area A                                          |
| `PERFORM` and `GO TO`   | The statement, with the far end of a `THRU`                            |
| Files                   | `SELECT`, `ASSIGN TO`, `ORGANIZATION`, `FILE STATUS`                   |
| File operations         | `OPEN`/`CLOSE`/`READ`/`WRITE`/`REWRITE`/`DELETE`/`START`               |
| SQL                     | Each `EXEC SQL` block, its verb, and the names in it                   |
| CICS                    | Each `EXEC CICS` command, its resource, and whether it captures `RESP` |
| Calls                   | `CALL "X"` and `CALL 'X'`, and a count of dynamic ones                 |
| Copybooks               | `COPY`                                                                 |
| `ALTER`                 | Counted, because of what it costs                                      |

## What it says to look at

Deliberately not a score, because a single number is what lets a conversation
skip the properties, and the properties are the whole point. Each flag is a
specific thing with a specific consequence:

- **`ALTER`** rewrites a `GO TO` at run time, so what the program does cannot be
  read from the source at all.
- **A dynamic `CALL`** decides its target at run time, so the call graph is
  incomplete and the report says by how much.
- **More than ten `GO TO`s to somewhere that is not an exit** means following one
  transaction through the program requires holding several paragraphs at once.
- **A paragraph nothing reaches** is dead code, or a reader's mistake.
- **A file with no `FILE STATUS`** is a failed open or write the program cannot
  see. This is the most common finding on real code and the one that most often
  turns out to matter.
- **A CICS command with no `RESP`** abends the task with nothing said about it.
  `RETURN` and `ABEND` are exempt: they do not come back.

## The paragraph graph

`--out` writes one Mermaid graph per program, which renders wherever the reader
already is — a Markdown file, a pull request — rather than needing a tool
installed.

A `PERFORM` is a solid arrow, the far end of a `THRU` a dotted one, and a
`GO TO` a thick one. The difference between the three is the question a reader
is actually asking.

## What it does not know

Printed on every report, because a count that is read as an estimate is worse
than no count:

- **It is not compiled.** A construct written in a way this reader does not
  recognise is absent from the report rather than reported as unknown.
- **Copybooks are named, not expanded.** A paragraph, file or SQL statement
  inside one is not counted.
- **`unreachable` is a lower bound.** Fall-through and `PERFORM ... THRU` are
  both followed, so a paragraph listed is very likely dead and one absent from
  the list may still be. That direction is deliberate: over-reporting dead code
  gets live code deleted.
- **Nothing here is a conversion estimate.** It is a count of what is in the
  source.

## Reading it on this repository

The conversions directory holds both an original and what the compiler produced
from its BankTS, so pointing the tool at it prints the argument as a table:

```bash
pnpm bankc analyse conversions/01-sequential-update
```

```
| Program    | Member                    | Lines | Paragraphs | Jumps | Files |
| ---------- | ------------------------- | ----- | ---------- | ----- | ----- |
| `ACCTUPDT` | .../generated/...         |   451 |         16 |     0 |     4 |
| `ACCTUPDT` | .../original/ACCTUPDT.cbl |    92 |          5 |     3 |     4 |
```

and the only thing under "what to look at first" is the original's four files
with no `FILE STATUS` between them.

## What somebody else's COBOL found

Everything above was written against `conversions/`, and every original in
`conversions/` was written by the author of this reader. On 2026-08-07 it was
pointed at
[AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo)
— thirty-one CICS and batch programs, Apache-2.0 — and got two things wrong that
no test here could have caught, because neither shape occurs in code this
project wrote:

- **`PROGRAM-ID.` and the name on separate lines.** Legal, common, and nine of
  the thirty-one do it. All nine came back with no name.
- **`SELECT` where there is no file.** `05 WS-EDIT-SELECT PIC X(1)` and
  `'PLEASE SELECT ONLY ONE RECORD…'` both matched, so the report claimed two
  files called `PIC` and `ONLY` and then that neither declared a `FILE STATUS`.
  A hyphen is a word boundary to a regular expression and a letter to COBOL.

Both are fixed and both shapes are regression tests. The second is the worse
one: a finding invented out of a message is the kind a reader checks, does not
find, and stops trusting the rest of the report over.

The reader is still what this page says it is — reference-format text, nothing
compiled — so the honest expectation for a first run against an unfamiliar
estate is that something else is wrong in the same way, and that the report
saying what it does not know is the part that matters most.

## Related pages

- [conversions/](../conversions/) — the same programs, converted, and the
  licence table for third-party corpora
- [toolchain.md](toolchain.md) — the rest of the CLI
- [roadmap.md](roadmap.md) — what is planned
