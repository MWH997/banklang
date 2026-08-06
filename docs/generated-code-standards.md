# Generated code standards

The house style the emitter is held to, written as a contract rather than as a
description. Two audiences: a reviewer, so that "this looks generated" becomes a
specific objection that can be answered or fixed; and whoever changes the
emitter next, so that a new construct has a rule to follow rather than a
precedent to copy.

Every rule here is checked. Where a check exists it is named — either
`packages/conformance-lint`, which reads the emitted text and knows nothing
about how it was produced, or a test.

---

## 1. The page

| Rule                                                                                                                                 | Checked by                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Fixed reference format. Columns 1–6 blank, 7 the indicator area, 8–11 Area A, 12–72 Area B. Nothing past column 72.                  | `line-length`, `sequence-area`, `indicator-area` |
| Only a division, section or paragraph header, an `FD`/`SD` entry, or a level 01 or 77 indicator in Area A.                           | `area-a`                                         |
| A statement wider than the margin is continued in Area B, and a literal broken at the margin carries a hyphen in the indicator area. | `tests/reference-format.test.ts`                 |
| The `CBL` statements are the exception: compiler-directing rather than source, and they start in column 1.                           | `area-a` skips them                              |

## 2. Names

| Rule                                                                                                                                                                | Checked by                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| At most 30 characters. Longer names are abbreviated word by word, longest segment first, to a floor of four characters.                                             | `word-length`                   |
| Never a reserved word. A collision takes a `-FLD` suffix.                                                                                                           | `reserved-word`                 |
| Never derived from a source position. A loop counter is `<ROUTINE>-LOOP-<n>`; a sort procedure is `<ROUTINE>-SORT-<n>-IN`.                                          | `tests/generated-style.test.ts` |
| `PROGRAM-ID` is at most eight characters and carries no hyphen, and is the same string as the load module member, the artifact file name and the job's `EXEC PGM=`. | `program-id-length`             |
| An index-name shared by two records is qualified by its record.                                                                                                     | `tests/generated-style.test.ts` |
| Every word is either a name the artifact declares or a word Enterprise COBOL 6.4 reserves.                                                                          | `vocabulary`                    |

## 3. Data division

| Rule                                                                                                                     | Checked by                         |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| A picture describes at most 18 digits, which is `ARITH(COMPAT)`.                                                         | `digit-count`                      |
| A PICTURE character-string is at most 50 characters; an alphanumeric literal at most 160.                                | `picture-length`, `literal-length` |
| One literal delimiter. `"` everywhere, which is what the `CBL` statement's `QUOTE` says.                                 | `literal-delimiter`                |
| One spelling per picture shape. `PIC X(1)` not `PIC X`, `V99` not `V9(2)` — either is legal, both in one program is not. | `tests/feature-coverage.test.ts`   |
| A file status field carries condition names: `-OK` (`"00" THRU "09"`), `-EOF`, `-DUPKEY`, `-NOTFND`.                     | `tests/generated-style.test.ts`    |
| An enum field carries one 88-level per member.                                                                           | `tests/enum-conditions.test.ts`    |
| A QSAM `FD` carries `BLOCK CONTAINS 0 RECORDS` and `RECORDING MODE`. VSAM carries neither.                               | `tests/generated-style.test.ts`    |
| An SQL declare section holds host variables and nothing else. Records an SQL statement names open sections of their own. | `tests/generated-style.test.ts`    |

## 4. Procedure division

| Rule                                                                                                                                                        | Checked by                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `BANK-MAIN` is the only paragraph that ends the program.                                                                                                    | `tests/failures.test.ts`         |
| Every routine has an exit paragraph and every caller performs it `THRU` that paragraph.                                                                     | `tests/failures.test.ts`         |
| A failure sets `BANK-RETURN-CODE`, names itself in `BANK-FAILURE-CODE`, and leaves through the enclosing routine's exit. Nothing else ends a routine early. | `tests/silent-failures.test.ts`  |
| Every call site tests the failure register afterwards.                                                                                                      | `tests/size-error.test.ts`       |
| A copy is a `MOVE`. `COMPUTE` is for arithmetic.                                                                                                            | `tests/generated-style.test.ts`  |
| Any computation that can overflow carries `ON SIZE ERROR`.                                                                                                  | `tests/size-error.test.ts`       |
| A computed subscript is range-checked before the statement that uses it.                                                                                    | `tests/subscript-bounds.test.ts` |
| A bounded loop that stopped on its bound fails the step.                                                                                                    | `tests/silent-failures.test.ts`  |
| Every I/O statement's status is checked, not only `OPEN`.                                                                                                   | `tests/file-status.test.ts`      |
| A `READ`'s record area is read only in the success phrase.                                                                                                  | `tests/silent-failures.test.ts`  |
| A CICS response is compared against `DFHRESP(NORMAL)`, never a number.                                                                                      | `tests/silent-failures.test.ts`  |
| A `SQLCODE` test that cannot separate an error from `+100` is `BANK-SQL-007`.                                                                               | `tests/silent-failures.test.ts`  |
| A CICS program never writes the `RETURN-CODE` register.                                                                                                     | `tests/generated-style.test.ts`  |
| `EXEC CICS RETURN` is followed by `GOBACK`.                                                                                                                 | `tests/sql-cics.test.ts`         |

## 5. The prologue

Every program opens with a comment block stating: the program and module name,
the source file it came from, what the program is entered at, how it is entered
and with what, every file with its DD name and record length, the modules it
calls, the copybooks it needs, what each return code means, and whether a rerun
is safe.

Derived from the program rather than maintained by editing. A prologue that has
to be kept in step by hand is one that stops being true.

Checked by `tests/generated-style.test.ts`.

## 6. Comments in the body

Comments are emitted where the generated COBOL does something the reader would
otherwise have to reconstruct — a rounding sequence, a guard, a translated
construct. They are short enough to survive reference format at any nesting
depth, because a comment that wraps mid-sentence reads worse than no comment.

No comment restates the statement below it.

## 7. Determinism

The same source produces byte-identical output, every time, on every machine.
No timestamps, no absolute paths, no iteration order that depends on a hash.
`bankc verify` re-emits and compares; `tests/determinism.test.ts` is the check.

That is why the prologue names `main.bank.ts` rather than the path it was
compiled from, and why a work field is numbered by its shape rather than by
where it appeared.

## 8. What is checked where

- `pnpm lint:conformance` reads every emitted artifact, the checked-in fixtures
  and the evidence bundles as text, and asserts the target's rules with a manual
  citation for each. See [target-conformance.md](target-conformance.md).
- `pnpm test:gnucobol` compiles every example under a GnuCOBOL configuration
  shaped to Enterprise COBOL, and under the default dialect, and treats a
  difference between them as a finding.
- `pnpm test` runs everything else, including the programs that are executed
  and compared against exact arithmetic.

A rule that is not on this page and not checked anywhere is not a rule. If you
find the emitter following one, either write it down here with its check or stop
following it. `tests/feature-coverage.test.ts` holds this page to that: every
`Checked by` cell above has to name a conformance rule that exists or a test
file that reads the whole corpus, and a cell saying "review" fails.

## 9. Not a standard yet

One rule belongs here and is not enforced, so it is stated apart from the table
rather than inside it.

**No data item is declared that nothing references.** The emitter still writes
storage a program never uses: the ledger interface group in a program that only
audits, the bounds and copy work fields in a program with neither, and a record
declared in BankTS but only ever named as a parameter type. Twelve level-01
items across the checked-in evidence, listed in
[audit-2026-08-06.md](audit-2026-08-06.md). Making it a rule means making each
of those emissions conditional first, because a linter rule that fails on every
artifact is one somebody turns off.
