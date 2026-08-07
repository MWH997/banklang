# For the person deciding

[for-mainframe-engineers.md](for-mainframe-engineers.md) is written for whoever
has to accept the generated COBOL. This page is for whoever has to accept the
risk.

It is short on purpose, and it leads with what the project cannot do, because
you will find that out anyway and finding it yourself is worse.

---

## What this is

A compiler. You write a program in **BankTS** — a small, deliberately
restricted language that looks like TypeScript — and it emits IBM Enterprise
COBOL, a copybook for every record, the JCL to build and run it, and a source
map tying every generated line back to the line that produced it.

**No model decides what is generated.** The same input produces byte-identical
output, every time, on any machine. That is a test in the suite, not a claim on
a page.

## What it is not

**It has never run on z/OS.** Not once. Every example is compiled with GnuCOBOL,
under a dialect configured to Enterprise COBOL 6.4 and under GnuCOBOL's own
default, and a difference between the two is treated as a finding. GnuCOBOL is
not IBM's compiler. No IBM Enterprise COBOL validation has been performed and
none is claimed.

**No money has moved through it.** No institution has used it. There is no
production deployment, no pilot, and no customer.

**It covers a narrow subset of what a bank does.** Batch and CICS programs
against QSAM, VSAM and Db2, with a ledger and audit calling convention it
defines itself. It does not do IMS DB beyond a bounded surface, does not do
distributed transactions, and does not replace a core banking package.

[status-and-limits.md](status-and-limits.md) is longer and blunter. Read it
before anything else on this page persuades you.

## The one thing it does that nothing else does

It refuses to compile financially unsafe programs.

```ts
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}
```

```txt
BANK-TXN-001  Transaction postTransfer has no idempotency key.
BANK-AUD-001  Transaction postTransfer does not emit an audit event.
BANK-LED-001  Transaction postTransfer does not balance:
              debited request.amount against credited request.fee.
```

Those are compile errors. Not warnings, not lint, not a review checklist — the
build does not produce an artifact.

The three above are a retry that posts twice, money moving with no audit trail,
and a ledger that does not balance. There are more than ninety diagnostics, each
one documented with an explanation and a remediation, and each one provoked by a
test that fails if the rule stops working.

**Why this is the interesting part.** Every one of those defects is normally
caught by a person: a reviewer who knows to look, a tester who thinks of the
retry, an auditor who reconciles after the fact. The claim here is not that the
COBOL is better. It is that a class of defect stops depending on whether
somebody remembered.

## What the evidence actually is

Grades are generated, not asserted — `pnpm evidence:grades` writes the table and
a test fails if it drifts.

| Grade        | Count | What it rules out                                                                   |
| ------------ | ----- | ----------------------------------------------------------------------------------- |
| **executed** | 21    | A defect that compiles. The program runs and its balances and branches are checked. |
| **compiled** | 2     | A program the target would reject. Says nothing about what it computes.             |
| **emitted**  | 0     | Nothing local compiles it; the conformance linter is what checks it.                |

**"Executed" covers two strengths of evidence, and the difference matters.**
Three of the twenty-one have expected balances somebody worked out by hand,
which is the strongest thing this project has. The other eighteen are run twice
— once compiled by GnuCOBOL and once by a separate interpreter written against
the same output — and required to agree. That catches a defect that compiles
without anybody having to predict the answer, and it would not catch a program
that is wrong in the same way twice. `evidence/GRADES.md` says which each one is.

None of it is IBM Enterprise COBOL. The runs are against a reference runtime in
this repository: programs that satisfy the ledger, audit, SQL and CICS
interfaces well enough to run a generated program end to end. It is not Db2 and
it is not CICS.

Beyond that:

- **A conformance linter** reads every emitted artifact as text and holds it to
  rules that each cite a page of an IBM manual. It catches what a compiler
  accepts and a target does not — a COBOL word past thirty characters, a
  `PROGRAM-ID` that cannot be a load module member, a dataset qualifier too long
  to catalogue.
- **Rounding is checked against exact arithmetic**, over every boundary case, in
  both shapes and all seven modes. Enterprise COBOL has one rounding phrase;
  banker's rounding is arithmetic this compiler writes out, and it is proved
  rather than asserted.
- **Mutation testing**, which changes the compiler and asks whether any test
  notices. Current scores: the rules that refuse a program at 70%, the
  conformance linter at 69%, the emitter's formatting at 61%. Those numbers are
  published because they are not good enough yet, and because a project that
  only publishes its good numbers is telling you something else.

## What it would cost you to find out

The honest next step is small and it is not a procurement.

1. **Read one conversion.** [`conversions/`](../conversions/) puts existing COBOL,
   the BankTS it becomes, and the regenerated COBOL side by side — a sequential
   master update, a CICS enquiry, a Db2 cursor batch, hand-written banker's
   rounding, and a copybook with `REDEFINES`, `FILLER` and `OCCURS DEPENDING ON`.
   One engineer, one afternoon, and you will know whether the output is
   reviewable by your people.
2. **Point it at one of your copybooks.** `bankc copybook import ACCTMAST.cpy`
   reads a production copybook into a BankTS record and refuses an import that
   does not round-trip field for field. It either handles your layouts or it
   tells you exactly where it does not.
3. **Compile one program on your own system.** `pnpm tsx tools/zos-kit.ts`
   writes every program, copybook and job in the member names the JCL expects,
   with a procedure and a results template. This is the largest single piece of
   evidence the project does not have, and somebody with a `IGYCRCTL` and an
   hour can produce it.

None of that requires a licence, a contract, or a conversation.

## What would have to be true before it went near production

Stated plainly, because a list like this is usually absent and its absence is
the tell:

- **It compiles under IBM Enterprise COBOL**, not a configuration shaped to
  look like it, and the divergences are known and closed.
- **It has run under CICS and against Db2**, not against a reference runtime
  that reports what a test told it to report.
- **The ledger and audit calling convention is yours**, not the one this project
  invented for itself. That is a real integration, and it is where the work is.
- **The mutation scores are higher than they are now**, particularly for the
  code that decides what the emitted text looks like.
- **It has been audited against a real estate.** One external audit exists —
  [2026-08-05](audit-2026-08-05.md), an adversarial read by a z/OS application
  engineer looking for a reason to say no. It found three defects behind a green
  test suite, including a rounding phrase Enterprise COBOL has never had. Every
  audit since has been the project reading itself, which is worth something and
  is not the same thing.

Until all five, this is a serious piece of engineering to evaluate and not a
system to run money through. The project says so everywhere, including here.

---

**Read next:** [status and honest limits](status-and-limits.md) ·
[for mainframe engineers](for-mainframe-engineers.md) ·
[what the verification actually proves](verification.md)
