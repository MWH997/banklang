# Horizontal validation

How this compiler is measured against COBOL that was not written for it.

The results are in
[horizontal-validation-results.md](horizontal-validation-results.md) and the
defect matrix in
[horizontal-defect-coverage.md](horizontal-defect-coverage.md). Both are
generated from `evidence/horizontal/` by `pnpm horizontal:report`; neither is
edited by hand.

## Why

Everything else in this repository is **vertical** validation: thousands of
tests written for BankLang, run against BankLang, passing because the compiler
does what the person who wrote the test expected. That includes the strongest
checks here — the differential lane that executes every example twice, once
through `cobc` and once through an independently written interpreter, and the
mutation lanes that ask whether the tests would notice if the code changed.

They share one blind spot. A misunderstanding shared between a test and the
code it tests agrees with itself perfectly. No amount of internal testing can
tell you what happens when the compiler meets a program nobody wrote for it, or
whether the subset of COBOL the language covers is the subset the world
actually uses.

So this axis asks a different question:

> What happens when BankLang is confronted with independent COBOL programs,
> specifications and behaviours that were not designed around it?

## The corpora

| Corpus                                                                          | What it is                                                    | What it can establish                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [CobolCodeBench](https://huggingface.co/datasets/harshini-kumar/CobolCodeBench) | 46 tasks specified in prose, with inputs and expected outputs | Whether BankTS can independently express a program somebody else specified |
| [COBOLEval](https://github.com/zorse-project/COBOLEval)                         | 146 HumanEval tasks transpiled to a fixed COBOL interface     | Whether BankTS can meet a calling contract it did not choose               |
| [X-COBOL v2](https://zenodo.org/records/14269462)                               | 5,195 files from 168 open-source repositories                 | What real COBOL contains, and how much of it BankTS can represent          |
| [OpenCBS](https://github.com/PhaseChangeSoftware/cobol-defects-suite)           | 43 defects reconstructed from developer forum posts           | Which real defects BankLang refuses at compile time                        |
| NIST COBOL-85                                                                   | The standard's own validation suite                           | Whether the COBOL compiler _underneath_ BankLang conforms                  |

Every corpus is pinned in `validation/corpus-lock.json` by revision and by the
sha256 of every file. A cache whose bytes do not match the lock is refused
rather than measured, so a number cannot change because upstream did.

### Licensing

"Open source" is not "public domain", and a dataset that gathers other people's
repositories does not relicense them by gathering them. X-COBOL is published
CC-BY-4.0 and contains files from 168 repositories, none of which agreed to
that; the licence covers the compilation. So it is marked `derived-only`: the
source stays in an ignored cache and only measurements, hashes and provenance
are published. `packages/horizontal-validation/src/licence.ts` is the gate, and
an unrecognised licence is recorded as `excluded-license-unknown` rather than
guessed at.

NIST's suite is never downloaded and never redistributed. An operator points
`BANKLANG_CCVS85_DIR` at their own copy or the lane reports unavailable — which
is not the same as passing.

## Rules the measurement is held to

**No model in the validation path.** Development here is AI-assisted and says
so. Once a fixture is checked in, the path from benchmark to result —
BankTS, `bankc`, COBOL, execution, comparison — is deterministic code. No API
call, no LLM judge, no "the programs look equivalent".

**Execution beats text similarity.** Generated COBOL is never scored against
reference COBOL by resemblance. Two programs can differ in every line and
compute the same thing, and BankLang's output differs from a hand-written
solution by construction. What is compared is observable behaviour: the bytes in
the output files, what was displayed, the return code.

**Denominators are never gamed.** Every rate is reported twice — against the
tasks BankTS can express, and against every task the corpus contains. A
difficult case is never removed; it is classified, and the classification is
reported. `checkTallyIsComplete` fails the run if the categories do not
partition the corpus.

**Unsupported is neither pass nor fail.** `unsupported-by-design` is BankTS
working as intended; `unsupported-not-yet-implemented` is a to-do list;
`not-yet-authored` means the task is expressible and nobody has written it, and
it counts against the pass rate exactly as a failure would. Collapsing these
would let every missing feature be relabelled a principle.

**No benchmark-specific compiler paths.** Nothing in the compiler knows a
benchmark's name. A fix found this way must generalise and must arrive with a
minimal regression test.

**External code is untrusted.** No script shipped by a corpus is ever executed —
not a setup script, not a makefile. Archives are unpacked and read. Paths from a
corpus go through `safeJoin`, which refuses absolute paths, traversal and NUL
bytes; runs happen in a scratch directory with an environment built from
scratch rather than inherited, so a benchmark never sees a CI token.

## Contamination control

Both semantic corpora ship the answer beside the question. CobolCodeBench
carries the full reference COBOL and a COBOL skeleton; COBOLEval carries a COBOL
prompt and its test drivers. A BankTS implementation written with those on
screen would measure transliteration.

So `pnpm horizontal:materialise` splits every record in two:

```
validation/tasks/<corpus>/<id>/spec.json   prose, inputs, expected outputs
validation/sealed/<corpus>/<id>/…          the benchmark's own COBOL
```

The spec is committed and is what an implementation is written from. The sealed
half is derived from the ignored cache, is itself ignored, and is read by the
evaluator — never by the author. `SpecOnlyTask` cannot carry reference COBOL
because the type has no field for it.

**What that does and does not guarantee.** It guarantees the normal path to
writing an implementation does not show the reference, that no committed file
contains it, and that a reader can see exactly which bytes sat on the authoring
side of the line. It does not guarantee that the agent which wrote the BankTS
never read the sealed file — no repository layout can. That limit is stated
here rather than glossed.

## What it found

Three things, and the second and third are the argument for doing this at all.

**A representability boundary nobody had measured.** Of 5,195 real COBOL files,
the reader handled every one without error, and the constructs BankTS cannot
express turn out to be led by `go-to` and `perform-thru` — present in roughly
half the corpus — with `inspect`, `file-relative` and line-sequential files as
the largest genuinely missing features. That is a to-do list ordered by evidence
instead of by whoever asked most recently.

**A support rule that was wrong in the flattering direction.**
`file-line-sequential` was marked `supported` because `LINE SEQUENTIAL` appears
in this repository — in five hand-written reference modules under `runtime/`,
never from the emitter. BankTS has `sequential`, `indexed` and `relative`, and
every generated FD is `RECORDING MODE IS F`. The error was found by trying to
implement a CobolCodeBench task and having nowhere to put the input, and it had
been inflating the representability figure by 155 files.

**A compiler defect.** Writing COBOLEval's `is_prime` from its specification
needs a conditional inside a trial-division loop, in a function. That was
refused with `BANK-TYPE-007` while a `switch` in exactly the same position
compiled — the inconsistency this repository had already identified as "an
oversight rather than a rule" and fixed _for transactions only_. Nothing
internal noticed, because every example that branches inside a loop is a
transaction. Fixed, with the regression in
`tests/horizontal-defects.test.ts`.

## What was decided against the evidence

The point of measuring a corpus is to let it choose what gets built. Four
decisions came out of this one, and two of them are decisions _not_ to build
something.

**Line-sequential files: implemented.** 309 of 5,195 real files use the
organisation, and all 46 CobolCodeBench tasks read newline-delimited text — the
single construct that made an entire independent benchmark inexpressible. It is
also a legitimate banking feature rather than a benchmark artefact: a payment
feed, a reconciliation extract, an import from a counterparty. Implemented with
the restrictions Enterprise COBOL puts on it, which turned out to be the
valuable part — a text record may hold only DISPLAY items, and BankTS's default
`decimal` is packed, so `BANK-FILE-014` catches a class of silently-wrong file
nobody would have found until they opened one.

**`GO TO` and `PERFORM THRU`: deliberately not implemented.** The two most
common constructs BankTS does not offer — 47.6% and 46.1% of the corpus — and
frequency is the whole of the argument for them. They are legacy control flow;
reproducing them would mean a source language whose control flow cannot be read
from its text, which is the property ADR-0001 exists to protect. Both stay
classified `adaptation`: a program built on them is expressible in BankTS and
has to be restructured into functions and conditionals. See D16 in
[divergences](../divergences.md).

**`USAGE INDEX`: deliberately not exposed.** 8.7% of files declare one, which is
enough to look. Looking is what settled it: 11,499 `INDEXED BY` clauses attached
to an `OCCURS` against **98** standalone index items — less than one percent. An
index is machinery for walking and searching a table, and BankTS already has
`for each` and `search`, which the backend compiles into exactly that machinery.
Handing the programmer a raw offset with no bounds attached would reintroduce
the OpenCBS `table-bounds` family that `BANK-TYPE-009` currently refuses.
[ADR-0005](../adr/0005-no-index-type.md) records the decision and the numbers to
reverse it on.

**A callable-program ABI: justified, and not built in this phase.** COBOLEval
stays at 0/146, and the reason is worth separating from the benchmark. 688 files
— 13.3% of the corpus — are genuine called subprograms with both a `LINKAGE
SECTION` and `PROCEDURE DIVISION USING`, and 774 issue a static `CALL`. That is
real integration evidence: a shared subroutine called by many programs is
ordinary on an estate, and BankLang can call out today but cannot be called in
except through `entry transaction`, which requires an idempotency key and an
audit event in the caller's own record.

So a callable program is a shape BankLang plausibly needs. It is not built here,
for two reasons. It is a whole programme shape — parser, entry contract, ABI,
JCL, zUnit — rather than a feature, and building it in the same phase that
measured COBOLEval would be indistinguishable from building it _for_ COBOLEval.
The honest zero stands, and the evidence that would justify the work is recorded
rather than spent.

## Where the string operations actually stand

The 2026-08-08 phase went looking for reference modification, STRING,
UNSTRING and INSPECT as missing features. All four already existed:
`substring`, `concat`, `split ... by ... into`, `countOf` and
`replaceChars`, each lowering to the COBOL verb you would expect. What was
missing was an accurate account of how much of the real usage they cover, so
`string-usage.json` now measures the _forms_ rather than the keywords.

| Construct              | Corpus                                                                         | BankTS covers                                                     | Verdict                                                  |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| reference modification | 661 files; 62,716 constant-bound occurrences, 8,875 with a computed bound      | constant bounds only, every out-of-range constant a compile error | `adaptation` — 194 of 661 files use only constant bounds |
| STRING                 | 973 `DELIMITED BY SIZE`, 518 by a value, 470 `WITH POINTER`                    | `concat`, which is the SIZE form                                  | `adaptation`                                             |
| UNSTRING               | 262 single-delimiter, 58 multiple, 95 `WITH POINTER`, 130 `TALLYING`           | `split`, one delimiter into fixed receivers                       | `adaptation`                                             |
| INSPECT                | 1,007 `TALLYING`, 780 `REPLACING`, 105 `CONVERTING`, 625 with `BEFORE`/`AFTER` | `countOf` and `replaceChars`                                      | `adaptation`                                             |

Only one rule was wrong: `inspect` said "No BankTS syntax", which moved 182
files out of `not-yet-implemented` when corrected. The other three keep their
verdicts and gain the measurement behind them.

`substring` refusing a computed bound is the reason reference modification
stays `adaptation`, and it is a deliberate trade rather than an omission. Every
out-of-range constant is `BANK-TYPE-003` at compile time and there is no
dynamic case to guard at run time — which is a stronger guarantee than a
bounds check, and it costs the 451 files that compute an offset.

## What is next, on the same evidence

The tasks CobolCodeBench still cannot express are not blocked on files any more.
They are blocked on strings: picking a delimited field out of a line, testing
whether a name contains a digit, replacing an extension. In corpus terms that is
`reference-modification` (11.5%), `string-unstring` (7.6%) and `inspect` (5.2%)
— the next three by frequency after the two control-flow constructs that are
deliberately excluded, and the three the benchmark independently demands.

They are not implemented here. Reference modification in particular needs its
bounds semantics settled before any syntax is chosen — one-based offsets,
dynamic lengths, and what happens at a bad bound, on a compiler that has already
had one bounds defect found by differential testing.

## Running it

```sh
pnpm horizontal:fetch          # once, into an ignored cache, pinned by the lock
pnpm horizontal:materialise    # split specs from reference solutions
pnpm horizontal:analyse        # X-COBOL and OpenCBS: what real COBOL contains
pnpm horizontal:run            # the semantic corpora, executed
pnpm horizontal:ccvs85         # local-only, reports unavailable without a copy
pnpm horizontal:report         # regenerate the two published pages
```

The ordinary suite runs none of this. `tests/horizontal-validation.test.ts` and
`tests/horizontal-defects.test.ts` check the framework and the compiler's
refusals from checked-in fixtures, and read no corpus at all — a validation lane
that depended on somebody else's server being up would report a compiler defect
whenever the network was slow.

## What none of this establishes

BankLang targets **IBM Enterprise COBOL 6.4** and is runtime-validated with
**GnuCOBOL**. Every executed result here was produced by GnuCOBOL. **Native IBM
Enterprise COBOL validation has not been performed**, and nothing on these pages
should be read as evidence about behaviour under IBM's compiler. See
[divergences.md](../divergences.md) for where the two are known to differ.

A representability figure is a statement about language scope, not about
correctness: X-COBOL ships no expected output, so nothing measured against it
can establish that any program computes the right answer.
