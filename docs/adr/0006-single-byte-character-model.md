# ADR-0006: `string<n>` is n bytes, and Unicode text is a separate type

## Status

Accepted

## Context

CobolCodeBench's `task_func_47` asks a program to read person names and convert
accented characters to their English equivalents: `Téa` to `Tea`, `Zöe` to
`Zoe`, `Váquéz` to `Vaquez`. Character-for-character conversion is exactly what
`replaceChars` does; it lowers to `INSPECT ... CONVERTING`, which the typechecker
already requires to have operands of equal length because that is what the
Language Reference requires. The operation is not the obstacle.

The obstacle is the character model. The task's input file is UTF-8, where `é`
occupies two bytes. A BankTS `string<n>` emits `PIC X(n)`, which is n bytes and
n character positions, and the two stop being the same thing the moment a
character needs more than one byte. `Váquéz` is six characters and eight bytes.
`INSPECT ... CONVERTING "é" TO "e"` cannot be written at all: the operands are
two bytes and one, so the equal-length rule refuses it, and it refuses it
correctly. The conversion would have to delete a byte, and `CONVERTING` does not
change a field's length.

So the question this raises is what a BankTS string _is_, rather than whether
`replaceChars` should handle accents, and the answer has to hold on z/OS rather than on the
machine that happens to be running the tests.

### What the target actually offers

Enterprise COBOL 6.4 has three character models and they are not
interchangeable:

| Declaration             | Storage            | What it is                         |
| ----------------------- | ------------------ | ---------------------------------- |
| `PIC X(n)` `DISPLAY`    | n bytes, EBCDIC    | the ordinary alphanumeric item     |
| `PIC N(n)` `NATIONAL`   | 2n bytes, UTF-16BE | national characters                |
| `PIC X(n)` with a CCSID | n bytes, tagged    | alphanumeric in a stated code page |

Nothing in that list is UTF-8. z/OS Enterprise COBOL runs in EBCDIC: the
compiler's `CODEPAGE` option states which EBCDIC CCSID an alphanumeric literal
is in, and `NATIONAL` is UTF-16, not UTF-8. A program that reads a UTF-8 file on
z/OS is reading bytes it must convert, and the conversion is a service call (
`iconv`, or `NATIONAL-OF` with a CCSID) not a property of the data type.

Local validation makes this easy to get wrong. GnuCOBOL on this machine runs in
ASCII, files are UTF-8 by default, and a `PIC X(20)` holding `Váquéz` behaves
plausibly right up to the point where anything counts characters. A design
validated only there would encode the developer's laptop into the language.

### What BankLang already says about it

[`docs/divergences.md`](../divergences.md) D1 records that GnuCOBOL allocates
four bytes per national character inside a group where Enterprise COBOL
allocates two, and that BankLang emits the Enterprise COBOL width and warns
`BANK-TYPE-024` on every `national<n>` field because local validation does not
cover it. Conversion between alphanumeric and national is refused outright,
because the bytes would differ between the two compilers and GnuCOBOL implements
neither `NATIONAL-OF` nor `DISPLAY-OF` to make them agree.

That is the same question as this one, already answered once, and answered by
refusing rather than by guessing.

## Decision

**`string<n>` is n bytes and n character positions, and stays that way.** It is
`PIC X(n)`: one byte per position, the target's own model for an alphanumeric
item. Every operation on it (`substring`, `concat`, `replaceChars`, `countOf`,
`split`) is defined on byte positions, because the COBOL it becomes is.

**Unicode text is `national<n>` and remains distinct.** UTF-16, `PIC N(n)`, and
no implicit conversion in either direction. It carries `BANK-TYPE-024` to say
that local validation does not cover its width.

**Transliteration is not added.** Not as a builtin, not as a widening of
`replaceChars`, and not as a UTF-8 mode on `string<n>`.

**CobolCodeBench task_func_47 is `unsupported-not-yet-implemented`**, recorded
in `packages/horizontal-validation/src/task-blockers.ts` with the character
model as the reason. Not `unsupported-by-design`: there is nothing wrong with
wanting to fold accents in a banking system, and a language that cannot is
poorer for it. It is a to-do list entry, which is what that category is for.

## Consequences

**What this costs.** One benchmark task, and the general ability to normalise
names that arrive in UTF-8: a real requirement in a real bank, and the reason
this is a gap rather than a principle.

**What it avoids.** A `string<n>` whose length means characters on one platform
and bytes on another; a `substring(name, 3, 4)` whose answer depends on whether
an earlier character was accented; a `replaceChars` that silently changes a
field's length, which `INSPECT ... CONVERTING` cannot do. Every one of those
would be a difference between the local run and the target that the differential
lane could not see, because GnuCOBOL and this repository's interpreter would
agree with each other and both be wrong about z/OS.

**What would close it.** Not a change to `string<n>`. The shape that fits the
target is an explicit conversion at the edge (a statement that reads a tagged
code page into `national<n>` and back, lowering to `NATIONAL-OF` and
`DISPLAY-OF`) plus a transliteration table stated in the program rather than
assumed by the compiler. That is a feature with a design, and it needs the
evidence D1 asks for first: **`national<n>` has never been compiled by
Enterprise COBOL**, and until it has, building on top of it would be building on
the one thing this repository most expects to be wrong.

**The bar for revisiting.** Two things, in order. A z/OS run that settles D1's
national-width question, and more than one independent case that needs it:
`task_func_47` is currently the only one in 5,241 externally-sourced files and
tasks, and one case is not evidence for a character model.
