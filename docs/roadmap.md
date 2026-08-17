# Roadmap

Where the project has been, version by version, and what is still to come. Items
marked **done** have shipped; the rest are plans, and one of them says it has
not been started. The current release is 0.10.0. For what is missing today, and
what each gap costs, read [status-and-limits.md](status-and-limits.md) instead.

## v0.1: Compiler credibility

Theme: deterministic compiler skeleton.

Deliverables:

- BankTS parser subset
- typed AST
- decimal type metadata
- minimal IR
- readable COBOL emitter
- source map
- golden tests
- `bankc check`
- `bankc emit cobol`
- account-transfer pure-function demo
- audit report skeleton

## v0.2: Financial arithmetic

Theme: safe decimal and money behaviour.

Deliverables:

- decimal operations
- rounding policies
- overflow diagnostics
- currency types
- decimal property tests
- COBOL decimal mapping report

## v0.3: Copybook foundation

Theme: data-layout credibility.

Deliverables:

- BankTS record to copybook generation
- subset copybook parser
- layout inspector
- copybook diff
- fixture generator
- copybook roundtrip example

## v0.4: Banking diagnostics

Theme: domain safety.

Deliverables:

- diagnostic catalogue
- audit-event checker
- idempotency checker
- double-entry checker
- file-status checker
- source-map coverage checker

## v0.5: Batch and file programs

Theme: batch workload credibility.

Deliverables:

- batch job declaration
- sequential file IO
- generated file sections
- generated JCL example
- batch interest accrual example

## v0.6: Db2 profile

Theme: embedded SQL credibility.

Deliverables:

- SQL declarations
- host variable mapping
- SQLCA
- SQLCODE diagnostics
- CRUD lowering
- cursor support

## v0.7: CICS profile

Theme: online transaction credibility.

Deliverables:

- transaction declaration
- COMMAREA support
- CICS command generation
- response-code diagnostics
- syncpoint/rollback model

## v0.8: Migration analysis

Theme: legacy-estate relevance.

Deliverables:

- COBOL inventory tools: **done**, `bankc analyse`
- SQL extractor: **done**
- CICS extractor: **done**
- paragraph graph: **done**, as Mermaid
- copybook dependency graph: **done**, covering nested `COPY` references,
  missing and ambiguous members, `REPLACING` metadata and cycles, as Mermaid
  and JSON
- skeleton migration output: not started, and the least certain of the six. A
  skeleton that is wrong in a way a reader trusts is worse than none

See [migration-analysis.md](migration-analysis.md).

## v0.9: The depth each subsystem is missing

Theme: the second program of each kind, rather than the first.

Db2, in the order a batch meets them:

- ~~`WITH HOLD` cursors~~: done, `cursor ... hold`, with `BANK-SQL-008`
- ~~multi-row `FETCH`~~: done, `cursor ... rowset n`
- ~~isolation level on a statement~~: never missing, because the SQL is passed
  through
- ~~savepoints~~: the same, with `BANK-SQL-009` keeping `commit` out of raw SQL
- ~~`LOCK TABLE`~~: the same
- ~~`GET DIAGNOSTICS`~~: never missing either. An ordinary statement in a `sql`
  declaration, with host variables resolved like any other
- ~~scrollable cursors~~: done 2026-08-07, and it was the one that needed
  syntax rather than pass-through. `cursor ... scroll` emits
  `INSENSITIVE SCROLL CURSOR`, and `for each ... from n backward` walks the
  result set from a chosen row with `FETCH ABSOLUTE :position`

~~zUnit test generation~~: done, `test <name> for <entry transaction>` and
`bankc zunit`. It was blocked on not having IBM's schema, and what unblocked it
was test cases IBM's own generator produced, published in public repositories:
every shape in the three artifacts is copied from one of those and cited in
[zunit.md](zunit.md). Two
values are inferred rather than observed and say so, in D20 and D21. No
generated case has been run. That is what the z/OS kit is for.

## v1.0

What has to be true before the interfaces stop moving:

- a stable CLI
- a documented language subset
- stable audit schemas
- a deterministic output guarantee
- a security policy
- an SBOM
- a signed release target
- demos that run something end to end
- a compatibility matrix
- a contributor process

## Researched, not built

Four integrations were researched during planning and never started. They are
here rather than as pages of their own, because a page describing something that
does not exist reads as though it does. What is worth keeping is the reading.

**IBM Dependency Based Build.** DBB builds COBOL, PL/I and Assembler as part of
a DevOps pipeline, and a generated program has to reach a real z/OS build rather
than a script invented here. What BankLang would have to emit is the dependency
graph it already knows: source, copybooks, Db2 precompile and CICS translation
metadata, and the compiler options `bankc` already writes onto the `CBL`
statement.
[Overview](https://www.ibm.com/docs/en/adffz/dbb/3.0.x?topic=dependency-based-build-overview) ·
[With IDz](https://www.ibm.com/docs/en/developer-for-zos/17.0.x?topic=code-integrating-dependency-based-build-developer-zos)

**z/OS Connect.** Contract-first OpenAPI 3.0 over CICS and IMS. The interesting
half for a compiler is copybook-to-OpenAPI and back, which is the same layout
problem `bankc copybook import` already solves in one direction.
[Designer](https://www.ibm.com/docs/en/zos-connect/3.0.0?topic=30-developing-apis-using-zos-connect-designer) ·
[Calling APIs](https://www.ibm.com/docs/en/zos-connect/3.0.0?topic=20-developing-zos-applications-call-apis)

**Galasa**, for deep integration tests against real CICS and IMS, once anything
runs on z/OS at all. **COBOL Check** was the other candidate and is marked
Emeritus by the Open Mainframe Project, so it would need evaluating before
anything depended on it.
[Galasa](https://openmainframeproject.org/projects/galasa/) ·
[COBOL Check](https://github.com/openmainframeproject/cobol-check)

**IBM Z Open Editor.** The editor work that did happen (the LSP and the VS Code
extension) went its own way. What is still unbuilt is the part that would make
a generated program navigable from the editor a z/OS developer already uses:
copybook preview, generated-COBOL preview, and source-to-COBOL navigation.
[Z Open Editor](https://ibm.github.io/zopeneditor-about/Docs/introduction.html) ·
[LSP](https://microsoft.github.io/language-server-protocol/)
