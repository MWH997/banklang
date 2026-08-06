# VSAM browse

`START`, `READ NEXT`, and an alternate index — the most common thing a real
program does to a KSDS.

## Why

A customer's accounts are not contiguous in the primary key and there is no
query language here to find them, so the file carries an alternate index on the
customer.

```ts
file accountMaster indexed input record AccountRecord
  key accountRecordId alternate customerId, branchId
  status masterStatus;

account.customerId = request.wantedCustomerId;
start accountMaster key account.customerId;
```

Naming an alternate key's own field is how the browse asks for that index:
COBOL takes the key of reference from the data item the `START` names, and every
`READ NEXT` after it follows the same one.

```cobol
           START ACCOUNT-MASTER-FILE KEY IS NOT LESS THAN CUSTOMER-ID OF
               ACCOUNT-MASTER-RECORD
               INVALID KEY MOVE "23" TO MASTER-STATUS
           END-START
```

`KEY IS NOT LESS THAN` is what makes a browse from a partial key possible at
all; an exact match would find nothing.

## The walk has to stop itself

The file does not end where the customer's records do. A browse that only tests
for end-of-file reads the rest of the estate's accounts into this customer's
total, and the total still looks like a total.

Three endings, told apart:

| Status | Means                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `23`   | From the START: no record at or after that key. Not an error — a customer with no accounts is a customer. |
| `10`   | End of file, which a walk that reached the last record gets legitimately                                  |
| other  | The walk stopped early, and a total over some of a customer's accounts is worse than no total             |

## Artifacts

`dist/cobol/VSAMBROW.cbl`, `dist/jcl/VSAMBROW.jcl`, three copybooks. Each
alternate is declared `WITH DUPLICATES`, because many accounts per customer is
nearly always why one exists.

## Related

- [docs/language-reference.md](../../docs/language-reference.md) — file declarations

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=vsam-browse) — it compiles in your browser, with the generated COBOL beside it.
