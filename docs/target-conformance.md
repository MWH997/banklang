# Target conformance

The rules the generated artifacts obey, each with the manual it comes from.

This is the page that turns "we think it compiles" into something checkable.
Every rule below is enforced by `packages/conformance-lint`, which reads a
`.cbl`, `.cpy` or `.jcl` as text and knows nothing about how it was produced —
that independence is the point. A checker written from the same belief as the
emitter agrees with the emitter, including where the emitter is wrong.

Run it with `pnpm lint:conformance`. It reads three sets of artifacts:

- **Fresh output**, emitted from every example, because that is what the
  compiler does today.
- **The checked-in fixtures**, because a golden file that holds a defect freezes
  it. Two of the 2026-08-05 audit's findings were sitting in
  `tests/fixtures/`, where every run of the suite compared each against itself
  and agreed.
- **The evidence bundles**, because they are what a reader is invited to check
  the claims against.

Manuals, as extracted in `vendor-docs/`:

- **LR** — Enterprise COBOL for z/OS 6.4 Language Reference
- **PG** — Enterprise COBOL for z/OS 6.4 Programming Guide
- **JCL** — z/OS MVS JCL Reference

---

## COBOL

| Rule                | Limit                                                                                                                  | Source                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `line-length`       | A source line ends at column 72.                                                                                       | LR, "Reference format"              |
| `sequence-area`     | Columns 1–6 are the sequence number area; this compiler numbers nothing.                                               | LR, "Reference format"              |
| `indicator-area`    | Column 7 holds a blank, `-`, `*`, `/` or `D`.                                                                          | LR, "Reference format"              |
| `area-a`            | Area A holds a division, section or paragraph header, an `FD`/`SD` entry, or a level 01 or 77 indicator. Nothing else. | LR, "Area A"                        |
| `word-length`       | A COBOL word is at most 30 characters.                                                                                 | LR, "COBOL words"                   |
| `program-id-length` | The program-name becomes a load module member name, which is at most eight.                                            | LR, "PROGRAM-ID paragraph"          |
| `literal-length`    | An alphanumeric literal is at most 160 characters.                                                                     | LR, "Alphanumeric literals"         |
| `picture-length`    | A PICTURE character-string is at most 50 characters.                                                                   | LR, "PICTURE clause"                |
| `digit-count`       | An arithmetic operand has at most 18 digits under `ARITH(COMPAT)`.                                                     | PG, "ARITH"                         |
| `reserved-word`     | A reserved word is not a data name or a paragraph name.                                                                | LR, Appendix E                      |
| `vocabulary`        | Every word is a name the artifact declares or a word Enterprise COBOL reserves.                                        | LR, Appendix E                      |
| `call-resolvable`   | Every `CALL "X"` names a program the run unit will hold.                                                               | PG, "Resolving external references" |
| `duplicate-name`    | Two things in one program are not declared under the same name, compared under the path that qualifies them.           | LR, "User-defined words"            |
| `literal-delimiter` | Every alphanumeric literal in one artifact is delimited the same way. Style rather than conformance; see below.        | LR, "Alphanumeric literals"         |

### The delimiter rule, which is not a conformance rule

Enterprise COBOL takes either delimiter, so nothing here is refused by the
target. It is in the linter because it is refused by a _reviewer_, and because
the 2026-08-05 audit's F13 came back: `MOVE 'Y'` two lines under a `VALUE "N"`
survived in a shipped example, its evidence bundle and a golden fixture, while a
test asserting exactly this passed. The test's program reached the boolean
written as a condition, which emits `IF … MOVE "Y" … ELSE MOVE "N"`, and never
the boolean written as a literal, which emits the `MOVE` alone.

The rule reads the artifact rather than the emitter: whichever delimiter more of
its literals use is the one it has chosen, and a literal written with the other
one is reported. A literal whose text _contains_ the chosen delimiter is exempt,
because switching is one of the two ways COBOL allows that character to appear.
That exemption is what lets the generated zUnit driver hold
`AZU2001W THE TEST "` in apostrophes, which is the shape IBM's own generator
produces. `EXEC` blocks are skipped: an SQL string constant is delimited by an
apostrophe and a delimited identifier by a quote, and those are SQL's rules.

### The vocabulary rule

This is the one that matters most, and the one that would have caught the
2026-08-05 audit's first finding.

`ROUNDED MODE IS NEAREST-EVEN` was emitted for two years. It compiled under
GnuCOBOL's default dialect, which is a superset of every COBOL it knows, and it
reads like COBOL. `NEAREST-EVEN` appears in **no column** of the Language
Reference's Appendix E — not reserved, not an unimplemented 85 Standard word,
not a word that might be reserved in a future release. Enterprise COBOL has
never heard of it.

A checker that asks whether the compiler in front of it accepted the text cannot
tell that. One that asks whether the target has ever heard of the word can.

The word list is not typed here. `tools/extract-ibm-words.ts` pulls it out of
Appendix E's own table, taking the leftmost of the three columns — the words
"reserved for function implemented in Enterprise COBOL" — plus Table 59's
intrinsic function names. `pnpm words:extract` regenerates it, and the diff is
the review.

---

## JCL

| Rule            | Limit                                                                                                              | Source                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `card-length`   | A statement's fields end at column 71.                                                                             | JCL, "Format of statements"                    |
| `name-field`    | A name field is one to eight characters.                                                                           | JCL, "Name field"                              |
| `dsn-qualifier` | Each qualifier is one to eight characters and does not begin with a digit.                                         | JCL, "DSNAME parameter"                        |
| `dsn-length`    | A qualified dataset name is at most 44 characters.                                                                 | JCL, "DSNAME parameter"                        |
| `continuation`  | A card ending in a comma is followed by `//`, a blank in column 3, and the field resuming in columns 4 through 16. | JCL, "Continuing statements"                   |
| `required-dd`   | A step has the DDs it cannot run without.                                                                          | PG, "Compile and link-edit procedure (IGYWCL)" |

### What `required-dd` knows

- A step running `IGYCRCTL` needs `STEPLIB`, `SYSIN`, `SYSPRINT`, `SYSLIN` and
  `SYSUT1`.
- A step running `IEWBLINK` needs `SYSLIN`, `SYSLMOD`, `SYSPRINT` and `SYSLIB`.
- A step running anything that is not an IBM utility on the linklist needs
  `STEPLIB`, because a module the job has just built is not on any search the
  step makes unless the job says where it is. Without it the step ends S806 —
  module not found — having compiled and linked perfectly.

---

## What conformance does not mean

It means the text obeys the rules the manuals state. It does not mean the
program has been compiled by IBM Enterprise COBOL, and nothing in this
repository has been. Local compilation is GnuCOBOL under
`tools/banklang-ibm.conf`, which is shaped to the target rather than being it.

[divergences.md](divergences.md) is the list of places the two are known or
suspected to disagree. [zos/README.md](../zos/README.md) is the kit for someone
with a machine.

## Related pages

- [generated-code-standards.md](generated-code-standards.md) — the house style, and what checks each rule
- [divergences.md](divergences.md) — GnuCOBOL against Enterprise COBOL
- [verification.md](verification.md) — the whole testing strategy
