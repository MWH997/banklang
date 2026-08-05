# z/OS conformance results

Fill in what actually happened. An empty or partial run is worth recording; a
claim that outran the evidence is not.

| Field  | Value                                                             |
| ------ | ----------------------------------------------------------------- |
| Date   |                                                                   |
| System | z/OS version, Enterprise COBOL version, Db2 version, CICS version |
| Run by |                                                                   |
| Bundle | `git rev-parse HEAD` of the tree the bundle was built from        |

## Compile

| Program  | Return code | Messages of severity W or above |
| -------- | ----------- | ------------------------------- |
| ACCOUNTT |             |                                 |
| ACCOUNTP |             |                                 |
| ACCOUNTF |             |                                 |
| BATCHINT |             |                                 |
| INTEREST |             |                                 |
| AMORTISA |             |                                 |
| STATEMEN |             |                                 |
| WITHDRAW |             |                                 |
| ONLINEEN |             |                                 |
| BRANCHAC |             |                                 |

## Precompile and bind

| Program  | DSNHPC RC | BIND RC | Notes |
| -------- | --------- | ------- | ----- |
| ONLINEEN |           |         |       |
| BRANCHAC |           |         |       |

## CICS

| Step                            | Outcome |
| ------------------------------- | ------- |
| Translate                       |         |
| Install program and transaction |         |
| Drive from a terminal           |         |

## Execution

For each batch program run against the seeded input from
`tests/conformance.test.ts`:

| Program | Step RC | Output matches the local run? | Difference |
| ------- | ------- | ----------------------------- | ---------- |
|         |         |                               |            |

## Findings

Anything IBM rejected, warned about, or did differently from GnuCOBOL. Each one
is a defect in this compiler until fixed.

1.

## What this run does not cover

State it plainly, so the next person knows where to start.
