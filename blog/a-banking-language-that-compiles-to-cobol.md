---
title: A banking language that compiles to COBOL
description: BankLang 0.10.0 compiles a small banking language to readable IBM Enterprise COBOL, refuses unsafe financial programs at compile time, and publishes what it has not validated.
date: 2026-08-09
author: Md Wahid Hassan
related: a-compiler-that-refuses-to-build, testing-a-compiler-you-cannot-run
reading: validation/horizontal-validation.md
---

The obvious thing to do about COBOL is to get rid of it. Every few years
somebody announces a tool that reads a mainframe estate and writes Java, and the
result is a codebase nobody wrote, nobody reviewed, and nobody can point at when
the overnight batch posts the wrong number. The output is the problem: it is
correct or it is not, and the only way to find out is production.

BankLang 0.10.0, released today, does the opposite. It keeps COBOL as the
output and moves the safety earlier.

BankTS is a small language with TypeScript's type syntax and statements of its
own — `transaction`, `file`, `cursor`, `queue`. It compiles to COBOL a mainframe
engineer can read in review, targeting IBM Enterprise COBOL 6.4. It is not a
converter and there is no model anywhere in it: every byte of output comes from
deterministic code, and the same input always produces byte-identical artifacts.

## The compiler refuses to build unsafe programs

Here is a transfer. It has three defects, and none of them is a syntax error:

```ts
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}
```

There is no idempotency key, so a retried message posts twice. There is no audit
event, so nothing records that money moved. And the debit and the credit are
different amounts, so the books do not balance. A general-purpose compiler
accepts all three, because it has no idea that `amount` is money or that this
function is supposed to leave a ledger consistent.

BankTS knows both, so it refuses:

```txt
BANK-TXN-001  Transaction postTransfer has no idempotency key.
BANK-AUD-001  Transaction postTransfer does not emit an audit event.
BANK-LED-001  Transaction postTransfer does not balance:
              debited request.amount against credited request.fee.
```

The same applies to a division with no stated rounding mode, a `SQLCODE` test
that cannot tell an error from a missing row, and a field marked `sensitive`
reaching an audit event. Each is a compile error rather than a production
incident, and each has a catalogue entry `bankc explain` will print.

## Rounding is where money languages are decided

Enterprise COBOL has exactly one rounding phrase, and `ROUNDED` means half-up
away from zero. Banker's rounding — round half to even, which is what a great
deal of financial arithmetic actually requires — is not a mode you can ask for.
It is arithmetic the compiler has to write out:

```cobol
           EVALUATE TRUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) > 0.005
                   ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) = 0.005
                   IF FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1
                       ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
                   END-IF
           END-EVALUATE
```

That sequence is executed against exact arithmetic over every boundary case, for
a product and a quotient, in all seven modes. Storing a scale-6 product in a
scale-2 money field discards four digits, and the compiler will not do it
silently: an explicit `round` with a named mode is required.

## What the corpora said, including when they said no

The part of 0.10.0 that took longest is not a feature. It is measurement against
COBOL nobody wrote for this compiler: 5195 files from 168 open-source
repositories, a semantic benchmark whose expected outputs are somebody else's, a
reconstructed defect suite, and the NIST conformance material. Each is pinned to
a revision with per-file checksums, and none of it is redistributed here.

Those measurements changed the language, and the interesting cases are the ones
where the answer was no.

`lineSequential` exists because 309 of the 5195 files needed it. Multi-record
`INPUT` does not, and that decision is the one worth describing. The raw count
said 143 file descriptions used it — enough to look like a gap. Deduplicating by
content brought it to 51 distinct files, and reading those 51 found parser
fixtures, sixteen copies of the same NIST conformance program, and fourteen
teaching examples. No application program. The feature stayed refused, and
`BANK-FILE-015` says so with the measurement behind it.

Bounded split counting went the same way: 126 of the 130 `UNSTRING … TALLYING`
statements in the corpus came from one conformance file vendored into several
repositories. A number is not evidence until you have looked at what it counts.

## What has been validated, and what has not

Every example is executed, not merely compiled — by `cobc` and by an independent
interpreter written against the same emitted output, with any disagreement
failing the build. That is what catches the defect that compiles: a bounds guard
once clamped an out-of-range subscript instead of refusing it, and every static
check passed.

The numbers, all generated from committed evidence rather than typed: 3217
tests; 25 example projects; 27 of the 31 emitted COBOL verbs executed by both
engines with zero blind spots; 19 of 46 CobolCodeBench tasks passing
whole-corpus, which is 19 of the 19 that BankTS can express at all; 20 executed
tasks, 20 engine agreements, zero divergences; 5195 X-COBOL files analysed with
zero analyser failures.

And the denominators are the honest ones. The four verbs that are not executed
locally are named — a generated zUnit test case's entry points and a Report
Writer section, neither of which has anywhere local to run. On the OpenCBS
defect suite, nine of 41 defects have a BankTS program the compiler refuses;
that is not a claim that BankLang prevents 22% of COBOL bugs, because 31 of the
remaining 32 are recorded as not demonstrated rather than as failures, and the
last one cannot be written in BankTS at all.

Then the part that matters most:

**No BankLang program has been compiled by IBM Enterprise COBOL.** Runtime
validation is GnuCOBOL 3.2.0, which is a different compiler with a different
reading of the same source. Nothing here has been precompiled by DSNHPC, bound
to a Db2 package, or started in a CICS region. Native IBM Enterprise COBOL
validation has not been performed.

That gap is not going to be closed by writing more tests, so 0.10.0 ships the
next best thing: a deterministic bundle of every generated program, copybook and
JCL stream in the member names the JCL expects, with expected results and a
form to fill in. Somebody with z/OS access can run it without reverse-
engineering this repository, and the report generator will not print an IBM
validation claim unless a real result file has been imported.

The compiler runs entirely in your browser at
[the playground](https://banklang.mwhassan.com/playground/) — there is no
compile server, and nothing you write is sent anywhere. AI assisted the writing
of this compiler. It is not part of it.
