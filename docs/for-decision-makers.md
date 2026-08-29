# Evaluating BankLang

This page summarises what BankLang does, what the current evidence covers, and
what a technical evaluation would still need to establish.

---

## What it is

BankLang is a deterministic source-to-source compiler. You write **BankTS**, a
small statically typed language for banking workloads. `bankc` emits COBOL
targeting IBM Enterprise COBOL for z/OS 6.4, record copybooks, JCL, a source
map, and an audit bundle.

The same compiler version and settings produce byte-identical artifacts. The
compiler does not call a model when it builds or runs a program. That is a
property of the toolchain, not evidence that IBM Enterprise COBOL has accepted
the output.

## What it is not

**It has not been validated with IBM Enterprise COBOL or run on z/OS.** Local
checks use GnuCOBOL 3.2.0 under an IBM-shaped profile and its default dialect.
The known and suspected differences are listed in
[divergences](divergences.md).

**It has no production integration.** The repository contains no live ledger,
bank deployment, or pilot.

**It is a narrow language.** The implemented surface includes selected batch
and online programs using files, decimal arithmetic, embedded SQL, CICS, IMS,
MQ, and Report Writer constructs. The ledger, audit, and subsystem interfaces
used by local tests are repository-defined interfaces, not bank services.

**It is not a COBOL-to-BankTS converter.** `bankc analyse` can inventory
existing COBOL and draw paragraph and copybook dependency graphs, but it does
not semantically convert an estate. See [status and limits](status-and-limits.md)
for the full boundary list.

## What it checks at compile time

BankLang rejects selected failure modes that a general-purpose COBOL compiler
does not know how to identify.

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

These are compile errors, so `bankc build` emits no artifact for this program.
They represent an unkeyed retry, an unrecorded posting, and a debit that does
not match its credit. They do not establish that a valid program is correct at
runtime.

The diagnostic catalogue currently contains more than one hundred implemented
checks. Each entry has an explanation and remediation; the verification suite
and published mutation results show how those checks are tested.

## Current evidence

The figures below describe BankLang 0.10.0. `pnpm evidence:grades` generates the
underlying table from the checked-in evidence bundles.

| Grade        | Count | Meaning                                                                          |
| ------------ | ----- | -------------------------------------------------------------------------------- |
| **executed** | 23    | The example runs against the local reference runtime.                            |
| **compiled** | 2     | The example compiles but has no local execution path for its generated features. |
| **emitted**  | 0     | No example has this evidence grade.                                              |

Three executed examples have hand-written expected balances. The other twenty
are run by GnuCOBOL and by an independent interpreter and compared. This tests
the generated program against two implementations, but it cannot catch an
error shared by both implementations.

None of this is IBM Enterprise COBOL validation. The local runs use reference
programs from this repository for the ledger, audit, SQL, CICS, IMS, and MQ
interfaces. Those programs are not Db2, CICS, IMS, MQ, or a bank ledger.

Other evidence includes:

- **A conformance linter** reads every emitted artifact as text and holds it to
  rules that each cite a page of an IBM manual. It catches what a compiler
  accepts and a target does not: a COBOL word past thirty characters, a
  `PROGRAM-ID` that cannot be a load module member, a dataset qualifier too long
  to catalogue.
- **Rounding is checked against exact arithmetic**, over every boundary case, in
  both shapes and all seven modes. Enterprise COBOL has one rounding phrase;
  banker's rounding is arithmetic this compiler writes out, and the tests
  execute every case of it.
- **Mutation testing**, which changes the compiler and asks whether any test
  notices. Current scores: the rules that refuse a program at 70%, the
  conformance linter at 69%, the emitter's formatting at 61%. They are published
  and are recorded in [verification](verification.md).

## How to evaluate it

The repository supports a focused technical evaluation:

1. **Read one conversion.** [`conversions/`](../conversions/) puts existing COBOL,
   the BankTS it becomes, and the regenerated COBOL side by side, a sequential
   master update, a CICS enquiry, a Db2 cursor batch, hand-written banker's
   rounding, and a copybook with `REDEFINES`, `FILLER` and `OCCURS DEPENDING ON`.
   Use these to judge whether the generated output fits your review standards.
2. **Point it at one of your copybooks.** `bankc copybook import ACCTMAST.cpy`
   reads a production copybook into a BankTS record and refuses an import that
   does not round-trip field for field. It either handles your layouts or it
   tells you exactly where it does not.
3. **Compile one program on your own system.** `pnpm tsx tools/zos-kit.ts`
   writes every program, copybook and job in the member names the JCL expects,
   with a procedure and a results template. A run with IBM Enterprise COBOL is
   the missing evidence this repository cannot produce locally.

## Evidence required before production use

The following evidence is still required:

- **It compiles under IBM Enterprise COBOL**, not a configuration shaped to
  look like it, and the divergences are known and closed.
- **It has run under CICS and against Db2**, not against a reference runtime
  that reports what a test told it to report.
- **The ledger and audit calling convention is yours**, not the one this project
  invented for itself. That is a real integration, and it is where the work is.
- **The mutation scores are higher than they are now**, particularly for the
  code that decides what the emitted text looks like.
- **It has been audited against a real estate.** One external audit exists from
  5 August 2026. It found three defects behind a green test suite, including a
  rounding phrase Enterprise COBOL does not support. A repository review is not
  a substitute for testing against a real application estate.

Until that evidence exists, treat BankLang as a tool to evaluate, not a system
to run production transactions through.

---

**Read next:** [status and limits](status-and-limits.md) ·
[for mainframe engineers](for-mainframe-engineers.md) ·
[what the verification actually proves](verification.md)
