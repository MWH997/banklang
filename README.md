# BankLang

BankLang is a deterministic compiler/toolchain for writing banking-oriented
BankTS and generating readable COBOL-oriented artifacts. It is not an AI
converter.

## Status

The repository currently contains a deterministic compiler slice with
verification, local validation, banking safety diagnostics, and four examples.

Current capabilities:

- restricted BankTS parser, typechecker, and IR lowering across four examples,
  including local variable declarations, exact decimal arithmetic, transaction
  declarations with ledger postings and audit events, and sequential file
  declarations
- banking safety diagnostics for idempotency keys, audit events, balanced
  debit/credit postings, and file status (`BANK-TXN-001`, `BANK-AUD-001`,
  `BANK-AUD-003`, `BANK-LED-001`, `BANK-FILE-001`)
- source map coverage checking, so every traced symbol is proven to resolve
  into the generated COBOL
- deterministic COBOL emission
- deterministic copybook generation
- deterministic JCL emission
- source-map emission
- audit-report generation
- `bankc verify` with deterministic regeneration checks and a schema-hardened
  verification report
- `bankc test` with a local GnuCOBOL smoke-validation lane
- copybook inspection, type summary, and diff commands for the generated
  subset
- copybook JSON output for the generated subset
- evidence bundles and tester notes for the current demo slice

## Positioning

BankLang is a deterministic compiler/toolchain for a restricted banking
language called BankTS. BankTS is a TypeScript-like source language that keeps
the syntax familiar while removing dynamic JavaScript behavior, floating-point
money, and other runtime-dependent features. BankLang is not an AI converter
and it is not a general TypeScript to COBOL translator.

## Example

```ts
module AccountTransfer;

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
}

function validateAmount(amount: MoneyBDT): bool {
  return amount > 0.00;
}
```

This input becomes a deterministic COBOL program, generated copybook, source
map, and audit bundle for the `account-transfer` example.

## Non-goals

- arbitrary JavaScript or TypeScript runtime semantics
- AI-decided code generation
- IBM validation claims without IBM validation
- production-readiness claims before evidence exists

## Unsupported claims

- "AI writes COBOL for you"
- "full TypeScript support"
- "IBM Enterprise COBOL validated"
- "production-ready on z/OS"

## Layout

- `spec.md` and `architecture.md` define the project.
- `language-spec.md` defines the BankTS subset.
- `cobol-backend-spec.md` defines the COBOL output rules.
- `verification-spec.md` defines the testing and evidence rules.
- `docs/adr/` records the architectural decisions.
- `strategic-positioning.md` and `risk-register.md` define the credibility
  posture.
- `validation-lab-plan.md` defines the validation ladder.
- `examples/account-transfer/` contains the demo input program.
- `examples/batch-interest-accrual/` contains the control-flow example.
- `examples/account-posting/` contains the transaction example.
- `examples/account-file-batch/` contains the file-declaration example.
- `evidence/account-transfer/` captures the current demo evidence bundle.
- `evidence/batch-interest-accrual/` captures the second demo evidence bundle.
- `tester-notes/` records change-specific validation notes.
- `ai-reviews/` stores multi-AI Q/A and review trails.
- `prompts/` contains the specialist and workhorse prompt templates.

## Tooling

The initial implementation uses TypeScript and pnpm.

## Requirements

- Node.js 24 or newer. Node 24 is the supported runtime for local development,
  CI, and every Docker-based verification lane. Older major versions are not
  supported.
- pnpm 11.7.0, pinned through the `packageManager` field.

## Quick start

```bash
node --version # must be v24 or newer
pnpm install
pnpm bankc --help
pnpm bankc doctor
pnpm bankc check examples/account-transfer
pnpm bankc build examples/account-transfer
pnpm bankc layout examples/account-transfer
pnpm bankc verify examples/account-transfer
pnpm bankc test examples/account-transfer
pnpm bankc audit-report examples/account-transfer
pnpm bankc emit cobol examples/account-transfer
pnpm bankc emit copybooks examples/account-transfer
pnpm bankc emit jcl examples/account-transfer
pnpm bankc copybook inspect dist/copybooks/TRANSFER-REQUEST.cpy
pnpm bankc copybook types dist/copybooks/TRANSFER-REQUEST.cpy
pnpm bankc copybook diff dist/copybooks/TRANSFER-REQUEST.cpy dist/copybooks/TRANSFER-REQUEST.cpy
pnpm test:gnucobol   # optional, when cobc is installed
```

Generated artifacts are written under `dist/`.

If you want the exact output inventory, run `pnpm bankc --help` or inspect the
`dist/audit/` and `dist/layout/` folders after `build` or `layout`.

## Documentation

- `definitions.md`
- `repo-conventions.md`
- `research-dossier.md`
- `source-of-truth-matrix.md`
- `risk-register.md`
- `strategic-positioning.md`
- `validation-lab-plan.md`
- `RELEASE-CHECKLIST.md`
- `benchmark-and-evidence-plan.md`
- `ibm-engagement-strategy.md`
- `medium-article-brief.md`
- `ibm-email-brief.md`
- `tools-ai-design.md`
- `multi-ai-review-protocol.md`
- `a model-workhorse-validation.md`
- `a model-specialist-validation.md`
- `a model-free-workhorse-plan.md`

## Evidence

- `evidence/account-transfer/` contains the source, generated COBOL, generated
  copybook, source map, audit artifacts, validation matrix, and links to the
  tester notes used for the current demo slice.
- `evidence/batch-interest-accrual/` contains the source, generated COBOL,
  generated copybook, source map, audit artifacts, validation matrix, and
  links to the tester notes for the second example.
- `tester-notes/` contains per-change validation records, including build,
  copybook, layout, and GnuCOBOL smoke-check notes.
- `ai-reviews/` contains the review briefs and review rounds used for multi-AI
  checks.
- `prompts/` contains the reusable prompt templates used for a model, a model,
  and local review assistants.

## Validation

The current repo state has been verified with:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm bankc build examples/account-transfer`
- `pnpm bankc layout examples/account-transfer`
- `pnpm bankc audit-report examples/account-transfer`
- `pnpm bankc emit jcl examples/account-transfer`
- `pnpm bankc verify examples/account-transfer`
- `pnpm bankc test examples/account-transfer`
- `pnpm bankc verify examples/batch-interest-accrual`
- `pnpm bankc test examples/batch-interest-accrual`
- `pnpm bankc test examples/account-posting`
- `pnpm bankc test examples/account-file-batch`
- `pnpm bankc copybook inspect ...`
- `pnpm bankc copybook types ...`
- `pnpm bankc copybook diff ...`
- `pnpm test:gnucobol`

a model and a model were also checked directly during doc review work:

- a model API `generateContent` requests returned `200` with the configured
  `MODEL_API_KEY`.
- `a model --version` and `curl http://localhost:11434/api/tags` confirmed a
  local a model instance with `qwen2.5:14b` available.

## AI Review Workflow

BankLang uses prompt templates and review trails for bounded AI assistance.

- `prompts/a model-specialist-prompt-template.md` defines a specialist review
  prompt for a model 2.5 Flash.
- `prompts/a model-workhorse-prompt-template.md` defines the bounded workhorse
  prompt shape.
- `prompts/a model-review-prompt-template.md` defines the local review format.
- `ai-reviews/` stores the resulting review rounds and final decisions.

## Scope

The current milestone is a deterministic, auditable compiler slice for the
`account-transfer` and `batch-interest-accrual` examples. IBM Enterprise COBOL
for z/OS remains the primary target, with GnuCOBOL-compatible local validation
support where possible.
