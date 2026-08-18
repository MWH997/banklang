---
title: Reading code you did not write, and did not want
description: Generated code arrives on somebody else's desk to be reviewed and supported. What makes it acceptable has almost nothing to do with whether it works.
date: 2026-08-04
author: Md Wahid Hassan
related: why-banks-still-run-cobol, testing-a-compiler-you-cannot-run
reading: generated-code-standards.md
---

The moment that decides whether a code generator gets used has nothing to do
with the technology. Somebody who did not choose the tool opens its output and
decides whether they are willing to be responsible for it.

If the answer is no, nothing else matters. The generator can be correct, fast and
well tested, and it will still be quietly not used, because being on call for
something you cannot read is not a reasonable thing to ask of anybody.

## What people actually check

When an experienced engineer opens generated code, they scan for a handful of
signals rather than reading it line by line, and form a judgement quickly.

**Can I find my way around?** Are there names that mean something, or is
everything `WS-TEMP-1` through `WS-TEMP-40`? A reader needs to be able to hold a
mental map, and generated names that encode a counter instead of a purpose make
that impossible.

**Does it look like code somebody would write?** Not identical, but recognisable.
If the structure is unlike anything in the estate, every future maintenance
change becomes an argument about whether to edit the generated file or regenerate
it.

**When it fails at three in the morning, what do I have?** This is the real
question. There is an abend, a line number, and a person under time pressure.
What they need is a path from that line back to the source that produced it, and
they need it in seconds.

**What do I do if the tool disappears?** Perfectly reasonable. Companies are
acquired, projects are abandoned, the person who set it up leaves. If the answer
is "you own the generated code and it is maintainable", the risk is acceptable.
If the answer is "you regenerate", the risk is a dependency nobody signed up for.

Notice that none of these is "is it correct". Correctness is assumed to be
testable. Reviewability is not, and it is the thing that decides.

## Comments are load bearing

The instinct is to keep generated output lean. The instinct is wrong.

A generated program should explain itself more than a hand written one, not less,
because its reader has no memory of writing it. Specifically it should say, at
the top, what the program is for, how it is entered, which external programs it
calls, what each return code means, and whether it is safe to rerun after it
fails halfway.

That last one is worth dwelling on. Restart behaviour is the single most useful
thing a batch program can tell an operator, and it is almost never written down.
"Rerunnable, the program writes no dataset" is one line and it turns a decision
under pressure into a fact.

Inside the body, a comment earns its place when it explains something the code
cannot. A block of arithmetic implementing a rounding rule should say which rule
and why the obvious construct was not used. Without that, the next reader sees
fifteen lines doing something a single keyword appears to do, and their first
instinct is to simplify it.

## Determinism is a review property

The same input must produce the same bytes. Every time, on every machine.

This sounds like an engineering nicety and it is actually the thing that makes
review mean anything. If two builds of the same source can differ, then the
artifact somebody read and the artifact that was deployed are not necessarily the
same, and the review was theatre.

The usual culprits are easy to name and easy to eliminate: a timestamp in a
header, a hash map iterated in insertion order, a temporary filename with a
random component, a path that is absolute on one machine and relative on another.

The way to know you have eliminated them is to build twice and compare the bytes,
on every commit, and fail if they differ. A tool that claims determinism and does
not check it is claiming something nobody has verified.

## Source maps, and why a comment is not one

Most generators put a comment on each generated line saying where it came from.
That is better than nothing and it is not enough.

What is needed is a machine readable map from every generated construct to the
source span that produced it, shipped with the artifact. That is what lets an
editor jump, what lets a debugger show the original line, and what lets a
reviewer ask "which parts of my source produced no output" and get an answer.

The last question is the interesting one, and it goes the other way. If some part
of the source maps to nothing, either it was optimised away for a reason somebody
should know about, or it was silently dropped. Both are worth finding out, and
neither is visible without coverage over the map itself.

## The tool as a permanent dependency

Every code generator eventually faces the question of whether the generated code
gets edited by hand.

Saying no is cleaner and rarely survives contact with an incident. At two in the
morning, with an outage running, somebody will edit the generated file, because
that is the fastest way to stop the bleeding and it is the right call.

So the design should accept it. That means the generated code has to stand alone
after the edit: readable, self contained, not dependent on a runtime library
nobody has. It means a clear marker saying the file is generated and where the
source lives, so the next person knows what they are looking at. And it means the
process needs a route back, where the emergency fix is reproduced in the source
and the file regenerated, without pretending the edit did not happen.

A tool that forbids the edit does not prevent it. It just makes sure nobody
records it.

## What good looks like

None of this is exotic. It amounts to treating the generated artifact as the
deliverable rather than as an intermediate, and holding it to the standard the
team already holds its own code to.

The test is simple. Show the output to somebody who has never heard of the tool,
and ask whether they would take a support rota for it.

If they hesitate, the problem is not the compiler.
