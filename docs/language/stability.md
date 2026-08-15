# What is stable, and what is not

BankTS is pre-1.0. This page says what that means in practice, because "pre-1.0"
on its own tells you nothing about whether the program you write this week still
compiles next month.

The short version: **the artifacts are stable, the source language is not yet.**
A program you write today may need editing when the language changes. The COBOL
the compiler produces for a program that still compiles will not change shape
underneath you without the change being written down.

## The three surfaces, and what each promises

| Surface                        | Promise now                                                      | From 1.0                                              |
| ------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- |
| **Generated COBOL and JCL**    | Byte-identical for the same input and compiler version           | Same, plus a documented reason for every shape change |
| **Diagnostic identifiers**     | Stable. A `BANK-LED-001` is that rule for good                   | Same                                                  |
| **The BankTS source language** | May change. Every change is in the changelog and has a migration | Additive only within a major version                  |
| **`bankc` command line**       | Commands and flags may be added; existing ones keep their shape  | Same                                                  |
| **Audit bundle JSON**          | Versioned by `schemaVersion`; a shape change bumps it            | Same                                                  |

## What "byte-identical" covers, and what it does not

`bankc verify` re-emits every artifact and compares the bytes, and
`tests/determinism.test.ts` builds twice and does the same. That rules out a
build that depends on the clock, on filesystem order, or on a random name.

It does not mean two versions of the compiler produce the same bytes. They
should not: a fix to the emitter is a change to the output, and pretending
otherwise would mean never fixing anything. What it means is that _one_ version
is a function of its input.

That is why the compiler now answers `bankc --version`, and why a bug report
about generated COBOL should include it.

## What changes look like

A change to the language surface lands with all four of these or it does not
land:

1. A `CHANGELOG.md` entry under the release, saying what changed.
2. The grammar in [`grammar.md`](grammar.md) updated, which
   `tests/grammar.test.ts` enforces for every keyword.
3. Every example in `examples/` updated, which `pnpm examples:verify` enforces.
4. A note here if the change is one an existing program has to be edited for.

A change to the _generated output_ (a different COBOL shape for the same
BankTS) needs the reason in the commit body and a golden fixture update that a
reviewer sees. `CONTRIBUTING.md` calls that out: a golden change is reviewed as
a behaviour change, never as a formatting one.

## Known instability, named

These are the parts most likely to move before 1.0. They are listed so that a
program leaning on them is a decision rather than a surprise.

- **Report Writer syntax.** The `report` declaration covers control breaks and
  totals and little else. Enterprise COBOL's Report Writer is much larger, and
  the shape of the BankTS side will change as more of it is covered.
- **The IMS and MQ statements.** Both are modelled on one calling convention
  each. Neither has been exercised against a real subsystem, so both may need to
  grow parameters.
- **`nullable<T>`.** Currently a null indicator beside the field, which is the
  Db2 convention. How it interacts with a record written to a QSAM file is not
  settled.
- **`accept parameter`.** Reads SYSIN. The PARM convention in
  [the JCL model](../jcl-model.md) is settled; this one is not.

## What will not change

- The refusal rules. A transaction that does not balance will not become a
  warning, and no flag will be added to turn one off. If a rule is wrong it is
  fixed or removed, and either way that is a change with a reason, not a switch.
- Money will not become binary floating point.
- The compiler will not gain a network call, and no model will decide what is
  generated. See [ADR-0001](../adr/0001-bankts-restricted-language.md).

## Reporting a difference

If a program compiled last release and does not now, and no changelog entry
covers it, that is a bug rather than a policy. Include `bankc --version`, the
program, and what the compiler said.
