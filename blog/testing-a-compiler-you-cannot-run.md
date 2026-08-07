---
title: Testing a compiler whose target you cannot run
description: You can compare bytes against a fixture, but a fixture only proves the output has not changed. Here is how to find out whether it is right.
date: 2026-08-03
author: Md Wahid Hassan
related: reading-code-you-did-not-write, rounding-money-is-harder-than-it-looks
reading: verification.md
---

Suppose you have written something that produces mainframe COBOL, and no
mainframe. This is not an unusual position. Access to z/OS is expensive and
mostly institutional, and plenty of useful work happens without it.

The question is what you can honestly claim, and the answer depends entirely on
what you compare against.

## The weakest check that feels strong

The first thing everyone does is record the output and compare against it next
time. Golden files, snapshots, approval tests: same idea under different names.

They are genuinely useful. They catch unintended changes, which is most changes,
and they make a diff the unit of review.

They also prove nothing about correctness. A golden file says the output has not
changed. If the output was wrong when it was recorded, the test now defends the
bug and fails whenever somebody fixes it. Everybody knows this and everybody
forgets it, because a wall of green is persuasive.

The tell is when a golden file gets updated with a commit message like "update
snapshots". That is a behaviour change with no reasoning attached, and it is
exactly the moment a defect gets locked in.

## Does it compile

The next step up is to feed the output to a compiler. For COBOL off z/OS that
usually means GnuCOBOL, which is a real compiler and not a toy.

This rules out a lot: undefined names, type mismatches, statements the target
would reject. It is a much stronger check than a fixture, and it is where most
projects stop.

There is a trap in it, and it is worth naming because it is easy to fall into.

GnuCOBOL is not IBM's compiler. It accepts a wider language, its defaults differ,
and unless you tell it otherwise it will read a fixed format program as free
format, where none of the column rules apply. So a program whose every other line
runs past column 72 can pass local validation and be uncompilable on the target,
because the target reads only the first 72 columns and quietly truncates the rest.

The fix is to configure the local compiler to the dialect you are actually
targeting, and to say clearly, everywhere, that a local compile is not validation
against IBM's compiler. It is evidence about a different compiler that happens to
read a similar language.

## Does it run

Compiling proves the program is well formed. It proves nothing about what it
computes.

Two defects from this project's own history make the point, and both passed every
static check.

The first was a bounds guard on an array subscript. It was supposed to refuse an
out of range index. It clamped it instead, so the statement ran against the wrong
element and produced a plausible wrong answer. Compiles fine. Looks fine.

The second was recursion. A recursive program returned 5 for 5 factorial, because
COBOL's working storage is shared across invocations and the nested call
overwrote its caller's locals. Compiles fine. Answer is wrong by a factor of 24.

Neither is visible without running the program. So you run it, which means the
program needs something to call: a ledger, an audit log, a database interface. The
way to do that is to write small reference programs that honour the calling
convention and record what happened, then assert on the balances, the journal and
the order of calls.

That is a large step up in what a green build means. It also has a limit worth
being explicit about: a reference ledger is not a bank's ledger. What running
establishes is that the generated logic does what the source said, not that the
institution's system will accept it.

## Comparing against a second implementation

There is one more level, and it is the one that finds the defects the others
cannot.

Write the thing twice, differently, and require the two to agree.

For arithmetic this means an oracle: compute the answer with exact rational
arithmetic that shares no code with the implementation, and compare across every
boundary case rather than a chosen few. Every rounding mode, both signs, values
just above and just below each half. If they disagree, one is wrong and you find
out which.

For whole programs it means running them two ways. Compile with a real compiler
and execute the binary. Then interpret the same generated source with a separate
implementation and execute that. Compare the return code, everything the program
displayed, the ledger it wrote and the audit trail it left. Any difference fails.

The value here is that neither implementation is trusted. A test with expected
values is only as good as the person who worked them out; two implementations
that disagree are a fact, and it does not matter which one you believed.

Doing this on the whole corpus turned up four things nothing else had. Two files
of the reference runtime were documented as part of it and missing from the list
the harness compiled, so a program calling them could be built and never linked.
The dynamic loader was never told to preload a runtime file holding several
programs, so five of its six entry points were unreachable by name and one example
had never been executed at all. And no program taking entry parameters had ever
been run, because the local compiler refuses to build a main program with a
parameter list and nothing supplied one.

None of those was a compiler bug. All four were holes in the evidence, and all
four looked like passing tests.

## What none of it establishes

Being blunt about the ceiling.

Everything above happens on a developer machine and in continuous integration.
None of it is IBM Enterprise COBOL. A dialect configuration shaped towards the
target is a serious effort to close the gap and it is not the same as closing it,
because the gap is precisely the behaviour that only the real compiler defines.

The honest position is to name the levels and say which one each claim sits at.
Something that is compiled locally is not something that is executed. Something
that is executed against a reference runtime is not something that has run in
production. And nothing local is validation against the vendor's compiler.

Writing that down, per example, in a table anybody can read, costs an afternoon
and is the difference between evidence and marketing.
