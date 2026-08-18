---
title: Rounding money is harder than it looks
description: Half of one penny has to go somewhere, and the choice you make is worth real money. Here is why floating point is the wrong tool and what banks actually do instead.
date: 2026-08-06
author: Md Wahid Hassan
related: a-compiler-that-refuses-to-build, testing-a-compiler-you-cannot-run
reading: numeric-model.md
---

Ask a room of developers to round 2.675 to two decimal places and most will say
2.68. Ask a computer and you may get 2.67. Ask an accountant and the first thing
they will ask you is which rounding rule applies, because there is more than one
and the answer depends on it.

This is not a trivia question. On a portfolio of a few million accounts, the
difference between two reasonable rounding rules is a number somebody has to
explain.

## The floating point problem, briefly

Computers usually store fractional numbers in binary floating point. It is fast,
it is built into the hardware, and it is wrong for money.

The reason is simple once you see it. In decimal you cannot write one third
exactly: 0.3333 forever. In binary you cannot write one tenth exactly, for the
same kind of reason. So 0.1 in a computer is not 0.1. It is a number extremely
close to 0.1, and the error is invisible until you add enough of them together.

The classic demonstration is that 0.1 plus 0.2 does not equal 0.3. Try it in
almost any language and you will get 0.30000000000000004. That trailing 4 is the
actual stored value rather than a display artefact.

For a graphics calculation, nobody cares. For a balance sheet, that is a
reconciliation break. This is why every serious financial system stores money as
an exact decimal: a whole number of the smallest unit, with the position of the
decimal point recorded separately. Two hundred and forty three pence, not
2.43-ish.

COBOL got this right in 1959 and has never moved. A `PIC S9(16)V99 COMP-3` field
is eighteen decimal digits, two after an assumed point, stored as packed decimal.
There is no approximation anywhere in it.

## The half problem

Exact storage solves one problem and exposes another. Sooner or later you divide,
and the answer does not fit.

Say an account holds 1,000.00 and the interest rate is 0.4375 per cent. The
interest is 4.375. You have to store it in a field with two decimal places. Half
a penny is left over and it has to go somewhere.

There are seven reasonable answers, and they are all in use:

**Half up.** Round to the nearest, and when it is exactly half, go away from
zero. 4.375 becomes 4.38. This is what most people mean by "round" and what most
programming languages do.

**Half even, also called banker's rounding.** Round to the nearest, and when it
is exactly half, go to the even digit. 4.375 becomes 4.38 because 8 is even, but
4.385 becomes 4.38 as well, because 8 is even and 9 is not. It looks strange
until you see why.

**Half down.** When it is exactly half, go towards zero. 4.375 becomes 4.37.

**Up, down, ceiling and floor.** Always away from zero, always towards zero,
always towards positive infinity, always towards negative infinity. These four
never look at the half at all.

## Why banker's rounding exists

Half up has a bias. Consider every possible third decimal digit: 0, 1, 2, 3, 4
round down, and 5, 6, 7, 8, 9 round up. That is five down and five up, which
sounds fair, but 0 does not round at all. It is already exact. So the real
comparison is four rounding down against five rounding up, and the average result
drifts upwards.

On one calculation the drift is a fraction of a penny. On ten million interest
calculations a night, it is a systematic transfer of money in one direction, and
which direction depends on which side of the transaction you are on.

Banker's rounding removes the bias by sending exact halves to the even digit,
which happens about half the time in each direction. Over many calculations the
errors cancel instead of accumulating.

That is why it is the default in a lot of financial regulation and why the IEEE
754 standard picked it as its default rounding mode. It is the rule you reach
for when the calculation runs a great many times.

## Where COBOL makes this awkward

Here is the part that catches people out.

IBM Enterprise COBOL has one rounding phrase. You write `ROUNDED` on an
arithmetic statement, and the result is rounded. What it does is half up, away
from zero.

That is it. There is no `ROUNDED MODE IS NEAREST-EVEN` in the dialect that most
production z/OS code is compiled under. If you want banker's rounding, you write
the arithmetic yourself.

Which means it looks roughly like this. Compute the value truncated. Compute what
was left over. Decide whether the leftover is more than half, exactly half, or
less. If exactly half, look at whether the last kept digit is odd, and step it if
so.

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

It is not complicated, but it is fiddly, and it has to be right for negative
numbers too, where "away from zero" and "towards positive infinity" stop being
the same thing. Getting it wrong produces answers that are correct almost always,
which is the worst kind of wrong: it survives testing and shows up in production
as a slow drift.

## What a compiler can do about it

If a language knows that a value is money, it can require a division to state
its rounding mode, refusing to compile until it does, rather than quietly
supplying a default.

That sounds pedantic until you consider what the default costs. A developer who
writes a division and does not think about rounding has made a decision worth
real money without knowing they made it. A compiler that asks the question turns
an invisible choice into a visible one, at the moment the code is written, when
it costs nothing to answer.

The same applies to precision. If a balance has two decimal places and a rate has
four, their product has six. Storing that product back into the balance discards
four digits. A compiler that knows the scales can see that and refuse, rather
than let the field silently truncate.

## How you check any of this

None of the above is worth much unless it is verified, and rounding is
particularly easy to verify badly. A test that checks 4.375 rounds to 4.38 tells
you almost nothing; the interesting cases are the exact halves, the negatives,
and the boundaries.

The approach that works is an oracle. Compute the answer a second way, using
exact arithmetic that has nothing to do with the code under test, and compare.
Then run it across every boundary case rather than a handful: every mode, both
signs, a product and a quotient, values just above and just below each half.

If the two ever disagree, one of them is wrong, and you find out which. That is a
much stronger position than a list of expected values somebody typed out, because
the expected values were produced by a person who was thinking about the same
thing in the same way, and a shared misunderstanding agrees with itself
perfectly.
