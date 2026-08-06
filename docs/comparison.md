# Comparison

Where BankLang sits against the alternatives, and what it is worse at. The
second half is what makes the first half worth reading.

---

## What BankLang is

A deterministic source-to-source compiler. A restricted, statically typed
language in, IBM Enterprise COBOL for z/OS 6.4 and its JCL out. No runtime, no
framework, no interpreter — what ships is a member you own.

The claim is narrow: **the compiler refuses programs whose failure modes are
silent.** A debit with no matching credit, a division with no stated rounding
mode, an audit event with no idempotency key, a `SQLCODE` test that cannot tell
a deadlock from a missing row, a loop that stops on its bound and reports
success. Those are the things it exists to stop, and they are all things a
reviewer can miss and a test suite can pass.

---

## Against an AI COBOL converter

|                     | AI converter                                 | BankLang                                |
| ------------------- | -------------------------------------------- | --------------------------------------- |
| Direction           | COBOL → something else                       | Something else → COBOL                  |
| Output determinism  | Not guaranteed                               | Byte-identical, verified by re-emission |
| What you can review | The output, once                             | The rule, once, and then every program  |
| Failure mode        | A plausible program that is subtly different | A refusal, with a diagnostic identifier |

The honest comparison is that they solve opposite problems. A converter is for
an estate somebody wants to leave. BankLang is for writing new programs _into_
an estate that is staying.

Where a converter wins outright: it works on the code you already have.
BankLang has copybook and DCLGEN import so a new program can share your records,
but it will not read your existing COBOL and it does not pretend to.

## Against Micro Focus, or any COBOL-on-another-platform product

|                        | Micro Focus                      | BankLang                    |
| ---------------------- | -------------------------------- | --------------------------- |
| Where the program runs | Their runtime, on their platform | z/OS, on IBM's compiler     |
| What you depend on     | A vendor's runtime, indefinitely | A `.cbl` member             |
| Migration risk         | You are moving the platform      | You are not moving anything |

Where they win outright: they are a complete, supported, decades-old product
with a runtime, a debugger, a test framework and a support contract. BankLang is
none of those things.

## Against hand-writing COBOL

This is the real comparison, because it is the one an actual team faces.

**Where hand-written COBOL wins:**

- Anything BankLang's subset cannot express, which is most of COBOL. No `ALTER`,
  no `GO TO` you write, no `PERFORM THRU` a range you chose, no floating point,
  no varying-length strings, no `FILLER`, no arbitrary edited pictures, no
  screen section, no communication section. Every one of those has a legitimate
  use somewhere.
- Reading a program a colleague wrote. Nobody on your team knows BankTS.
- Fifty years of tooling — debuggers, coverage, code analysers, everything IDz
  does — all of which understands COBOL and none of which understands BankTS.
  You get COBOL out, so most of it still applies to the output; none of it
  applies to the source.
- Fixing something at 3am. You will be reading the COBOL, and if the fix belongs
  in the source you have two files to change and a build to run.

**Where BankLang wins:**

- The refusals. Every one of them is a defect a review has to catch by reading,
  every time, on every program.
- The generated program is the same program every time. Same names, same
  paragraph structure, same failure path, same prologue. A reviewer who has read
  one has read the shape of all of them.
- One rule, applied everywhere. The bounds guard, the file status check, the
  `ON SIZE ERROR`, the single exit — you write them once in the emitter and get
  them in every program, rather than in the programs where somebody remembered.
- Traceability. Every generated line maps back to a source line, and the map is
  emitted rather than reconstructed.

---

## What BankLang is worse at

Stated plainly, because a page that lists only advantages is one nobody
believes.

1. **It has never been compiled by IBM Enterprise COBOL.** Everything local runs
   under GnuCOBOL, which is a different compiler.
   [divergences.md](divergences.md) is the list of places they are known or
   suspected to disagree, and `zos/README.md` is the kit for closing it. Until
   somebody runs that, every claim here stops at GnuCOBOL.

2. **The subset is small.** If your program needs something in the list above,
   BankLang cannot write it and you should not contort the program to fit.

3. **There is no debugger for the source.** You debug the COBOL. The source map
   tells you which BankTS line a COBOL line came from, which helps and is not
   the same thing.

4. **The test framework for the source is thin.** `test <name> for <entry
transaction>` becomes a zUnit case that runs on z/OS, and what it can assert
   is the PARM the step is started with and the calls the program makes — see
   `docs/zunit.md`. Anything beyond that, you test the
   generated program the way you test any COBOL program.

5. **Nobody on your team knows the language.** That is a real cost and it does
   not go away by writing a good language reference.

6. **It is one project with no support contract**, and the code that comes out
   of it is going into a system where being wrong costs money.

7. **Migration analysis does not exist.** Reading an existing estate — an
   inventory, a paragraph graph, extractors for the SQL and CICS in it — is on
   the roadmap and unbuilt. That is the piece a team would actually start with.

---

## When to use it

A new batch or online program, going into an existing z/OS estate, doing
something arithmetic that has to be right — accruals, settlement, posting,
reconciliation. Something where the failure that matters is a wrong number
reported as success rather than a program that will not compile.

## When not to

An estate you are leaving. A program that needs the parts of COBOL this subset
does not have. A team with nobody who wants to learn another language. Anything
where "it has never been compiled by the target compiler" is not an acceptable
sentence — which is a reasonable position, and is why that sentence is on this
page rather than at the bottom of a README.

---

## Related pages

- [divergences.md](divergences.md) — what is known not to be proved
- [verification.md](verification.md) — what is checked, and how
- [for-mainframe-engineers.md](for-mainframe-engineers.md) — the output, read construct by construct
