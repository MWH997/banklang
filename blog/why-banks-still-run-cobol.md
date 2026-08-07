---
title: Why banks still run COBOL, and why rewriting it keeps failing
description: The reasons a bank's core systems are still COBOL are not technical nostalgia. They are about risk, and they explain why the big rewrites stall.
date: 2026-08-07
author: Md Wahid Hassan
related: a-compiler-that-refuses-to-build, reading-code-you-did-not-write
reading: status-and-limits.md
---

Every few years somebody announces that a bank is finally getting off COBOL.
Every few years the announcement is quietly followed by a smaller one saying the
programme has been re-scoped. It happens often enough that it is worth asking
what the actual obstacle is, because it is not that nobody has thought of
rewriting the code.

## What the code is really holding

A retail bank's core system does a small number of things an enormous number of
times. It posts an amount to an account. It works out interest. It writes a line
to a ledger and another to an audit trail. It reads a file of last night's
transactions and produces a file of this morning's balances.

None of that is difficult in the sense that a compiler or a database is
difficult. What makes it hard is that it has to be exactly right, every time,
and that "exactly right" has accumulated thirty years of specifics. A rounding
rule that applies to one product and not another. A branch code that means
something different after 1998. A field that was reused for a purpose nobody
wrote down.

The COBOL is not valuable because it is COBOL. It is valuable because it is the
only complete statement of what the bank actually does. The specification and
the implementation are the same artifact, and they have been kept in step by the
simple fact that there is only one of them.

## Why a rewrite is harder than it looks

The usual plan is to rewrite the core in a modern language, run the two side by
side, and switch when they agree. This is a good plan. It runs into three things.

**The old system has no test suite.** It has thirty years of production, which
is much better evidence than a test suite and much worse to work with. You
cannot ask it what it does with an edge case; you can only look for a day when
that case happened and see what it did.

**Nobody can enumerate the behaviour.** Not because the people are not good, but
because the behaviour is not written down anywhere except in the code, and the
code is large. A team can read it. A team cannot read all of it and hold it at
once, which is what a rewrite needs.

**The two systems have to agree to the penny.** Not approximately. A rounding
difference of one hundredth of a currency unit, on a few million accounts, on a
day when interest is applied, is a reconciliation break that somebody has to
explain to a regulator. And rounding is exactly where two independently written
systems differ, because there are seven reasonable ways to round a half and most
languages pick one without telling you.

So the rewrite stalls somewhere in the middle: the new system works for the
common cases, disagrees on a long tail nobody can fully enumerate, and the
switch date moves.

## The uncomfortable middle option

There is a third position between "keep the COBOL forever" and "rewrite it in
something else", and it gets less attention because it is less satisfying.

Keep producing COBOL. Change what produces it.

If the source of truth becomes something smaller and more explicit, and a
compiler turns that into the COBOL that actually runs, then several problems
change shape at once. The bank still runs COBOL, so the operational risk of the
switch is much lower. The people who review the output are still reading COBOL,
which is what they know. But the thing a developer writes and reviews is a
program in a language where the dangerous mistakes are harder to make.

This only works if two conditions hold, and both are demanding.

**The generated COBOL has to be readable.** Not "technically valid". Readable by
somebody who has to sign it off, with paragraph names that mean something and
comments that say where each part came from. Most code generators fail here, and
the failure is fatal: an unreviewable artifact is one nobody will take
responsibility for, and in a bank somebody has to.

**The generation has to be deterministic.** The same input must produce the same
bytes, every time, on every machine. If it does not, then the artifact that was
reviewed and the artifact that was deployed are two different things, and the
review meant nothing.

## What that buys you

The interesting part is not the translation. Turning one language into another
is well understood, and if that were all this was, it would be a curiosity.

The interesting part is what a compiler can refuse.

If the source language knows what a ledger posting is, the compiler can decline
to build a transaction whose debits and credits do not balance. If it knows what
a unit of work is, it can decline to build one with no idempotency key, which is
the defect that makes a retried payment post twice. If it knows which fields are
personal data, it can decline to build a program that writes one of them to a
log.

Each of those is a bug class that currently gets caught by a person: a reviewer
who knows to look, an auditor reconciling afterwards, a customer complaining. A
person catches most of them. A compiler catches all of them or fails the build.

That is a narrower claim than "we have modernised the core", and it is a claim
that can actually be checked.

## Where this gets hard

It would be dishonest to stop there, so here is the other side.

A restricted language is restricted. It cannot express everything a general
purpose language can, and that is the point, but it means some programs have no
translation and have to stay as they are. A tool that handles seventy per cent of
an estate is useful; a tool that claims to handle all of it is lying.

Generated code has a provenance problem. When something goes wrong at three in
the morning, the person looking at the abend needs to get from a line of COBOL
back to the line of source that produced it, quickly and without guessing. That
means a real source map, shipped with the artifact, not a best effort.

And a compiler that produces mainframe code has to be validated against the
mainframe compiler, not against a lookalike. Anything else is a claim with a gap
in the middle of it, and the gap is where the surprises live.

None of these are reasons not to try. They are the things that decide whether
trying works.
