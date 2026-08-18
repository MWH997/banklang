---
title: A compiler that refuses to build
description: Some bugs are omissions rather than mistakes, things the code failed to say. A compiler can notice that, and refusing to build is a reasonable response.
date: 2026-08-05
author: Md Wahid Hassan
related: why-banks-still-run-cobol, rounding-money-is-harder-than-it-looks
reading: diagnostics.md
---

Most compilers are permissive by design. They check that your program means
something and then they build it. Whether it means the right thing is your
problem.

That division makes sense for a general purpose language, because a compiler has
no idea what your program is for. It cannot know that the number you just moved
is money, or that the function you just wrote is supposed to leave the books
balanced.

But if the language does know, the calculation changes.

## Three bugs that look like nothing

Here is a small function. It moves money from one account to another. Read it and
see whether anything looks wrong.

```ts
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}
```

There are three problems, and none of them is a typo.

**The postings do not balance.** It debits `amount` and credits `fee`. Money
leaves one account and a different quantity arrives at the other. In a real
ledger the difference has to go somewhere, and it goes into a suspense account
that somebody reconciles by hand at month end.

**There is no idempotency key.** If the caller retries, because a network call
timed out and nobody knows whether it landed, this runs again and posts again.
The customer is debited twice. This is one of the most common ways a payments
system loses money, and it is invisible in the code because the bug is something
the code does not say.

**Nothing is audited.** Money moved and there is no record of why, who, or under
what reference. Six months later somebody asks about this transaction and the
only answer available is the balance change.

A careful reviewer catches all three. A tired reviewer catches two. A reviewer
who does not know the house rules catches none, because nothing here is wrong in
the ordinary sense. Every line is well typed and every line does what it says.

## What "refuse" means

Give the compiler enough vocabulary and each of these becomes a check.

If `transaction` is a concept the language has, rather than a word in a comment,
the compiler knows a unit of work is being opened. It can add up the debits and
the credits and compare. It can look for an idempotency key. It can look for at
least one audit event.

```txt
BANK-TXN-001  Transaction postTransfer has no idempotency key.
BANK-AUD-001  Transaction postTransfer does not emit an audit event.
BANK-LED-001  Transaction postTransfer does not balance:
              debited request.amount against credited request.fee.
```

The important word is refuse. These are not warnings. The build produces no
artifact, and there is no flag to turn them off.

That last part gets argued about, so here is the reasoning. A
warning that can be suppressed becomes a warning that is suppressed, usually by
somebody in a hurry with a good reason. A rule that can be switched off is a rule
that is off in the one build where it mattered. If a rule is wrong, it should be
fixed or removed. Making it optional is how you get the cost of the rule without
the benefit.

## Rules that are not about money

Once the mechanism exists, most of the useful checks turn out not to be about
arithmetic at all. They are about the things a program failed to say.

**A file that is opened without checking the status.** On z/OS, opening a dataset
that is not there gives file status 35. If nobody checks, the first read hits end
of file, the job processes zero records, and the step ends with return code 0.
The night looks successful. Everybody finds out the next morning.

**A loop with no bound.** A batch reading a file until end of file is fine until
the file is bigger than anyone expected and the job runs into the online window.
A ceiling with a defined behaviour on reaching it is a decision. No ceiling is
also a decision, taken by nobody.

**A retry with no limit.** A database deadlock is normal and the correct response
is to retry. Retrying forever is how one deadlock becomes an outage.

**A personal data field reaching a log.** Not a bug in the ordinary sense, and a
finding in an audit.

Each of these has the same shape. The code is not wrong. The code is silent, and
the silence has a default that nobody chose.

## What this costs

A restricted language cannot express everything. Some programs will not
translate, and no amount of cleverness fixes that, because the restrictions are
the product. If the language grew until everything compiled, the checks would
have nothing left to stand on.

Rules have false positives. A rule that fires on a program that is genuinely fine
is expensive, because the cost is paid by the developer who has to work out
whether the compiler is right. Every rule has to be worth that, and a rule that
fires often and is usually wrong should be deleted rather than defended.

And a rule is only as good as the test that provokes it. A check nobody has seen
fail is a check that might have stopped working two releases ago. Every rule
needs a program that fails it, run on every build, so that a rule quietly
breaking is a red build rather than a silence.

## The general shape

There is nothing specific to banking here. The pattern is that a domain has a
small number of mistakes that are catastrophic, well understood, and hard to see
in review. Encode the domain in the language and the compiler can see them.

The trade is always the same. You give up expressiveness and you get back a
category of bug that cannot reach production. Whether that is a good trade
depends entirely on what the bugs cost, which is why it works better for a ledger
than for a game.
