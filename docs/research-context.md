# Research Context

## Purpose

This document explains where BankLang sits relative to AI-based COBOL modernization research and open COBOL benchmark work.

## Key conclusion

Recent research supports the BankLang stance:

> AI can assist modernization, but correctness needs validation, tests, and compiler/tooling discipline.

## Relevant findings

### IBM COBOL-to-Java transformation testing

IBM research on automated testing of COBOL-to-Java transformation states that LLM-based transformation output cannot simply be trusted and requires validation for semantic equivalence.

### COBOL-Coder

COBOL-Coder research reports that general-purpose LLMs struggle with COBOL generation/translation, while compiler-guided validation improves reliability.

### Mainframe API extraction research

IBM research around API enablement for mainframe applications emphasizes static analysis, control-flow/data-flow reasoning, and validation on IBM Z systems.

## BankLang consequence

BankLang should not compete on “AI writes COBOL.” It should compete on deterministic compilation and evidence.

## References

- [Automated Testing of COBOL to Java Transformation](https://arxiv.org/abs/2504.10548)
- [Quality Evaluation of COBOL to Java Code Transformation](https://arxiv.org/abs/2507.23356)
- [COBOL-Coder](https://arxiv.org/abs/2604.03986)
- [Enabling Communication via APIs for Mainframe Applications](https://arxiv.org/abs/2408.04230)
