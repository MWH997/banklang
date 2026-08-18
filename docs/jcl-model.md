# The generated job

What `bankc` emits alongside the COBOL, what in it is a placeholder, and what a
site changes.

The job is meant to be submittable, not a template to fill in. Every step, DD
and parameter in it is taken from IBM's own cataloged procedures as the
Programming Guide prints them. It did not
always work that way: the compile step had no `STEPLIB` and none of
the sixteen work files, the link-edit ran `PGM=IEWL` with no LE libraries, the
run step had no `STEPLIB` at all (so a job that compiled and linked perfectly
ended S806), and the dataset names were built by turning the build path into
qualifiers, which produced `DIST.COBOL.BATCHINTERESTACCRUAL` and a JCL error
before the compiler was reached.

---

## Two forms

### Cataloged: the default

```jcl
//COMPILE  EXEC IGYWCL,
//             LNGPRFX='IGY.V6R4M0',LIBPRFX='CEE',
//             PGMLIB='BANKLANG.LOADLIB',GOPGM=BATCHINT
//COBOL.SYSIN    DD DISP=SHR,DSN=BANKLANG.COBOL(BATCHINT)
//LKED.SYSLIB    DD DISP=SHR,DSN=BANKLANG.OBJLIB
//               DD DISP=SHR,DSN=CEE.SCEELKEX
//               DD DISP=SHR,DSN=CEE.SCEELKED
```

`IGYWCL` is IBM's two-step compile-and-link procedure. It supplies every
`STEPLIB`, all sixteen work files, `SYSMDECK`, the LE link libraries and
`REGION=0M`, so none of them can be forgotten here. The job overrides only what
the procedure's own parameter list documents as the caller's: `SYSIN`, `SYSLIB`,
and where the load module goes.

That is what a shop submits, it is short, and it is right by construction.

One thing to know: `PGMLIB` must name a load library that already **exists**.
The procedure allocates `SYSLMOD` with `DISP=(MOD,PASS)`, so a library that does
not exist is created, passed, and gone at end of job.

### Expanded

`emitJcl(program, { mode: "expanded" })` writes the same steps out in full,
generated from `IGYWCL`'s printed text: the three `STEPLIB` libraries, `SYSUT1`
through `SYSUT15` and `SYSMDECK`, `REGION=0M` on both steps, `PGM=IEWBLINK`, the
two LE link libraries on the binder's `SYSLIB`, and `COND=(8,LT,COBOL)` rather
than `(4,LT)`: a compile that only warned returns 4 and its object module is
still worth binding.

For a site with no `IGYWCL` installed, or to see what the procedure does.

A program needing the CICS translator, the Db2 precompiler or the Report Writer
precompiler is expanded whatever the caller asked: those steps run **ahead of**
the compiler, and a cataloged procedure has nowhere to put one.

---

## The steps, in order

| Step                | When                                | What                                                                                                                               |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RWPRE`             | The program declares a `report`     | `SPCRWCOB`, the stand-alone Report Writer precompiler (5798-DYR). Report Writer is not part of Enterprise COBOL.                   |
| `TRANSLAT`          | The program is a `cics transaction` | `DFHECP1$`. `EXEC CICS` has to be translated before any compiler reads the source.                                                 |
| `PRECOMP`           | The program has embedded SQL        | `DSNHPC`, writing the DBRM.                                                                                                        |
| `COMPILE` / `COBOL` | Always                              | `IGYWCL`, or `IGYCRCTL` and `IEWBLINK` written out.                                                                                |
| `BIND`              | The program has embedded SQL        | `IKJEFT01`. Binds the package **and a plan**: `RUN` names a plan, so a package alone leaves the program with nothing to run under. |
| `RUN`               | The program is not CICS             | `EXEC PGM=` the load module, or `IKJEFT1B` for a Db2 program.                                                                      |

Report Writer runs first because it passes `EXEC ... END-EXEC` through
unchanged, so the CICS translator and the Db2 precompiler still find their own
blocks; the other way round each would have to read a `REPORT SECTION`, which
neither knows.

### Why `IKJEFT1B` for the run and `IKJEFT01` for the bind

A program with embedded SQL cannot be started by `EXEC PGM=`. It needs a thread
to Db2, and the DSN command processor is what establishes one. The step runs
TSO in batch and `DSN RUN` attaches the program under a plan.

The two entry points differ on an abend. Under `IKJEFT01` an abending program
does **not** abend the step: TSO catches it and the step ends _normally_ with
condition code 12, so the `DELETE` on the output datasets is never honoured and
a half-written dataset is catalogued after all. `IKJEFT1B` terminates the step
with X'04C'.

The bind keeps `IKJEFT01` for the opposite reason: a `BIND` that only warns
returns 4, and `IKJEFT1B` stops the moment anything returns non-zero, so the
plan would go unbound because the package warned.

### A CICS program has no run step

It is started by a transaction identifier in a region, not by `EXEC PGM` in a
job. The generated job says so rather than writing a step that cannot work.

---

## The DDs a batch run step gets

| DD                    | Why                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEPLIB`             | The load library the job just wrote to, then `CEE.SCEERUN` and `SCEERUN2`. Without it the step ends S806 having built the module perfectly. |
| One per declared file | Named for what the generated `SELECT` assigns to.                                                                                           |
| `SYSOUT`              | `DISPLAY ... UPON SYSOUT`.                                                                                                                  |
| `CEEOPTS`             | Language Environment run-time options. See below.                                                                                           |
| `CEEDUMP`, `SYSUDUMP` | Without these an abend produces no readable dump and the return code is all that is left.                                                   |
| `SYSIN`               | Only when the program `ACCEPT`s a card from it.                                                                                             |
| `SORTWK01`–`03`       | Only when the program runs a real `SORT`. A `MERGE` needs none: its inputs already arrive in order.                                         |

### Disposition

An input file is `DISP=SHR`. An updated file is `DISP=OLD`: `NEW` would create
an empty one and the program would find nothing in it, and `SHR` would let a
second job read it half-updated.

An output file is `DISP=(NEW,CATLG,DELETE)`, and the abnormal disposition is the
one that matters: a step that dies halfway through writing has produced a
partial dataset, and cataloguing it invites the next job to read it as though it
were a complete day.

`DCB=(RECFM=FB,LRECL=n,BLKSIZE=0)`, with the record length the `FD` describes.
`BLKSIZE=0` asks for a system-determined block size, and `BLOCK CONTAINS 0
RECORDS` in the program is the other half of it.

### `COND`

Every step after the first carries one, so a failed compile does not reach the
run step and execute whatever the load library already held (the previous
version) under a return code that says the job worked.

`COND=(4,LT)` everywhere except the expanded link-edit, which uses IBM's own
`COND=(8,LT,COBOL)`.

---

## Language Environment options

```jcl
//CEEOPTS  DD *
  TERMTHDACT(UADUMP)
  TRAP(ON)
/*
```

A step that states none runs on whatever the installation's defaults are. The
two written by default are about whether a bad night can be diagnosed at all.

The rest is a site's, stated in `banklang.json`:

```json
{
  "runtimeOptions": [
    "TERMTHDACT(UADUMP)",
    "TRAP(ON)",
    "HEAP(4M,1M,ANYWHERE,KEEP)",
    "STACK(1M,1M,ANYWHERE)"
  ]
}
```

A long-running batch's heap and stack depend on the region and the data, neither
of which the compiler can see. It does not guess at them.

---

## What is a placeholder

Everything in this table. The job runs as written on a system that happens to
match; on any other it is these lines that change.

| Placeholder                         | Default   | What it is                                                     |
| ----------------------------------- | --------- | -------------------------------------------------------------- |
| `BANKLANG.COBOL`                    |           | Source library the compile reads the member from               |
| `BANKLANG.COPYLIB`                  |           | Copybook library, when `copybookMode` is `copy`                |
| `BANKLANG.LOADLIB`                  |           | Load library the link-edit writes to and the run step searches |
| `BANKLANG.OBJLIB`                   |           | Object library the binder resolves static `CALL`s from         |
| `BANKLANG.DBRMLIB`                  |           | Where the Db2 precompiler writes the DBRM                      |
| `BANKLANG.<DD>`                     |           | Dataset for each declared file                                 |
| `IGY.V6R4M0`                        | `LNGPRFX` | Where Enterprise COBOL is installed                            |
| `CEE`                               | `LIBPRFX` | Where Language Environment is installed                        |
| `DSN.SDSNLOAD`, `DSN`               |           | Db2 load library and subsystem                                 |
| `CICSTS.SDFHLOAD`                   |           | CICS translator library                                        |
| `MQM.SCSQ*`                         |           | MQ copybook, stub and run-time libraries                       |
| `RW.SCXRPREC`, `RW.SCXRRUN`         |           | Report Writer precompiler and run time                         |
| `(BANKLANG)` on the JOB card        |           | Accounting information                                         |
| `CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID` |           | Job card conventions                                           |
| `UNIT=SYSALLDA,SPACE=(CYL,(1,1))`   |           | Allocation for an output dataset                               |
| `SORTWK` `SPACE=(CYL,(5,5))`        |           | Sort work allocation                                           |

The names are eight characters or fewer per qualifier and well inside 44 in
total, which `pnpm lint:conformance` checks.

---

## The PARM

A batch program with scalar entry parameters is entered with the job's PARM,
behind the halfword length z/OS puts there. The job writes a template and a
comment block naming each field:

```jcl
//* PARM layout, positional, one field per entry parameter:
//*   idempotencyKey X(36) (36)
//RUN      EXEC PGM=ACCOUNTF,PARM='xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
//             REGION=0M,COND=(4,LT)
```

Replace the `x`s. A PARM shorter than the fields it feeds ends the step with
return code 12 rather than being read past: the trailing parameters would
otherwise be whatever the region left there, which for an idempotency key means
a duplicate posting nobody can trace.

For a Db2 program the PARM goes on the `DSN RUN` subcommand instead.

---

## Related pages

- [for-mainframe-engineers.md](for-mainframe-engineers.md): reading the generated COBOL
- [error-handling.md](error-handling.md): what each return code means
- [target-conformance.md](target-conformance.md): the JCL rules and their citations
