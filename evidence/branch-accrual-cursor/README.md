# Branch Accrual Cursor Evidence Bundle

Generated artifacts for the branch-accrual-cursor example, which exercises a Db2
cursor declaration, a bounded cursor loop, explicit rounding, double-entry
posting inside a loop, and a sequential output file.

This example is also **executed**. See
[`tests/conformance.test.ts`](../../tests/conformance.test.ts) and
[`runtime/README.md`](../../runtime/README.md).

## Contents

- `source/main.bank.ts`
- `cobol/BRANCH-ACCRUAL-CURSOR.cbl`
- `copybooks/ACCRUAL-REQUEST.cpy`
- `copybooks/ACCOUNT-ROW.cpy`
- `copybooks/ACCRUAL-SUMMARY.cpy`
- `jcl/BRANCH-ACCRUAL-CURSOR.jcl`
- `maps/source-map.json`
- `audit/diagnostics.json`
- `audit/source-map.json`
- `audit/generated-artifacts.json`
- `audit/decimal-analysis.json`
- `audit/transaction-analysis.json`
- `audit/copybook-layout.json`
- `audit/copybook-layout.md`
- `audit/validation-matrix.md`
- `audit/verification-report.md`
- `audit/verification-report.json`
- `audit/gnucobol-validation.md`
- `audit/bankc-test-report.md`

## What this bundle shows

- `cobol/BRANCH-ACCRUAL-CURSOR.cbl` holds all four Db2 statements a cursor
  needs: the `DECLARE` in `WORKING-STORAGE`, and the `OPEN`, `FETCH`, and
  `CLOSE` around the loop. Only the loop appears in the source — the `OPEN` and
  the `CLOSE` are generated, so a cursor cannot be left open.
- The `DECLARE` carries no `INTO`, because `DECLARE CURSOR` may not. The clause
  the author wrote on the SELECT is on the `FETCH`, which is where a row
  arrives.
- The loop leaves on `IF SQLCODE NOT = 0`, not on 100 alone: an error treated as
  end-of-data would process a partial result set as though it were the whole
  one.
- `ACCOUNTS-IN-BRANCH-ROWS` counts rows against the declared `limit 5000`, which
  is what stops a cursor whose rows never run out.
- `audit/gnucobol-validation.md` records the local `cobc` invocation against the
  precompiled program, its exit code, and the SHA-256 of both the source and the
  generated artifact.

## What it does not show

GnuCOBOL 3.2.0 is not IBM Enterprise COBOL, and this bundle claims no IBM
validation. The program is translated by BankLang's own precompiler before it is
compiled, which checks the surrounding COBOL and every host variable but
validates no SQL semantics and produces no bind artifacts. The executed
conformance run behind this example uses the reference runtime in `runtime/`,
which parses no SQL and reads no table: every `SQLCODE` it reported was written
down by the test.
