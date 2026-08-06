# ADR-0001: Use BankTS as a restricted language

## Status

Accepted

## Context

The project needs a source language that is close enough to TypeScript syntax to
be approachable but narrow enough to map deterministically into COBOL-oriented
artifacts.

## Decision

BankLang will compile BankTS, a restricted TypeScript-like language with
explicit types, fixed layouts, and deterministic control flow.

## Consequences

- Arbitrary JavaScript semantics stay out of scope.
- The parser, typechecker, and backend can enforce stable source-to-COBOL
  mapping.
- Diagnostics can remain explicit instead of relying on runtime behaviour.

## References

- [BankLang Language Specification](../language-reference.md)
- [TypeScript official site](https://www.typescriptlang.org/)
