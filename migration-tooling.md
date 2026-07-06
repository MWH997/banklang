# Migration Tooling Specification

## 1. Purpose

BankLang must be useful in existing COBOL estates. That requires tooling around copybooks, dependency graphs, SQL extraction, CICS extraction, and behavioural tests.

The initial goal is not automatic COBOL-to-BankTS conversion. The initial goal is safe analysis and assisted migration.

## 2. Copybook tools

Required commands:

```txt
bankc copybook inspect ACCOUNT.cpy
bankc copybook types ACCOUNT.cpy --out account.bank.ts
bankc copybook diff ACCOUNT-V1.cpy ACCOUNT-V2.cpy
bankc copybook fixture ACCOUNT.cpy --count 100
```

Reports:

- field name
- COBOL path
- offset
- length
- type
- signedness
- scale
- packed/display/binary representation
- compatibility risk

## 3. COBOL analysis tools

Roadmap commands:

```txt
bankc cobol graph src/
bankc cobol sql src/
bankc cobol cics src/
bankc cobol copybooks src/
bankc cobol dead-code src/
```

Outputs:

- call graph
- paragraph graph
- copybook dependency graph
- SQL statement inventory
- CICS command inventory
- file usage inventory
- complexity report

## 4. Skeleton generation

Possible command:

```txt
bankc migrate skeleton legacy/ --out migrated/
```

This must not claim full correctness.

It may generate:

- BankTS record types from copybooks
- function skeletons from paragraph names
- SQL declaration stubs
- transaction boundary guesses
- migration notes

Generated skeletons must be marked as incomplete and require human review.

## 5. Test harness generation

Given copybooks and sample files, the tool should generate:

- fixture readers
- fixture writers
- expected-output scaffolds
- golden-test structure
- audit evidence structure

## 6. Semantic diff

Future capability:

```txt
bankc diff legacy.cbl generated.cbl
```

Expected comparison:

- paragraph inventory
- data item inventory
- SQL inventory
- file IO inventory
- CICS command inventory
- copybook usage
- obvious semantic mismatch warnings

## 7. Migration report

A migration report should include:

- source inventory
- copybook inventory
- SQL inventory
- CICS inventory
- VSAM inventory
- complexity hotspots
- unsupported constructs
- suggested migration order
- test coverage needs
