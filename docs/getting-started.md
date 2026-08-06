# Getting started

Thirty minutes from clone to reading generated COBOL and understanding why it
looks the way it does.

## Requirements

Node.js 24 or later, and pnpm 11.7.0. GnuCOBOL is optional — everything except
the compile and execute lanes works without it.

```bash
git clone <this repository>
cd banklang
pnpm install
```

Installing GnuCOBOL is worth the two minutes if you want the whole picture:

```bash
brew install gnu-cobol        # macOS
apt-get install gnucobol      # Debian and Ubuntu
```

---

## Five minutes: see what it does

```bash
pnpm playground:dev
```

The entire compiler runs in your browser — no server, no network call. Click any
line of BankTS and the COBOL it produced lights up, and the other way round.
That cross-link is read straight from the emitted source map, so traceability is
something you click rather than something the documentation claims.

---

## Ten minutes: compile something

```bash
pnpm bankc build examples/account-file-batch
```

That writes `dist/`:

```
dist/cobol/ACCOUNTF.cbl      the program
dist/copybooks/ACCOUNTR.cpy  a copybook per record
dist/jcl/ACCOUNTF.jcl        the job that builds and runs it
dist/maps/source-map.json    every module, record, field, function, transaction
dist/audit/                  diagnostics, decimal analysis, layout report
```

Read `dist/cobol/ACCOUNTF.cbl` from the top. The prologue tells you what the
program is, how it is entered, which datasets it touches under which DD names,
what modules it calls and what each return code means.

Then read `dist/jcl/ACCOUNTF.jcl`. It is meant to be submittable.

If you are a mainframe engineer, go to
**[for-mainframe-engineers.md](for-mainframe-engineers.md)** now. It reads that
program with you, construct by construct, and every question you are about to
have is answered there.

---

## Fifteen minutes: break something on purpose

The compiler's whole claim is about what it refuses. Open
`examples/account-posting/src/main.bank.ts` and try each of these:

**Post a debit with no matching credit.**

```
  debit(request.debitAccount, request.amount);
```

`bankc check` reports `BANK-LED-001`: the transaction does not balance.

**Divide without saying how to round.**

```
  let share: MoneyBDT = request.amount / 3.00;
```

`BANK-DEC-003`. The answer depends on the rounding mode, so somebody has to say
which. `divide(request.amount, 3.00, "HALF_EVEN")` is accepted.

**Add two different currencies.**

```
type MoneyUSD = currency<"USD", 18, 2>;
```

`BANK-DEC-005`. There is no conversion operator, because a rate is a number
somebody has to supply and a compiler that invented one would be inventing an
exchange rate.

**Write an audit event with no idempotency key.**

`BANK-TXN-001`. An audit trail nobody can deduplicate is one nobody can
reconcile.

`pnpm bankc explain BANK-LED-001` prints the catalogue entry for any of them,
and [diagnostics.md](diagnostics.md) is the whole list.

---

## Thirty minutes: run the checks

```bash
pnpm typecheck          # TypeScript
pnpm test               # everything, including programs that are executed
pnpm test:gnucobol      # every example, compiled under an IBM-shaped dialect
pnpm lint:conformance   # every artifact, against the target's rules
```

`pnpm test:gnucobol` is the one worth understanding. It compiles each example
twice: once under `tools/banklang-ibm.conf`, which is shaped to Enterprise COBOL
6.4, and once under GnuCOBOL's default dialect, which is a superset of every
COBOL it knows. A difference between the two is treated as a finding rather than
as noise, because the default dialect accepting something the target rejects is
exactly how a 31-character data name and a rounding phrase that does not exist
both shipped.

`pnpm lint:conformance` reads every emitted artifact, every checked-in fixture
and every evidence bundle as text and asserts the target's rules — 30-character
words, column 72, `ARITH(COMPAT)`'s eighteen digits, dataset qualifiers at
eight, and that every word in the program is one Enterprise COBOL has heard of.
See [target-conformance.md](target-conformance.md).

---

## Start a project

```bash
pnpm bankc init my-service
pnpm bankc check my-service
```

`bankc init` produces a project that compiles first try. `banklang.json` beside
`src/` holds the settings — see [toolchain.md](toolchain.md).

---

## Bring your own records

If you have a copybook:

```bash
pnpm bankc copybook import path/to/ACCTMAST.cpy
```

It prints a BankTS record. Before printing anything it emits that record back to
a copybook and compares the two field by field — same names, same order, same
offsets, same lengths, same pictures. If they differ, nothing is written and the
reason is named: a field read at the wrong length moves every field after it.

If you have a DCLGEN member:

```bash
pnpm bankc dclgen import path/to/ACCOUNT.cpy
```

Same idea, and it gets nullability from the catalogue — a column with no
`NOT NULL` becomes `nullable<T>`, which makes the compiler require a presence
check before the program reads it.

---

## Where to go next

| You are                               | Read                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| A mainframe engineer                  | [for-mainframe-engineers.md](for-mainframe-engineers.md)                           |
| Reviewing the generated code          | [generated-code-standards.md](generated-code-standards.md)                         |
| Asking what it is checked against     | [target-conformance.md](target-conformance.md), [verification.md](verification.md) |
| Asking where the money could be wrong | [numeric-model.md](numeric-model.md)                                               |
| Asking what happens on a bad night    | [error-handling.md](error-handling.md)                                             |
| Asking about the job                  | [jcl-model.md](jcl-model.md)                                                       |
| Asking about PII                      | [security-and-data.md](security-and-data.md)                                       |
| Asking why not something else         | [comparison.md](comparison.md)                                                     |
| Learning the language                 | [language-reference.md](language-reference.md)                                     |
| Asking what it does **not** do        | [divergences.md](divergences.md)                                                   |
