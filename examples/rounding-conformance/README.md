# Rounding conformance

All seven rounding modes over the same value, both signs, so the answers can be
read side by side against the COBOL that produced them.

## Why

Enterprise COBOL has one rounding phrase. `ROUNDED` is half-up away from zero,
there is no `MODE IS` sub-phrase, and `NEAREST-EVEN` appears in no column of the
Language Reference's Appendix E. BankLang emitted `ROUNDED MODE IS NEAREST-EVEN`
for two years because GnuCOBOL's default dialect — a superset of every COBOL it
knows — accepted it.

Five of the seven modes are therefore arithmetic this compiler writes out.

## What it prints

```
TIE AT +1.005
HALF_UP   +1.01     HALF_EVEN +1.00     HALF_DOWN +1.00
UP        +1.01     DOWN      +1.00
CEILING   +1.01     FLOOR     +1.00
TIE AT -1.005
HALF_UP   -1.01     HALF_EVEN -1.00     HALF_DOWN -1.00
UP        -1.01     DOWN      -1.00
CEILING   -1.00     FLOOR     -1.01
```

`UP` and `CEILING` agree on the positive tie and disagree on the negative one,
which is why the run does both — one sample would make them look like synonyms.

## Where the proof is

Not here. Reading the generated sequence cannot tell a correct one from one that
is off by a unit at the tie. [`tests/rounding-oracle.test.ts`](../../tests/rounding-oracle.test.ts)
executes it over every boundary case and compares each answer against a rational
held in two BigInts.

## Artifacts

`dist/cobol/ROUNDING.cbl`, `dist/jcl/ROUNDING.jcl`, two copybooks.

## Related

- [docs/numeric-model.md](../../docs/numeric-model.md) — the whole rounding model

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=rounding-conformance) — it compiles in your browser, with the generated COBOL beside it.
