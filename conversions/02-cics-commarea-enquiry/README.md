# 02 — A CICS enquiry with a COMMAREA

Linked to with an account number, answers with a balance and a two-character
return code. The shape of half the online estate.

Written for this repository in period style — see the
[provenance note](../README.md#provenance).

## The original

[`original/ACCTENQ.cbl`](original/ACCTENQ.cbl)

```cobol
           IF SQLCODE = 0
               MOVE HV-BALANCE TO CA-BALANCE
               MOVE '00'       TO CA-RETURN-CODE
           ELSE
               MOVE ZERO       TO CA-BALANCE
               MOVE '01'       TO CA-RETURN-CODE.
```

Two branches where there are three. `SQLCODE = 0` is "found" and _everything
else_ is `'01'` — so a deadlock (-911), a resource that was not available
(-904) and a package that was never bound (-805) all reach the terminal as
"account not found". The teller sees a customer who does not exist, for an
account that does.

```cobol
           IF WS-RESP NOT = 0
               MOVE '02' TO CA-RETURN-CODE.
```

A CICS response compared against a literal. `DFHRESP(NORMAL)` is what the
translator resolves; a program that assumes the value stops meaning what it says
the moment that changes.

## The BankTS

[`banklang/src/main.bank.ts`](banklang/src/main.bank.ts)

The commarea layout is unchanged, field for field, because it is a contract with
everything that links to this program. Two diagnostics refused the direct
translation:

| Diagnostic      | What it refused                                                          |
| --------------- | ------------------------------------------------------------------------ |
| `BANK-SQL-007`  | An `SQLCODE` test that cannot tell an error from a missing row           |
| `BANK-CICS-004` | A CICS response compared against a literal instead of its condition name |

So the enquiry now has a third answer, `'09'`, and the response test is
generated as `DFHRESP(NORMAL)`.

## What the compiler generated

[`generated/cobol/ACCTENQ.cbl`](generated/cobol/ACCTENQ.cbl)

```cobol
           IF WRITE-RESP NOT = DFHRESP(NORMAL)
```

and no `MOVE ... TO RETURN-CODE` anywhere: `RETURN-CODE` is a batch step's
answer to JCL and nothing under CICS reads it. What a transaction that has
failed owes the region is an abend.

## The measurements

<!-- measurements -->

|                                                | Original | Regenerated |
| ---------------------------------------------- | -------- | ----------- |
| Lines of code, comments and blanks excluded    | 43       | 86          |
| `GO TO` a paragraph that is not an exit        | 0        | 0           |
| `GO TO` in total, single-exit returns included | 0        | 0           |
| File operations whose result is tested         | 0 of 0   | 0 of 0      |

The BankTS in between is 39 lines.

<!-- /measurements -->

No file operations either side — this is an online program, and the numbers that
matter here are in the table above rather than in the count.

## What changed about what it does

- **A Db2 error is now `'09'`, not `'01'`.** The caller has to know that; it is
  a change to the contract, and it is the whole reason the conversion was worth
  doing.
- **The response test is against the condition name.** Same behaviour today.

The commarea layout, the SQL statement, the transient data queue and the two
existing return codes are unchanged.
