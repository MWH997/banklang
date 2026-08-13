# Divergences

Where GnuCOBOL and IBM Enterprise COBOL disagree, and where BankLang and the
target disagree. Numbered so they can be cited.

This is the repository's best evidence that its claims are bounded, and it used
to be buried in `zos/README.md`. Every entry is one of three kinds:

- **Measured** — reproduced, with the reproduction here.
- **Suspected** — a place the two compilers plausibly differ, not yet checked.
- **Deliberate** — BankLang not doing what the target could do, on purpose.

Local validation is GnuCOBOL 3.2.0 under `tools/banklang-ibm.conf`. Nothing in
this repository has been compiled by IBM Enterprise COBOL, and until it has,
every entry marked "suspected" stays suspected.

---

## D1. `USAGE NATIONAL` inside a group — **measured**

GnuCOBOL 3.2.0 allocates **four bytes per national character inside a group**,
where Enterprise COBOL holds each in two bytes of UTF-16. Standalone at the 01
level GnuCOBOL allocates two, which makes it an inconsistency in GnuCOBOL rather
than a rule.

```cobol
01  H.
    05  A2 PIC N(4) USAGE NATIONAL.
    05  C2 PIC X(4).
01  FLAT REDEFINES H PIC X(100).
```

`C2` starts at byte 17 under GnuCOBOL and at byte 9 under Enterprise COBOL.

BankLang emits the Enterprise COBOL width, because Enterprise COBOL is the
target, and warns `BANK-TYPE-024` on every `national<n>` field to say that local
validation does not cover it. The conversion between an alphanumeric and a
national is refused outright: the bytes would differ between the two compilers
and GnuCOBOL implements neither `NATIONAL-OF` nor `DISPLAY-OF` to make them
agree.

**This is the most likely thing in this repository to be wrong, and the cheapest
to check.**

## D2. Report Writer totals a packed field wrongly — **measured**

GnuCOBOL 3.2.0 reads a `COMP-3` operand of a `SUM` clause from the wrong place,
picking up only its low-order digits. A `PIC S9(7)V99 COMP-3` holding
1,000,000.00 totals as **zero**; one holding 9,999,999.99 totals as 999.99. The
same field read by a `SOURCE` clause on the line above prints correctly, so the
report shows right details under a wrong total.

```cobol
01  TYPE IS CONTROL FOOTING FINAL.
    05  LINE PLUS 1.
        10  COLUMN 1  PIC ZZZ,ZZZ,ZZ9.99 SUM PACKED-AMT.
        10  COLUMN 20 PIC ZZZ,ZZZ,ZZ9.99 SUM DISPLAY-AMT.
```

Money is `COMP-3` in every generated program, so every total in every report is
wrong under the local validator and none of it says anything about z/OS. Small
amounts survive the truncation and come out right by luck, which is how it went
unnoticed. `tests/report-writer.test.ts` asserts the divergence directly and
proves the totals over a `zoned` amount, which GnuCOBOL accumulates correctly.

**Report totals are the first thing to check on z/OS.**

## D3. A report file will not bind to a DD name — **measured**

GnuCOBOL's default `assign_clause` resolves an unquoted `ASSIGN TO <name>` on a
file carrying `REPORT IS` to report-section storage rather than to the DD name,
so the output lands in a file named after a printed value — a filename like
`        0.00`. Compile with `-fassign-clause=external` to bind it. On z/OS the
DD comes from the JCL and the question does not arise.

## D4. `JSON PARSE` and `XML PARSE` compile and do nothing — **measured**

GnuCOBOL warns `-Wpending` that neither is implemented, then leaves the record
untouched and raises no exception — so a program reading a payload runs clean
and processes an empty record. That is the worst shape a divergence can take,
because every local signal says the program worked.

The local build routes both through the precompiler, which rewrites them into
calls on `BANKJSON` and `BANKXML` in `runtime/`. **The shipped artifact keeps
the statement** Enterprise COBOL implements.

The stubs are scans, not parsers: `BANKJSON` reads a quoted name at the top
level and the scalar after its colon, `BANKXML` reads the next tag and the
characters between tags. Nesting, arrays, escapes, attributes, namespaces,
entity references and CDATA are past what either attempts. Every parse carries
`BANK-TYPE-025` for that reason.

## D5. A `CBL` statement — **measured**

GnuCOBOL reads `CBL` in column 1 as text in the sequence number area and reports
an invalid indicator in column 7. Every generated program opens with two of
them, stating the compiler options its behaviour depends on, so every local
compile goes through the precompiler to have them removed. The shipped artifact
keeps them.

## D6. A single-letter data name beside `RECORDING MODE` — **measured**

Every generated QSAM `FD` carries `RECORDING MODE IS F` or `V`. GnuCOBOL will
not then accept `V` as a data name in the same program; Enterprise COBOL will,
`V` being nowhere in Appendix E's reserved word table. This is the local
compiler being stricter than the target rather than a construct the target
refuses, and it only arises for a one-character record or field name.

## D7. `VALUE` on an `EXTERNAL` item — **measured**

Enterprise COBOL honours a `VALUE` clause on an elementary `EXTERNAL` item;
GnuCOBOL ignores it and leaves the storage at `LOW-VALUES`. Both failure
registers are `EXTERNAL`, so neither carries a `VALUE` clause and `BANK-MAIN`
sets both — otherwise `BANK-FAILURE-CODE NOT = SPACES` would be true before
anything had failed, on one of the two targets only.

## D8. `cobc -x` refuses `PROCEDURE DIVISION USING` — **measured**

"Executable program requested but PROCEDURE/ENTRY has USING clause". A batch
program that takes entry parameters reads them from the job's PARM, so it has a
USING clause; a Unix process has no parameter list to pass. z/OS says the same
thing the other way round, by having the initiator build one before the program
is entered.

Locally such a program is compiled as a module and driven from a generated
driver that builds the parameter list. The GnuCOBOL gate compiles it with `-m`.

## D9. `COMP` sizing and `SYNCHRONIZED` — **suspected**

Halfword, fullword and doubleword boundaries, and what `SYNC` skips to reach
one. BankLang emits IBM's allocation — 1–4 digits in two bytes, 5–9 in four,
10–18 in eight — and computes slack from it.

## D10. The `COMP-3` sign nibble on an unsigned field — **suspected**

And what `NUMPROC` does to a comparison against one. The generated program is
compiled `NUMPROC(NOPFD)`, which does not assume a preferred sign.

## D11. Collating sequence — **suspected**

EBCDIC ordering is not ASCII ordering. Any comparison of alphanumerics, any
`SORT` key, and any `88` level with a `THRU` range orders differently on the two.
`FEED-STATUS-OK VALUE "00" THRU "09"` is safe — digits are contiguous and in the
same order in both — but a range over letters is not.

The Language Reference is explicit for a sort: "When both the COLLATING SEQUENCE
phrase and the PROGRAM COLLATING SEQUENCE clause are omitted, the EBCDIC
collating sequence is used." BankLang emits neither, so an alphanumeric sort key
is ordered in EBCDIC on the target and in ASCII by both local engines. Every
alphanumeric ordering in `tests/sort-differential.test.ts` is therefore agreement
about ASCII and says nothing about z/OS; digits and uppercase letters keep their
relative order in both, and a key mixing them does not — digits sort before
letters in ASCII and after them in EBCDIC. The numeric key cases are unaffected,
because a numeric key is compared as a number on any target.

## D12. Sort work datasets and the sort product — **suspected**

The generated job allocates three `SORTWK` datasets, which is customary. Which
sort product runs, and what it wants, is a site's.

## D13. Reserved word lists — **suspected**

The two are close but not identical. BankLang mangles against the union, so a
name acceptable to IBM may still be mangled here — which is safe but visible.

## D23. A final line-sequential record with no delimiter — **measured**

GnuCOBOL 3.2.0 **does not deliver** the last record of a line-sequential file
when that line has no trailing newline _and_ its length exactly fills the record
area. It sets file status `06` and the record is lost.

```cobol
       FD  F.
       01  R PIC X(20).
```

```text
$ printf 'AAAAAAAAAAAAAAAAAAAA\nBBBBBBBBBBBBBBBBBBBB' > in.txt
REC 001 [AAAAAAAAAAAAAAAAAAAA]
STATUS 06
```

With a trailing newline both records arrive and the loop ends on `10`. With
records _shorter_ than the record area both arrive even without the final
delimiter, so the condition is specifically "unterminated and exactly the record
length".

Enterprise COBOL's Programming Guide describes the end-of-file case as "The
remainder of the record area is filled with spaces", which reads as delivering
the record. Whether it does has not been checked on the target.

The generated read loop tests the file status before using what it read, so a
BankLang program skips the record rather than processing a partial one — the
safe end of the difference. A program must not depend on a feed whose last line
lacks a delimiter.

Found by `tests/line-sequential.test.ts`, which pins the measured behaviour.

## D25. `DISPLAY` of `SORT-RETURN` — **measured, between the local two**

The Language Reference gives the register as `01 SORT-RETURN GLOBAL PICTURE
S9(4) USAGE BINARY VALUE ZERO`. GnuCOBOL 3.2.0 defines it wider: `DISPLAY
SORT-RETURN` after a failed sort prints `+000000016` there and `0016` under
`packages/cobol-runtime`, which holds the Reference's picture.

How wide an undeclared special register renders is implementation-defined and
IBM's answer is a third unknown, so neither local engine is wrong. The emitter
moves the value into a declared `PIC 9(4)` item and displays that instead —
the same rule it already follows for the result of an intrinsic (D22) — so no
generated program depends on it.

## D26. The order of records with equal sort keys — **deliberate**

Language Reference, `SORT` format 1: "If the DUPLICATES phrase is not specified,
the order of these records is undefined." A compiler whose claim is a
deterministic build must not emit a statement whose _output_ order the target
leaves open, so `WITH DUPLICATES IN ORDER` is emitted on every `SORT`. GnuCOBOL
3.2.0 happens to be stable without it, which is exactly the kind of agreement
that means nothing.

`MERGE` has no such phrase and needs none: equal keys come back in `USING`
order, which the Reference already fixes.

## D27. A sort does not set the file status under GnuCOBOL — **measured**

Under `NOFASTSRT` with a `FILE STATUS` clause and no `ERROR` declarative — which
is every program this compiler emits — the Programming Guide's table 32 says to
"test the `SORT-RETURN` special register after the format 1 `SORT` statement,
and test the file status key". GnuCOBOL 3.2.0 does not set that key for a
`USING` or `GIVING` file at all: probed directly, a successful sort leaves both
keys at their `VALUE SPACES`, and a sort whose input dataset is missing sets
`SORT-RETURN` to 16 and still leaves them at spaces.

Spaces are not in `"00" THRU "09"`, so the emitted `IF NOT ...-STATUS-OK` fired
on every successful sort: `task_func_13` and `task_func_38` were both recorded
as benchmark passes while ending with return code 16 and printing `SORT FAILED`
over correct output files. The check is now guarded by `NOT = SPACES` — the key
is declared `VALUE SPACES` and only an I/O operation writes it, so spaces means
the sort reported nothing through it. On a target that sets the key, `"00"` is
not spaces and the guard changes nothing.

---

## D24. Moving a blank zoned field — **measured, between the local two**

Where a line-sequential record is shorter than the record area, the remainder is
space-filled — so a numeric field the input never supplied holds spaces, which
is not a valid zoned number. `cobc` and `packages/cobol-runtime` then disagree
about what a `MOVE` of that field does:

|                          | Result                                   |
| ------------------------ | ---------------------------------------- |
| GnuCOBOL 3.2.0           | the spaces are carried through unchanged |
| `packages/cobol-runtime` | the field is normalised to `000000000+`  |

On the target this is a data exception — S0C7 — and neither answer is right;
Enterprise COBOL would abend rather than produce either. It is the defect class
OpenCBS records as DF12, DF19, DF28 and DF41, and the reason BankTS refuses to
move a `string` into a `decimal` at all.

BankLang cannot rule it out statically, because the invalid bytes come from
outside the program. What it can do is what it already does: the record layout
is declared, the file status is checked, and a program reading a feed whose
records may be short should test the field it depends on rather than assume it.

`tests/line-sequential.test.ts` asserts only the behaviour the two engines agree
on, so this difference does not silently become an assertion that either is
correct.

---

## D22. `DISPLAY` of a bare intrinsic — **measured, between the local two**

`DISPLAY FUNCTION ORD(X)` prints `000000109` under GnuCOBOL and `109` under
`packages/cobol-runtime`. How wide the intermediate result of an integer
function is, and so how a `DISPLAY` of one renders, is implementation-defined:
neither is wrong and IBM's width is a third unknown.

Nothing generated does this — the emitter moves a function result into a
declared item before displaying it, which is defined — so no example is
affected. `tests/runtime-semantics.test.ts` follows the same rule rather than
pinning either width, and `runtime/*.cbl` should too.

---

## D28. `DISPLAY` of an assumed decimal point — **suspected**

A `V` occupies no storage: `PIC 9(4)V99` is six digit characters and the point
is a property of the picture, not a byte in the field. What a `DISPLAY` of such
an item sends is the question, and the two local engines agree on an answer that
Enterprise COBOL may not share.

```cobol
01  WS-V   PIC 9(4)V99  VALUE 12.34.
01  WS-P   PIC 9(4)V99  COMP-3 VALUE 12.34.
01  WS-S   PIC S9(4)V99 VALUE -12.34.
    DISPLAY "V=" WS-V
    DISPLAY "P=" WS-P
    DISPLAY "S=" WS-S
```

|                          | `V=`      | `P=`      | `S=`       |
| ------------------------ | --------- | --------- | ---------- |
| GnuCOBOL 3.2.0           | `0012.34` | `0012.34` | `-0012.34` |
| `packages/cobol-runtime` | `0012.34` | `0012.34` | `-0012.34` |

Both insert a point the field does not contain, and the signed case a sign it
does not contain either. Reading the Language Reference on the `PICTURE` clause,
the item holds six digits and nothing else, which would make the Enterprise
COBOL rendering `001234` — but that is an inference from the storage definition,
not a measurement, and this entry stays **suspected** until Enterprise COBOL
compiles it.

**It is cheap to check and worth checking**, because the two engines agreeing is
what normally ends an investigation here. `tests/cobol-runtime-differential.test.ts`
compares this interpreter against `cobc` and would report nothing: they agree,
and both may be wrong about the target together. That is the one shape of defect
the differential comparison is structurally blind to.

Nothing is affected today. No generated program displays a named field at all —
checked across every example — and the reference runtime in `runtime/` displays
none either, for the same reason D22 records: a value bound for a report is
moved into an edited item first, and how _that_ renders is defined by its
picture. So the exposure is a hand-written or migrated program that displays a
scaled field directly, and `tests/interpreter-machine.test.ts` scales such
values to whole numbers rather than pinning either rendering.

---

## Deliberate differences

### D14. `NOSSRANGE`, and a generated bounds check instead

`SSRANGE` would range-check every subscript for free. The generated program
checks its own and fails the step with a named failure instead, because
`SSRANGE` abends rather than setting a return code the next step's `COND=` can
read, and because it is a compile option — a program built without it silently
loses the checking, where a check in the source cannot be switched off by a JCL
change.

### D15. No floating point

`COMP-1` and `COMP-2` exist in the target and are not in the language. A bank's
arithmetic is decimal, and binary floating point cannot represent 0.10. The
copybook and DCLGEN importers refuse a floating-point column rather than
approximating it.

### D16. No `ALTER`, no `GO TO` the source can write, no `PERFORM THRU` a range

the source chose

The one `GO TO` in a generated program is the failure path, and it goes to the
enclosing routine's exit. `ALTER` is not emitted at all.

### D17. Five rounding modes are generated arithmetic

Enterprise COBOL has one rounding phrase and `ROUNDED` is half-up away from
zero. `HALF_EVEN`, `HALF_DOWN`, `UP`, `CEILING` and `FLOOR` are written out as a
truncation, the excess that truncation discarded, and a conditional step of one
unit in the last place. See [numeric-model.md](numeric-model.md).

### D18. `FILLER` is `reserved <n>;`

BankTS declares bytes nothing names as `reserved 20;`, which emits
`FILLER PIC X(20)`. The importer counts bytes rather than digits — a
`PIC S9(9) COMP-3` filler is nine digits and five bytes — and refuses a copybook
whose fillers it cannot size, because a record one byte short moves every field
after it.

Nothing can read a reserved slot, assign to it, or move a record through it.
`FILLER` is not a name in COBOL either.

### D19a. A host-variable array is passed by its first element locally

The real Db2 precompiler generates a call that passes a host-variable array by
address. `packages/precompiler` passes `NAME (1)` instead, because a COBOL
`CALL ... USING` naming an item with an `OCCURS` and no subscript is a compile
error and the subset has no address-of.

What the local compile establishes is unchanged: that the operands resolve and
are the types the statement needs, the first element being the same type as the
rest. What ships to z/OS keeps the `EXEC SQL FETCH NEXT ROWSET` exactly as
written, and `DSNHPC` generates the real call.

`runtime/DSNHLI` writes host variables. A script beside the program gives the
bytes of each one, keyed by the statement number, the call, the row within that
call, and the variable's position in the generated `CALL`; the stub moves them
into the storage the caller passed and sets `SQLERRD(3)` to the number of rows
that call delivered. Passing the array by its first element turns out not to
cost anything here: `CALL ... USING` passes by reference, so the first element's
address is the array's, and each row lands one element further along.

**A rowset loop is therefore executed**, including the property that makes the
feature worth having — three rows over a rowset of two is one full set and one
partial one, and every row is processed exactly once.
`tests/conformance.test.ts` asserts the count under `cobc` and under the
interpreter, and the `SQLERRD(3)` of the call that ends the cursor is zero
rather than the previous call's count, which is what stops the last set being
read twice.

This paragraph previously read "no rowset loop in this repository has been
executed", on the reasoning that the local runtime could not set `SQLERRD(3)`.
It could: the SQLCA is its first parameter.

What remains true is that it is a stub. It parses no SQL, binds no plan, and
knows nothing about a row beyond the bytes the script names — so what is
established is that the generated loop handles the rowset protocol correctly,
not that Db2 would return these rows for this query.

### D19. No varying-length string

Db2's `VARCHAR` is a group of two level-49 items, a halfword length and the
text. There is no BankTS declaration for one, so `bankc dclgen import` reports
the column.

### D20. A generated zUnit driver compiles against a stand-in `EQAITERC`

The driver declares its info block as `01 AZ-INFO-BLOCK. COPY EQAITERC.`,
because that is what IBM's own generator writes and what resolves on z/OS from
the IDz copybook library. That copybook is not in this repository, so a local
compile has nothing to resolve — and
[`runtime/zunit/EQAITERC.cpy`](../runtime/zunit/EQAITERC.cpy) declares the two
fields the driver names, `ITER` and `TC-WORK-AREA`, and nothing else. Inventing
the rest would be a claim about a layout nobody here has seen.

What the compile establishes is therefore narrow: the driver's syntax is
accepted under both dialects and every name in it resolves. It establishes
nothing about the info block's offsets, and **no generated case has been run**,
locally or on z/OS. `pnpm bankc zunit` output is graded "compiled" for that
reason.

The artifact that ships is unaffected: it carries `COPY EQAITERC`, exactly as
IBM's generator writes it.

### D21. `noPlaybackData="true"` is inferred

A generated case supplies its data in the driver rather than replaying a
recording, so it writes `<runner:playback moduleName="…"/>` with no file and
sets `noPlaybackData="true"` on each test.

The attribute is in the 4.0.0.0 configurations observed, and every one of them
carries `false` — because every one of them has a recording. Nothing public
carries `true`, so the value is read from the attribute's name and from the
3.0.0.0 case that has an empty `<runner:playback>` element and no such attribute
at all.

If a runner refuses it, the fallback is `noPlaybackData="false"` with the same
empty `playback` element, which is the 3.0.0.0 shape. One real run settles it.

---

## What closing these looks like

[zos/README.md](../zos/README.md) is the kit: `pnpm zos:kit` writes every
program, copybook and job in the member names the JCL expects, and
`RESULTS-TEMPLATE.md` is what to fill in. A finding that contradicts something
this repository claims is the most valuable thing that exercise can produce.
