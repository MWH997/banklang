# Comparison

This page compares BankLang with the tools and workflows a team is most likely
to consider. It describes the trade-offs as well as the cases where BankLang is
not the right fit.

---

## What BankLang is

A deterministic source-to-source compiler. A restricted, statically typed
language goes in; IBM Enterprise COBOL for z/OS 6.4 and related JCL come out.
There is no runtime, framework, or interpreter. The generated members are
ordinary files that a team can review and own.

The compiler checks a defined set of failure modes that are easy to miss in
review: an unbalanced debit and credit, a division with no stated rounding
mode, an audit event with no idempotency key, a `SQLCODE` test that cannot
distinguish a deadlock from a missing row, and a loop that reports success after
stopping at its bound. These checks are a subset of the language's semantics,
not a guarantee that every banking defect is found.

---

## Against COBOL conversion tools

|                     | Conversion tool                              | BankLang                                |
| ------------------- | -------------------------------------------- | --------------------------------------- |
| Direction           | COBOL → something else                       | Something else → COBOL                  |
| Output determinism  | Not guaranteed                               | Byte-identical, verified by re-emission |
| What you can review | The output, once                             | The rule, once, and then every program  |
| Failure mode        | A plausible program that is subtly different | A refusal, with a diagnostic identifier |

These tools address different workflows. A converter is for transforming an
existing estate. BankLang is for writing new programs into an estate that will
continue to run COBOL.

If the goal is to transform existing COBOL, a conversion tool is the better
fit. BankLang can import copybooks and DCLGEN members so a new program can
share existing record layouts. `bankc analyse` can also inventory existing
COBOL, produce paragraph and copybook dependency graphs, and extract selected
files, SQL, CICS, IMS, MQ, and call information. It reads source text; it does
not semantically parse or convert the COBOL.

## Against COBOL runtime products

|                        | Micro Focus                      | BankLang                    |
| ---------------------- | -------------------------------- | --------------------------- |
| Where the program runs | Their runtime, on their platform | z/OS, on IBM's compiler     |
| What you depend on     | A vendor's runtime, indefinitely | A `.cbl` member             |
| Migration risk         | You are moving the platform      | You are not moving anything |

These products provide a supported runtime, debugger, test framework, and
support contract. BankLang does not provide those things; it generates COBOL
for IBM Enterprise COBOL on z/OS.

## Against hand-writing COBOL

For a new program, hand-written COBOL remains the direct alternative.

**Where hand-written COBOL wins:**

- Anything BankLang's subset cannot express, which is most of COBOL. No `ALTER`,
  no `GO TO` you write, no `PERFORM THRU` a range you chose, no floating point,
  no varying-length strings, no `FILLER`, no arbitrary edited pictures, no
  screen section, no communication section. Every one of those has a legitimate
  use somewhere.
- Reading a program a colleague wrote. Nobody on your team knows BankTS.
- Fifty years of tooling (debuggers, coverage, code analysers, everything IDz
  does) all of which understands COBOL and none of which understands BankTS.
  You get COBOL out, so most of it still applies to the output; none of it
  applies to the source.
- Fixing something at 3am. You will be reading the COBOL, and if the fix belongs
  in the source you have two files to change and a build to run.

**Where BankLang can help:**

- The refusals. Every one of them is a defect a review has to catch by reading,
  every time, on every program.
- The generated program is the same program every time. Same names, same
  paragraph structure, same failure path, same prologue. A reviewer who has read
  one has read the shape of all of them.
- One rule, applied everywhere. The bounds guard, the file status check, the
  `ON SIZE ERROR`, the single exit: you write them once in the emitter and get
  them in every program, rather than in the programs where somebody remembered.
- Traceability. Every generated line maps back to a source line, and the map is
  emitted rather than reconstructed.

---

## Trade-offs and limitations

1. **It has never been compiled by IBM Enterprise COBOL.** Everything local runs
   under GnuCOBOL, which is a different compiler.
   [divergences.md](divergences.md) lists places where the compilers may
   disagree, and `zos/README.md` describes how to collect the missing evidence.
   Until somebody runs it, claims about generated-program behavior stop at
   GnuCOBOL.

2. **The subset is small.** If your program needs something in the list above,
   BankLang cannot write it and you should not contort the program to fit.

3. **There is no debugger for the source.** You debug the COBOL. The source map
   tells you which BankTS line a COBOL line came from, which helps and is not
   the same thing.

4. **The test framework for the source is thin.** `test <name> for <entry
transaction>` becomes a zUnit case to run on z/OS, and what it can assert is
   the PARM the step is started with and the calls the program makes: see
   `docs/zunit.md`. Other behavior must be tested in the generated program, as
   with any COBOL program.

5. **Nobody on your team knows the language.** That is a real cost and it does
   not go away by writing a good language reference.

6. **It is one project with no support contract**, and the code that comes out
   of it is going into a system where being wrong costs money.

7. **Migration analysis is deliberately shallow.** `bankc analyse` inventories
   an existing estate, draws paragraph and copybook dependency graphs, and
   extracts files, SQL, CICS, and calls. It reads source text rather than
   compiling or semantically parsing it, follows copybook names without
   expanding their content, and is not a conversion estimate. See
   [migration-analysis.md](migration-analysis.md).

---

## When it may fit

A new batch or online program, going into an existing z/OS estate, doing
something arithmetic that has to be right: accruals, settlement, posting,
reconciliation. Something where the failure that matters is a wrong number
reported as success rather than a program that will not compile.

## When it does not fit

An estate you are leaving. A program that needs the parts of COBOL this subset
does not have. A team with nobody who wants to learn another language. Anything
where "it has never been compiled by the target compiler" is not an acceptable
sentence, which is a reasonable position.

---

## Related pages

- [divergences.md](divergences.md): what is known not to be proved
- [verification.md](verification.md): what is checked, and how
- [for-mainframe-engineers.md](for-mainframe-engineers.md): the output, read construct by construct
