# ADR-0004: One module, one file, one program

## Status

Accepted

## Context

BankTS has no `import`. A project is exactly one source file (`src/main.bank.ts`
), and everything a program uses is declared in it.

That is unusual enough to read as an omission rather than a decision, and it is
the first thing a language engineer notices. It deserves an answer, because the
answer is not "we ran out of time".

A COBOL program is one compilation unit. It has one `PROGRAM-ID`, one
`WORKING-STORAGE SECTION`, one `PROCEDURE DIVISION`, and one set of
`FILE-CONTROL` entries, and the order of the data items inside it is the layout
of its records. A source language that spanned files would have to decide how to
flatten several of them into that one unit: whose `WORKING-STORAGE` comes first,
what happens when two files declare a record of the same name, which file's
`SELECT` wins when both name the same DD.

Every answer to those questions is a build system, and a build system is
something the resulting program then depends on. A generated COBOL program has
to be readable by somebody who has never seen BankTS, and a program whose data
layout is the output of a linker is not.

## Decision

One module per file, one file per program, no imports.

Sharing is done through the two mechanisms a mainframe estate already has:

- **Record layouts** are shared by importing a copybook. `bankc copybook import
ACCTMAST.cpy` writes the BankTS record for an existing copybook, and the
  layout is checked against the original rather than assumed.
- **Programs** are composed at the job level, not the source level. A
  `job.json` names several programs and the order they run in, and
  `bankc job` emits one JCL stream for the lot. `examples/end-of-day-settlement`
  is three programs and a sort in one night.

A BankTS program may still call another program at run time: `call` compiles to
a COBOL `CALL`, which is dynamic and resolves at link or load time exactly as it
does on z/OS. What it may not do is textually include one.

## Consequences

- A program's layout is decided entirely by its own source, read top to bottom.
  This is what makes the copybook a program emits reviewable against the one an
  installation already has.
- A large program is a large file. That is a real cost, and the mitigation is
  that BankTS programs are small by construction: the language has no general
  computation, and a program that wants to be large is usually a job that wants
  to be several programs.
- There is no dependency graph, no resolution order, and no version skew between
  parts of one program. Determinism follows from there being nothing to resolve.
- A shared record definition can drift between two programs that both imported
  it. `bankc copybook diff` is what catches that, and it is a check rather than
  a guarantee.

## Alternatives considered

**An include mechanism, textual like COBOL's `COPY`.** This is what COBOL
itself does, and it works because the copybook is also the artifact. In BankTS
the artifact is generated, so a textual include would produce a copybook whose
provenance is two files, and the copybook is the thing an installation reviews.

**A module system with explicit exports.** Coherent, and it makes the compiler a
linker. The layout of a record would then depend on resolution order, which is
the one property this project cannot give up: the same input must produce
byte-identical output, and "the same input" would become "the same input and the
same resolution".

## References

- [ADR-0001: BankTS as a restricted language](0001-bankts-restricted-language.md)
- [Records and copybook import](../language/records.md)
- [The JCL model](../jcl-model.md)
- [The grammar](../language/grammar.md)
