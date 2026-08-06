# End-of-day settlement

A multi-step job: extract → sort → post → report. Four programs, one JCL stream,
real step dependencies. This is what a batch actually looks like.

## The job

```
EXTRACT   EODEXTRA   selects what settles, posts nothing
SORTITEM  SORT       orders it by branch and account
POST      EODPOST    moves the money, holds a restart position
REPORT    EODREPOR   prints what the morning reads
```

```bash
pnpm bankc job examples/end-of-day-settlement
```

That builds each program exactly as `bankc build` would — load module, build
job, copybooks, source map, audit bundle — and then writes the one thing none of
them has on its own: `dist/jcl/EODSETL.jcl`, the stream that runs them.

## Why four programs and not one

Each step has a different relationship with a rerun, and that is the whole
reason a night is split up:

| Step    | Rerunnable?                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| EXTRACT | Yes, over the same input. It posts nothing, so a bad **selection** — the thing most likely to be wrong — costs one step.                  |
| SORT    | Yes. It is a sort.                                                                                                                        |
| POST    | **No.** Posting the first forty thousand items again is forty thousand duplicate entries. This is the step that keeps a restart position. |
| REPORT  | Yes. Printing it twice costs paper.                                                                                                       |

A single program doing all four would have the restart properties of the worst
of them.

## What ties the steps together

The datasets, and they are not stated in `job.json`. A file's DSN is derived
from its BankLang name, so two programs that declare a file with the same name
are already reading and writing the same dataset:

```
EXTRACT  writes  settlementExtract  → BANKLANG.SETTLEME
SORTITEM reads   BANKLANG.SETTLEME, writes BANKLANG.SORTEDSE
POST     reads   sortedSettlement   → BANKLANG.SORTEDSE
POST     writes  postedSettlement   → BANKLANG.POSTEDSE
REPORT   reads   postedSettlement   → BANKLANG.POSTEDSE
```

The job does not have to be told what the programs already agree on, and it
cannot get it wrong. What it does check is that two programs in one stream do
not resolve to the same eight-character load module name, and that no two files
in one program resolve to the same DD name (`BANK-FILE-012`) — either of which
is one step writing over what another is about to read, under a name that looks
deliberate.

## And the conditions

Every step after the first carries `COND=(4,LT)`. Without it a failed extract
still reaches the post step, which posts whatever the previous night left in the
dataset and ends with a return code saying it worked.

`EXTRACT` sets return code 4 when it selected nothing: not a failure, but not a
normal night either, and the operator should not have to read the log to find
out.

## `job.json`

```json
{
  "name": "EODSETL",
  "description": "End-of-day settlement",
  "steps": [
    { "name": "EXTRACT", "project": "extract" },
    {
      "name": "SORTITEM",
      "input": "settlementExtract",
      "output": "sortedSettlement",
      "fields": "1,8,CH,A,9,16,CH,A"
    },
    { "name": "POST", "project": "post" },
    { "name": "REPORT", "project": "report" }
  ]
}
```

A step name is what a `COND` and an operator's restart refer to, so it is
checked against JCL's rule — one to eight characters, starting with a letter —
when the job is built rather than trusted into the stream.

## Nothing is compiled by this job

On an estate the load modules are built by their own job and promoted through
environments; a production stream that compiled its own programs would be
running code that had not been through whatever the site's promotion is. Each
program's build job is still emitted, in `dist/<step>/jcl/`.

## What a site has to supply

`BANKLANG.RESTARTF` is allocated `DISP=OLD`, so it exists before the first run —
an empty KSDS, defined once. A restart file the job creates is one that is empty
on the rerun that needed it.

## Related

- [docs/jcl-model.md](../../docs/jcl-model.md) — the generated job, and what to change
- [`parm-driven-batch`](../parm-driven-batch/) — restart and checkpoint on their own
- [`report-with-controls`](../report-with-controls/) — the same report through Report Writer

<!-- playground-link -->

Open each program in the playground:

- [extract](https://banklang.mwhassan.com/playground/#example=end-of-day-settlement/extract)
- [post](https://banklang.mwhassan.com/playground/#example=end-of-day-settlement/post)
- [report](https://banklang.mwhassan.com/playground/#example=end-of-day-settlement/report)
