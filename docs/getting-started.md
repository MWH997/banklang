# Getting started

Clone the repository, run the browser playground, and build an example. This
guide ends with generated COBOL, JCL, copybooks, and verification reports on
your machine.

## Requirements

Node.js 24 or later, and pnpm 11.7.0. GnuCOBOL is optional: everything except
the compile and execute lanes works without it.

```bash
git clone <this repository>
cd banklang
pnpm install
```

Install GnuCOBOL if you want to compile and execute the generated programs:

```bash
brew install gnu-cobol        # macOS, currently 3.2.0
apt-get install gnucobol      # Debian and Ubuntu, currently 3.1.2
```

**Check what you got.** `cobc --version` should say 3.2. Ubuntu's package is
still 3.1.2, which is missing the `JSON-STATUS` special register that Enterprise
COBOL has and this compiler emits, so six test files fail on COBOL that is
correct for the target. CI builds 3.2 from source for exactly that reason; if
your distribution ships 3.1, either build 3.2 or expect those lanes to fail.

---

## Run the playground

```bash
pnpm playground:dev
```

The compiler runs in your browser. There is no compile server, and editor
content stays in the browser. Click a line of BankTS or COBOL to follow the
source map between the two panes.

---

## Build an example

```bash
pnpm bankc build examples/account-file-batch
```

That writes the following artifacts under `dist/`:

```
dist/cobol/ACCOUNTF.cbl      the program
dist/copybooks/ACCOUNTR.cpy  a copybook per record
dist/jcl/ACCOUNTF.jcl        the job that builds and runs it
dist/maps/source-map.json    every module, record, field, function, transaction
dist/audit/                  diagnostics, decimal analysis, layout report
```

Read `dist/cobol/ACCOUNTF.cbl` from the top. Its prologue describes the entry
point, datasets, external calls, and return codes.

Then read `dist/jcl/ACCOUNTF.jcl`. It is a generated starting point that still
needs the site's job-card, dataset, and procedure standards.

If you are a mainframe engineer, go to
**[for-mainframe-engineers.md](for-mainframe-engineers.md)** now. It reads that
program with you, construct by construct, and answers most of what you are
about to ask.

---

## See a diagnostic

Open
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

**Write a transaction with an audit event but no idempotency key.**

`BANK-TXN-001`. Retries need a caller-supplied key so the operation can be
identified and deduplicated by the surrounding system.

`pnpm bankc explain BANK-LED-001` prints the catalogue entry for any of them,
and [diagnostics.md](diagnostics.md) is the whole list.

---

## Run the checks

```bash
pnpm typecheck          # TypeScript
pnpm test               # everything, including programs that are executed
pnpm test:gnucobol      # every example, compiled under an IBM-shaped dialect
pnpm lint:conformance   # every artifact, against the target's rules
pnpm lint:zos           # every artifact, against what z/OS will do with it
```

`pnpm test:gnucobol` compiles each runnable example twice: once under
`tools/banklang-ibm.conf`, which is shaped to Enterprise COBOL 6.4, and once
under GnuCOBOL's default dialect. Differences are reported because a permissive
local dialect can accept a name or phrase the target does not.

`pnpm lint:conformance` reads emitted artifacts, fixtures, and evidence bundles
as text and checks target rules such as 30-character words, column 72,
`ARITH(COMPAT)`'s eighteen digits, dataset qualifiers at eight, and the
Enterprise COBOL vocabulary used by the project.

`pnpm lint:zos` checks behaviors that can be identified from generated text but
are not covered by syntax or formatting checks. The findings are documented in
[target-conformance.md](target-conformance.md).

---

## Start a project

```bash
pnpm bankc init my-service
pnpm bankc check my-service
```

`bankc init` produces a starter project. `banklang.json` beside `src/` holds the
settings; see [toolchain.md](toolchain.md).

---

## Bring your own records

If you have a copybook:

```bash
pnpm bankc copybook import path/to/ACCTMAST.cpy
```

It prints a BankTS record. Before printing anything it emits that record back to
a copybook and compares the two field by field: same names, same order, same
offsets, same lengths, same pictures. If they differ, nothing is written and the
reason is named: a field read at the wrong length moves every field after it.

If you have a DCLGEN member:

```bash
pnpm bankc dclgen import path/to/ACCOUNT.cpy
```

Same idea, and it gets nullability from the catalogue: a column with no
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
