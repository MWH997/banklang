# A program with a test case

A posting decided entirely by the job's PARM, and the zUnit case that pins it
down.

## Why

Everything else in `examples/` is about what the compiler emits. This one is
about what it emits **alongside** the program: three artifacts that run on z/OS
and report pass or fail — a `.bzucfg` configuration, a COBOL test case program,
and the job that submits them.

```bash
pnpm bankc zunit examples/zunit-tested-posting
```

The program is deliberately small and deliberately PARM-driven. A program that
reads a dataset can be tested too, but then what it posts depends on the dataset
rather than on the test, and the first thing worth showing is a case whose
answer is decided by the case.

## What to look at

The test is next to the program, in the same file, in the same language:

```
test postsBothLegs for postOne {
  given account = "0001234567890123";
  given amount = 100.00;
  given idempotencyKey = "IDEM-0001";

  expect debit("0001234567890123", 100.00);
  expect credit("SUSPENSE", 100.00);
  expect audit("POSTED", "IDEM-0001");
}
```

`given` is the PARM the step is started with. `expect` is the calls the program
makes, **in order** — a debit then a credit is not a credit then a debit, and
the generated driver checks each call against the expectation of that position.
A run that makes fewer calls than the test expected fails, and so does one that
makes more.

Those two things are the whole surface, and the reason is worth knowing: the
driver runs in its own program. It enters this one through its entry point and
the runner intercepts what it calls, so what a case can see is the LINKAGE the
step is started with and the calls it makes. This program's WORKING-STORAGE is
not reachable from a test, and a test that appeared to assert on it would be
reporting a pass nobody checked.

## What it generates

| Artifact          | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `TZUNITTE.bzucfg` | The configuration: the test, the entry point, the stubbed modules |
| `TZUNITTE.cbl`    | The test case program, with a `TEST_POSTSBOTHLEGS` entry point    |
| `TZUNITTE.jcl`    | Compile the driver, then `EXEC PROC=EQAPPLAY`                     |

The program's own COBOL is byte for byte what it would be with no tests written
against it. A `test` declaration compiles to nothing.

## What this has not been through

No generated case in this repository has been **run**. The driver compiles under
GnuCOBOL, which is narrower evidence than it sounds — `COPY EQAITERC` resolves
locally to a stand-in declaring the two fields the driver names, because IBM's
copybook is not here. [zunit-integration.md](../../docs/zunit.md)
records where every shape in the artifacts came from, and which two values are
inferred rather than observed.

## Related

- [docs/zunit.md](../../docs/zunit.md)
- [parm-driven-batch](../parm-driven-batch/README.md) — the PARM convention the
  `given` values arrive through
- [account-posting](../account-posting/README.md) — the ledger and audit calls
  the expectations are about

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=zunit-tested-posting) — it compiles in your browser, with the generated COBOL beside it.
