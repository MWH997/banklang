# zUnit integration

`bankc zunit <project>` writes the three artifacts IBM's z/OS Automated Unit
Testing Framework needs to run a generated program on a mainframe and report
pass or fail.

```bash
pnpm bankc zunit examples/zunit-tested-posting
```

```
Wrote dist/zunit/TZUNITTE.bzucfg
Wrote dist/zunit/TZUNITTE.cbl
Wrote dist/zunit/TZUNITTE.jcl
```

This page is longer than the feature, on purpose. Every shape in those files is
copied from test cases IBM's own generator produced, and each one is cited
below — because the failure mode here is not a compiler error, it is a file
somebody uploads to a mainframe and submits.

---

## Where the shapes come from

IBM's zUnit documentation is not in `vendor-docs/`, and `ibm.com/docs` refuses
automated retrieval. What this generator was built against instead is **test
cases IBM's editor produced**, published in public repositories:

| Source                                                                                                      | What it settled                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`retirementCalculator/testcase/EBUD01.bzucfg`](https://github.com/rbsmall/retirementCalculator)            | The configuration at 4.0.0.0: root element, namespace, element order            |
| [`retirementCalculator/testcase/TEBUD01.cbl`](https://github.com/rbsmall/retirementCalculator)              | The whole driver: `BZUGETEP`, `BZUASSRT`, `BZU_INIT`, stubs, `GTMEMRC`          |
| [`retirementCalculator/jcls/RUNTAZ.jcl`](https://github.com/rbsmall/retirementCalculator)                   | `EXEC PROC=EQAPPLAY`, its DDs, and `PRM='STOP=E,REPORT=XML'`                    |
| [`myapp/.../DATSUB.bzucfg` and `TDATSUB.cbl`](https://github.com/nlopez59/myapp)                            | A case for a program **with a parameter**: supplied values and compares         |
| [`SampleMortgage/cobol/hello.bzucfg`](https://github.com/Vijayalakshmie/SampleMortgage)                     | A case at 3.0.0.0, and one with no playback file at all                         |
| [`genapp-demo/tests/LGICDB01.bzucfg`](https://github.com/wfezzani/genapp-demo)                              | `type="CICS"`, and `TLGICDB01` truncated to the member name `TLGICDB0`          |
| [`retirementCalculator/application-conf/Cobol.properties`](https://github.com/rbsmall/retirementCalculator) | `cobol_compileDebugParms=TEST` — the program under test is compiled with `TEST` |

Two values in the generated configuration are **inferred** rather than observed.
They are named as such in [divergences.md](divergences.md), D20 and D21, with
the fallback written down for each.

---

## Writing a test

A test is a declaration in the same file as the program, in the same language:

```
test postsBothLegs for postOne {
  given account = "0001234567890123";
  given amount = 100.00;
  given idempotencyKey = "IDEM-0001";
  expect debit("0001234567890123", 100.00);
  expect credit("SUSPENSE", 100.00);
  expect audit("POSTED", "IDEM-0001");
}
```

It compiles to nothing. `tests/zunit.test.ts` asserts that a program's COBOL is
byte for byte what it is with the tests removed, because an artifact that ships
must not depend on the tests written against it.

### Why the surface is this narrow

The driver is a **separate program**. The runner enters the program under test
through its entry point and intercepts the modules it calls; it does not share
its storage. So what a case can observe is:

- the LINKAGE the step is started with — for a batch program, its PARM
- the calls the program makes, and what it passed on each

and that is exactly what `given` and `expect` are. A test that appeared to
assert on the program's `WORKING-STORAGE` would be reporting a pass nobody
checked, which is worse than having no test.

### `given`

One scalar parameter of the entry transaction, which is one field of the PARM.
A record parameter is refused (`BANK-TEST-003`): it is a buffer the program
fills from a file, so there is nothing for a caller to supply.

Values are literals and only literals (`BANK-TEST-004`). The generated driver
holds them in `MOVE` statements and evaluates nothing — a test that computed its
expected value would be a second implementation of the program, running on the
mainframe, with nothing checking it.

### `expect`

The calls to `BANKLEDG` and `BANKAUDT`, **in order**. The generated stub counts
each call and compares it against the expectation for that position, so a debit
then a credit is not a credit then a debit. Both directions of miscount fail:

- fewer calls than expected — the driver reads the counter after the program
  returns, because a stub that is never entered runs no code and could not
  notice its own absence
- more calls than expected — the stub's `WHEN OTHER`

### What a test cannot say yet

- **Nothing about files.** A generated case stubs `BANKLEDG` and `BANKAUDT`;
  everything else the program calls, and every dataset it opens, is the real
  one. Supplying a record to a `READ` needs the file callback's end-of-file
  convention, which is the one part of the observed cases that is a placeholder
  in all of them.
- **Nothing about a CICS or IMS program** (`BANK-TEST-002`). A CICS case is
  `type="CICS"` and a running region; an IMS program is entered by the region
  with its PCBs. This generator writes `type="BTCH"` cases.
- **Nothing about the return code.** The driver's own `RETURN-CODE` is how it
  answers the runner — IBM's generated cases set 0 and 4 in places whose meaning
  is not documented anywhere retrievable — so asserting the program's return
  code through it would be writing over the channel being read.

---

## The three artifacts

### The configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<runner:RunnerConfiguration xmlns:runner="http://www.ibm.com/zUnit/4.0.0.0/TestRunner" id="d012252c-…">
  <runner:options contOnTestCaseError="false" … fileIOCapture="compat"/>
  <runner:testCase moduleName="TZUNITTE">
    <test name="POSTSBOTHLEGS" entry="TEST_POSTSBOTHLEGS" type="BTCH"
          init="BZU_INIT" term="BZU_TERM" program="ZUNITTES" … noPlaybackData="true"/>
  </runner:testCase>
  <runner:intercept module="ZUNITTES" stub="false" lengths="73" parmtype="I" retcode="true" exist="false"/>
  <runner:intercept module="BANKLEDG" stub="true" lengths="48" parmtype="I" retcode="false" exist="false"/>
  <runner:intercept module="BANKAUDT" stub="true" lengths="96" parmtype="I" retcode="false" exist="false"/>
  <runner:playback moduleName="ZUNITTES"/>
  <runner:fileAttributes hlqDdName="AZUHLQ"/>
</runner:RunnerConfiguration>
```

- **`moduleName`** is `T` in front of the program's name, truncated to the eight
  characters a member name has — the rule that turned `LGICDB01` into
  `TLGICDB0`.
- **`lengths`** is the byte count of what the module is passed, and nothing at
  run time checks it. `BANK-LEDGER-INTERFACE` is `X(6) + X(32) + S9(16)V99
COMP-3` — six, thirty-two and **ten**, because packed decimal is not one byte
  a digit. The layout is declared once, in `RUNTIME_INTERFACES`, so the number
  and the picture the program emits cannot drift apart; a test asserts it.
- **`id`** is a UUID that the driver's `BZU_INIT` answers with, so the two must
  agree. It is derived from the program and its test names rather than drawn at
  random: a compiler whose first claim is determinism cannot write a different
  file on every build of an unchanged program.

### The driver

One compilation unit holding several sibling programs, which is the shape IBM's
generator produces:

| Program                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `TEST_<NAME>`                  | One per test: zeroes the counters, builds the PARM, enters the program |
| `BZU_TEST`                     | The runner's callback around the program under test                    |
| `BZU_INIT`/`BZU_TERM`          | Run before and after each test; `BZU_INIT` answers with the case's id  |
| `PGM_BANKLEDG`, `PGM_BANKAUDT` | The stubs the calls arrive at, and where they are checked              |
| `GTMEMRC`                      | Hands out one call counter per stubbed module                          |

It opens with the compiler options IBM's generator uses, and each one earns its
place:

```cobol
       PROCESS NODLL,NODYNAM,TEST(NOSEP),NOCICS,NOSQL,PGMN(LU),NOSEQ
```

`TEST` is what puts the hooks in that calls are intercepted through — the
mechanism is the z/OS Debugger's, which is why the info block comes from a
copybook named `EQAITERC` — and `PGMN(LU)` is what lets `TEST_POSTSBOTHLEGS` be
a program-name at all. **The program under test needs `TEST` as well**; the
generated JCL says so, and a program compiled without it runs and calls the real
`BANKLEDG`.

Entering the program is IBM's sequence, copied:

```cobol
           CALL BZUGETEP USING BY REFERENCE PROGRAM-NAME AZ-CSECT
               RETURNING AZ-EP-PTR
           SET ADDRESS OF AZ-PROC-PTR TO AZ-EP-PTR
           CALL AZ-PROC-PTR USING BANK-PARM
```

and so is reporting a failure:

```cobol
           CALL BZUASSRT USING BZ-P1 BZ-P2 BZ-P3 BZ-ASSERT
```

where `BZ-P1` is 4, `BZ-P2` is 2001 and `BZ-P3` is `'AZU'`.

One thing this generator does **not** copy: IBM's editor renames every data item
to `ZUT00000001` and puts the real name in a comment beside it. That is an
artifact of its model keying items by identifier, and nothing in the runner
reads a data name — the failure message carries the name as a literal — so the
generated driver keeps the names the program uses.

### The job

```
//COMPILE  EXEC IGYWCL
//COBOL.SYSIN DD DISP=SHR,DSN=BANKLANG.ZUNIT.COBOL(TZUNITTE)
//LKED.SYSLMOD DD DISP=SHR,DSN=BANKLANG.TEST.LOADLIB(TZUNITTE)
//RUNNER   EXEC PROC=EQAPPLAY,COND=(4,LT),
//         BZUCFG=BANKLANG.ZUNIT.BZUCFG(TZUNITTE),
//         BZUCBK=BANKLANG.TEST.LOADLIB,
//         BZULOD=BANKLANG.TEST.LOADLIB,
//         PRM='STOP=E,REPORT=XML'
```

`EQAPPLAY` is the procedure a working pipeline submits the runner through. Older
documentation names `BZUPPLAY`; the observed job and the zAppBuild properties
that drive it both use `EQAPPLAY`, and the parameter string is theirs.

No PARM is passed to the compile step: the options are in the driver's `PROCESS`
statement, which is where Enterprise COBOL reads them from and which overrides
what a procedure passes.

---

## What this has been through, and what it has not

**It compiles.** `tests/zunit.test.ts` runs `cobc -fsyntax-only` over a
generated driver under GnuCOBOL's default dialect and under
`tools/banklang-ibm.conf`, and both accept it — nested sibling programs, `ENTRY`
statements, procedure pointers and all.

**That evidence is narrower than it sounds.** `COPY EQAITERC` resolves locally
to [`runtime/zunit/EQAITERC.cpy`](../runtime/zunit/EQAITERC.cpy), a stand-in
declaring the two fields the driver names — because IBM's own copybook is not
here. What the compile establishes is that the syntax is accepted and every name
resolves. It establishes nothing about the info block's layout.

**No generated case has been run.** Not locally — there is no runner here — and
not on z/OS, because [zos/README.md](../zos/README.md) has no `RESULTS.md`
yet. This is the "compiled" grade in [evidence/GRADES.md](../evidence/GRADES.md)
and not the "executed" one, and the two inferred values in D20 and D21 are the
kind of thing a single real run would settle.

## Related pages

- [divergences.md](divergences.md) — D20 and D21, the inferred values
- [verification.md](verification.md) — what each grade of evidence means
- [examples/zunit-tested-posting](../examples/zunit-tested-posting/README.md)
- [ZUnit overview](https://www.ibm.com/docs/en/developer-for-zos/15.0.x?topic=applications-zos-automated-unit-testing-framework-zunit)
- [Integrating IBM zUnit Testing into a CI/CD pipeline](https://www.ibm.com/support/pages/system/files/inline-files/Integrating%20IBM%20zUnit%20Testing%20into%20an%20open%20and%20modern%20CICD%20pipeline%20-%20v1.2_0.pdf)
