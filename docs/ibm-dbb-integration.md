# IBM Dependency Based Build Integration

## Purpose

BankLang should align with real z/OS build workflows instead of inventing isolated build scripts.

## Source of truth

Use IBM DBB documentation.

## Research finding

IBM DBB builds traditional z/OS applications such as COBOL, PL/I, and Assembler as part of modern DevOps pipelines. IBM Developer for z/OS can integrate with DBB for personal builds from Git repositories on z/OS.

## BankLang roadmap

BankLang should eventually emit:

- generated source dependency graph
- copybook dependency graph
- Db2 precompile metadata
- CICS translation metadata
- compiler options notes
- artifact inventory consumable by DBB-style scripts

## v0.1 scope

Document only. Do not implement DBB integration yet.

## References

- [IBM Dependency Based Build overview](https://www.ibm.com/docs/en/adffz/dbb/3.0.x?topic=dependency-based-build-overview)
- [IBM DBB product page](https://www.ibm.com/products/dependency-based-build)
- [Integrating DBB and Developer for z/OS](https://www.ibm.com/docs/en/developer-for-zos/17.0.x?topic=code-integrating-dependency-based-build-developer-zos)
