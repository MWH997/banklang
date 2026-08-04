# Interest Posting Batch Evidence Bundle

Generated artifacts for the example that exercises the full language surface:
tiered interest, fees, balanced posting, a bounded batch loop, and file I/O.

## Contents

- `source/main.bank.ts`
- `cobol/INTEREST-POSTING-BATCH.cbl`
- `copybooks/INTEREST-ACCOUNT.cpy`, `copybooks/POSTING-ADVICE.cpy`
- `jcl/INTEREST-POSTING-BATCH.jcl`
- `maps/source-map.json`
- the audit bundle under `audit/`

## What this bundle shows

- `audit/verification-report.md` records 17 of 17 traced symbols with no source
  map coverage gaps, the largest program in the repository.
- `audit/transaction-analysis.json` shows both transactions, their postings, and
  their audit events, including the amount expressions compared to prove the
  interest and fee postings balance.
- `cobol/INTEREST-POSTING-BATCH.cbl` contains `COMPUTE ... ROUNDED MODE IS
NEAREST-EVEN` for the interest calculation, `PERFORM UNTIL` with a guard
  counter for the batch loop, and `PERFORM` sequences for nested function calls.

## Regeneration

```bash
pnpm bankc test examples/interest-posting-batch
```

Generated on Node.js 24.

## Related documentation

- [Language reference](../../docs/language-reference.md)
- [Example walkthrough](../../examples/interest-posting-batch/README.md)

## Notes

No IBM validation claim is made here. The bundle records local deterministic
outputs only, validated with GnuCOBOL.
