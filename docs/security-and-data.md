# Security and data

What the compiler can prove about restricted data, what it cannot, and where the
data ends up. Banks ask this in week one.

---

## `sensitive`

A record field may be marked:

```
record Card {
  sensitive pan: string<16>;
  maskedPan: string<16>;
  idempotencyKey: string<36>;
}
```

The marking means something rather than documenting something. Two rules follow
from it.

### `BANK-AUD-002` — it may not reach an audit event or a ledger posting

Both are durable records that outlive the transaction and are read by people
with no business seeing a card number or a national identifier. An audit trail
is the last place a PAN should be, and it is the first place one ends up.

### `BANK-SEC-001` — it may not be assigned to a field that is not marked

A field's marking is part of its record declaration and therefore part of its
copybook, so copying restricted data into an unmarked field would reclassify it
silently and defeat the marking everywhere downstream. Every program sharing
that copybook would then be handling restricted data without knowing it.

The check follows a value through locals: assigning a `sensitive` field to a
local marks the local.

---

## What it cannot prove

**It does not follow taint across a function call.** That is deliberate and it
is the declassification point, made explicit rather than hidden:

```
function maskPan(pan: string<16>): string<16> {
  return "************" + rightOf(pan, 4);
}
```

The result is unmarked. Following taint across a call needs per-function
summaries, and a language with no closures can express masking no other way —
so the call _is_ the boundary, and it is visible in the source rather than
inferred.

Review the functions that take a marked value. There are few of them and they
are the whole surface.

**It knows nothing about what is actually in a field.** `sensitive` is a
declaration, not a classifier. A card number in an unmarked `string<16>` is
unmarked data as far as the compiler is concerned.

**It says nothing about a file.** A record written to a dataset carries whatever
it carries. Dataset-level protection is RACF's, and the generated JCL states no
`PROTECT` or `SECMODEL` — that is a site's standard and the compiler does not
invent one.

**It says nothing about encryption**, in transit or at rest. There is no
encryption in the language and none generated.

---

## Where restricted data ends up

### The copybook layout report

`bankc layout` and `dist/audit/copybook-layout.md` mark which fields carry
restricted data, so an auditor reading the evidence does not have to read the
source.

### A dump

`CEEDUMP` and `SYSUDUMP` are allocated on every batch run step, and
`TERMTHDACT(UADUMP)` asks for a readable dump on an abend. **A dump contains
working storage**, which contains every field the program read, marked or not.

This is not a BankLang property — it is what a dump is — but it is the answer to
"where could a PAN turn up". If your site restricts dumps, restrict these:
change the `CEEOPTS` cards through `runtimeOptions`, and the `SYSOUT` class on
`CEEDUMP` and `SYSUDUMP`.

### The job log

`DISPLAY ... UPON SYSOUT` writes to the job log. The compiler emits `DISPLAY`
in three places: a failed I/O statement (naming the file and the status), an
arithmetic overflow (naming the field), and a subscript out of range (naming the
index). None of them prints a record.

A `log` statement in the source prints whatever it is given, and `sensitive` does
**not** stop it. That is a gap: `BANK-AUD-002` covers audit and ledger, not the
job log.

### The audit trail

`BANKAUDT` is called with an event name and an idempotency key, and nothing
else. The correlation is the key rather than the data.

### The source map and the evidence bundles

Neither carries data. Source maps carry names and line numbers; evidence bundles
carry generated artifacts and reports. No example uses real data, and none
should.

---

## The reference runtime is not a runtime

`runtime/` holds stubs — `BANKLEDG`, `BANKAUDT`, `BANKMQ`, `CBLTDLI`, `DSNHLI`,
`DFHEI1`, `BANKJSON`, `BANKXML`. They exist so the local build can execute a
generated program and observe which branch it took.

They are not implementations, they are not secure, and they write plain files in
the working directory. Nothing in `runtime/` goes anywhere near a real system.
`runtime/README.md` says what each one stands in for and what it does not.

---

## What ships

A `.cbl` member, `.cpy` members, and a `.jcl` job. No runtime library, no
framework, no agent, no network call, no telemetry. The compiler runs locally
and in a browser; nothing it does reaches a network.

`vendor-docs/` holds IBM manuals as text, used to cite rules. They are not
redistributed by this project — see the repository's licence notes.

---

## Related pages

- [diagnostics.md](diagnostics.md) — `BANK-AUD-002` and `BANK-SEC-001` in full
- [language-reference.md](language-reference.md) — the `sensitive` modifier
- [error-handling.md](error-handling.md) — what a failure writes to the job log
