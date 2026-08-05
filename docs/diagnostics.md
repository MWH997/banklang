# Banking Safety Specification

## 1. Diagnostic philosophy

BankLang must catch banking and mainframe hazards before COBOL is generated.

Diagnostics are product features. They should be stable, documented, and useful.

Every diagnostic has:

- ID
- severity
- title
- explanation
- source span
- backend profile
- remediation hint

## 2. Diagnostic ID namespaces

```txt
BANK-SYN-*    syntax
BANK-TYPE-*   type system
BANK-DEC-*    decimal/money
BANK-TXN-*    transaction
BANK-LED-*    ledger
BANK-AUD-*    audit
BANK-SQL-*    Db2/SQL
BANK-CICS-*   CICS
BANK-DLI-*    IMS DL/I
BANK-MQ-*     IBM MQ
BANK-FILE-*   VSAM/file IO
BANK-COPY-*   copybook/layout
BANK-GEN-*    code generation
BANK-SEC-*    security
```

## 3. Syntax and type diagnostics

### `BANK-SYN-001` unexpected token

The parser expected a specific keyword, identifier, number, or punctuation.

### `BANK-SYN-002` unexpected construct

The parser reached a token that cannot begin a declaration, statement, type, or
expression.

### `BANK-TYPE-000` no AST provided

Type checking ran without a parsed program. Parser errors must be fixed first.

### `BANK-TYPE-001` unresolved type or symbol

A type name or value symbol could not be resolved in scope.

### `BANK-TYPE-002` invalid type parameters

Decimal precision/scale or string length parameters are outside the supported
range.

### `BANK-TYPE-003` type mismatch

An expression, argument, return path, or branch does not match its expected
type.

### `BANK-TYPE-004` invalid statement position

A statement appears where the subset does not allow it, such as after a terminal
statement or in a function body with no terminal statement.

### `BANK-TYPE-005` duplicate symbol

A parameter or local variable name is declared more than once in one scope.

### `BANK-TYPE-006` unknown record field

Field access names a field the record does not declare.

### `BANK-TYPE-007` statement not allowed in this body

A ledger or audit statement appears outside a transaction, or a return or if
statement appears inside a transaction body.

### `BANK-TYPE-014` generic expansion does not terminate

A generic function calls itself at a type argument that keeps changing. Generics
are monomorphised, so every new type argument creates another instantiation.

### `BANK-TYPE-015` generic function is never instantiated

Nothing is generated for an uninstantiated generic, and its body is never
checked against real types.

### `BANK-TYPE-016` record inheritance cycle

A record extends itself, directly or through another record.

### `BANK-TYPE-017` inherited field redeclared

A derived record declares a field its base already declares. Both would land in
one COBOL group under the same name.

### `BANK-TYPE-018` wrong number of type arguments

A generic record was used with the wrong number of type arguments, or with none.

### `BANK-TYPE-019` type arguments on a non-generic type

A type that declares no type parameters was given type arguments.

### `BANK-TYPE-020` type argument cannot be inferred

A type parameter appears in no parameter type, or two arguments disagree about
what it stands for.

### `BANK-TYPE-021` record argument is not a named record

A record argument is passed by reference: the caller points the callee's
`LINKAGE` cell at the argument's storage. A subscripted element has no address
the caller can take without evaluating the subscript first, so it must be
assigned into a record and passed by name.

### `BANK-TYPE-022` two transaction parameters share one record

A transaction is a program entry point, so its record parameters live in working
storage — one COBOL group per record type. Two parameters of the same type would
be two names for one piece of storage, and writing through either would be
visible through the other. A function is unaffected: its record parameters are
`LINKAGE` cells the caller rebinds.

### `BANK-TYPE-023` invalid edited field

An `edited<T, "style">` field names a style the compiler does not know, or asks
to render something with no edited form. A picture nobody checked is a report
column that silently loses digits.

### `BANK-TYPE-024` national layout is not locally verifiable

A warning, on every `national<n>` field.

`national<n>` emits `PIC N(n) USAGE NATIONAL`. Enterprise COBOL holds each
character in two bytes of UTF-16, and that is the width the layout report, the
copybook, and the copybook inspector all use. GnuCOBOL 3.2.0 allocates four
bytes per character inside a group — measured, not assumed — and warns on every
such line that its handling of `USAGE NATIONAL` is unfinished.

Byte-exact layout is the only thing the type promises, so this is the one place
where the compiler emits a record its own validator reads differently: under
GnuCOBOL every field after a national sits at a different offset. The warning is
there so the local evidence cannot be mistaken for a check that happened.
`zos/README.md` records the divergence as something to verify first.

### `BANK-TYPE-025` parsed document cannot be checked locally

A warning, on every `json <text> into <record>`.

Enterprise COBOL implements `JSON PARSE`. GnuCOBOL 3.2.0 compiles it, warns that
it is not implemented, and then does nothing at run time: the record is left
untouched and **no exception is raised**, so a program reading a payload runs
clean and processes an empty record.

The local build no longer runs that. The precompiler rewrites the statement into
calls on `BANKJSON`, a reference stub, so the record is populated from the
document and the `JSON-STATUS` test below is reached with a value it did not
invent — the same routing `EXEC SQL` and `EXEC CICS` already had. What ships to
z/OS keeps its `JSON PARSE`. The warning stays because the stub is a scan and
not IBM's parser: `runtime/README.md` lists what it does not attempt.

On Enterprise COBOL the hazard is different but has the same shape. A parse can
meet a _nonexception condition_, which does not terminate the statement and
"might result in the receiver being partially modified" — so `on error` is never
reached and the record holds some fields and not others, which is exactly what a
record that parsed cleanly looks like. Only `JSON-STATUS` distinguishes them, and
the compiler emits a test of it that reports the case to the job log. It reports
rather than raises, because a nonexception condition is not always an error: a
document carrying fields the record does not declare is one of them.

Verify the program on z/OS before relying on what it reads, and check the record
rather than trusting the failure path — a parse that did nothing does not report
one. `zos/README.md` records the divergence.

### `BANK-TYPE-026` invalid xml read

`XML PARSE` is event-driven, so `xml <text> into <record>` has no COBOL to
become: neither Enterprise COBOL nor GnuCOBOL has a form that fills a record.
(For what the local build does with the form that exists, see `BANK-TYPE-025`
above: the precompiler drives the generated handler from `BANKXML`.)
The form that exists is

```ts
xml message.body processing {
  element "BALANCE" into account.balance;
};
```

and its bindings have to make sense: at least one element, each element bound
once — a second binding for the same name would never be reached — and each read
into something characters can be moved into, which is a `string<n>` or a number.

`json <text> into <record>` fills a record directly if the document is JSON.

### `BANK-TYPE-027` nested function is recursive

COBOL forbids `LOCAL-STORAGE` in a contained program, so a `nested function`'s
locals sit in `WORKING-STORAGE` — one copy shared by every invocation. A
recursive one would overwrite its own locals on the way down and read the
innermost call's values on the way back out: it compiles, it runs, and it returns
the wrong number.

Drop `nested`. An ordinary recursive function is emitted as a sibling program
with `LOCAL-STORAGE`, which is what makes recursion safe.

### `BANK-TYPE-028` invalid sorted search

`search sorted` becomes COBOL `SEARCH ALL`, a binary search. COBOL will bisect a
table only if the declaration says it is ordered — `ascending <field>` — and only
on equality against that key, because anything else has no ordering to cut in
half.

This matters more than a type error usually does: a `SEARCH ALL` on a table that
is not actually sorted does **not** fall back to scanning it. It returns the
wrong row, or reports no match on a row that is there.

Use a plain `search` to walk a table any other way.

### `BANK-TYPE-029` invalid dynamic call

`call <name> using <record>` names its load module by a value rather than by a
literal in the source, so the name has to be text and short enough to be one:
eight characters, because a longer field is truncated to a name that does not
exist and the failure then arrives as a missing module rather than as a length.

What the compiler cannot check is whether the module is _there_. That is the
nature of a dynamic call, and it is why a `call` with no `on error` is warned
about: a static call that cannot be resolved fails at link time where somebody
sees it, and a dynamic one fails in the middle of a batch.

## 4. Decimal diagnostics

### `BANK-DEC-001` floating-point money forbidden

Money cannot use binary floating-point representation.

### `BANK-DEC-002` implicit scale narrowing

Assigning `decimal<18,4>` to `decimal<18,2>` requires explicit rounding.

### `BANK-DEC-003` missing rounding mode

Division or scale conversion requires an explicit rounding mode.

### `BANK-DEC-004` possible overflow

Operation may exceed target precision.

### `BANK-DEC-005` currency mismatch

Different currency types cannot be added/subtracted without explicit conversion.

## 5. Transaction diagnostics

### `BANK-TXN-001` missing idempotency key

A transaction that posts financial effects must have a typed idempotency key.

### `BANK-TXN-002` missing rollback path

A transaction backend requires rollback representation but no rollback path can be generated.

### `BANK-TXN-003` unsafe non-deterministic operation

Transaction contains an operation with backend-dependent behaviour.

### `BANK-TXN-004` unbounded loop in transaction

Transaction contains a loop without static bound or approved termination proof.

### `BANK-TXN-008` invalid failure code

A `raise` code is empty or wider than `BANK-FAILURE-CODE`. A truncated code
would not match the handler that tests it.

### `BANK-TXN-009` failure handler raises

An `on failure` handler contains a `raise`. There is no outer handler to catch
it.

### `BANK-TXN-010` more than one entry transaction

COBOL enters a program at one place, so only one transaction can be the entry
point.

## 6. Ledger diagnostics

### `BANK-LED-001` unbalanced posting

Debit total may not equal credit total on at least one commit path.

### `BANK-LED-002` missing ledger entry

Money movement occurs without ledger posting.

### `BANK-LED-003` inconsistent value date

Posting date and value date policy is missing or inconsistent.

### `BANK-LED-004` posted amount does not fit the ledger interface

`BANK-LEDGER-AMOUNT` is `PIC S9(16)V99`. A wider integer part or a finer scale
loses digits in the `MOVE`, and COBOL truncates silently.

## 7. Audit diagnostics

### `BANK-AUD-001` missing audit event

Financial transaction path lacks audit event.

### `BANK-AUD-002` restricted data reaches a log

A value marked `sensitive` reaches an audit event or a ledger posting. Both are
durable records that outlive the transaction and are read by people with no
business seeing a card number or a national identifier.

### `BANK-AUD-003` audit event name is not compile-time constant

Audit event names must be statically known.

## 8. SQL diagnostics

### `BANK-SQL-001` SQLCODE not handled

A generated SQL operation must handle success, not found, and error branches.

### `BANK-SQL-002` dynamic SQL disallowed

Dynamic SQL is not supported in the selected backend profile.

### `BANK-SQL-003` host variable layout mismatch

SQL host variable does not match expected COBOL field layout.

### `BANK-SQL-004` transaction commit ambiguity

A `commit` or `rollback` appears inside a CICS transaction. CICS owns the unit
of work there and commits Db2's work along with everything else, so an
`EXEC SQL COMMIT` is not merely redundant — Db2 rejects it at run time.

### `BANK-SQL-005` cursor and statement confused

A `cursor` was run with `execute`, or a `sql` statement was read with a cursor
loop. One lowers to a single `EXEC SQL`; the other to `DECLARE`, `OPEN`,
`FETCH`, and `CLOSE`.

### `BANK-SQL-006` cursor row binding missing

A cursor declares no result record, or no `INTO` clause naming where a fetched
row lands, so the generated `FETCH` would have nowhere to put one.

## 9. CICS diagnostics

### `BANK-CICS-001` CICS response code not handled

A CICS command must handle response code.

### `BANK-CICS-002` unsupported CICS operation

Selected backend profile does not support the requested operation.

### `BANK-CICS-003` syncpoint misuse

Transaction uses syncpoint in an invalid scope.

## 10. File diagnostics

### `BANK-FILE-001` file status not checked

File operation result is ignored.

### `BANK-FILE-002` record layout mismatch

File record layout differs from declared copybook.

### `BANK-FILE-003` unsafe restart behaviour (warning)

A transaction posts to the ledger inside a loop without both halves of
checkpoint/restart. A job that dies halfway is rerun, and without a position
written down the rerun starts at the beginning and posts everything twice — and
a position written down but never read back leaves the rerun starting at the
beginning just the same. Reported as a warning because the compiler cannot tell
whether the job is rerunnable another way.

The same id covers a restart file that is not `indexed update`. A sequential
output file is rewritten from the start by the next `OPEN`, so a rerun that dies
before its own first checkpoint destroys the position it was resuming from.

### `BANK-FILE-004` invalid key declaration

An alternate record key names something that is not a field of the file's
record, or the file has no index for one to live in. Only an indexed file has
alternate keys.

### `BANK-FILE-005` file operation does not match the declaration

A `rewrite` or `delete` needs the file open for `update`, because updating a
record in place means finding it first. A `start` or `readNext` browses an
index, which a sequential file does not have.

It also reports a file given more than one error handler, which is what COBOL
allows.

### `BANK-FILE-006` invalid sort procedure

A sort procedure works through a record variable that does not hold the record
being sorted, or `release` appears where no sort is running — it hands a record
to a sort in progress, so it means nothing elsewhere.

An input procedure that never reaches a `release` sorts an empty file, and a
`merge` has no input procedure at all: its premise is that the inputs already
arrive in order, and a procedure that could drop or reorder records would break
it.

### `BANK-FILE-007` invalid page declaration

A page depth describes a print file, so it belongs to a sequential output file,
and its footing has to be a line the page has — past the end it would never be
reached. `advancing` writes a report line, and `on page` is signalled from the
page counter, so a file with no declared depth never reaches the end of one.

It also covers a `report` on a file that is read rather than written, and a
report on a file that already declares a page depth: both decide where the page
ends, and COBOL rejects an `FD` that says so twice.

### `BANK-FILE-008` invalid report description

A report's names have to resolve, or the generated COBOL means nothing:

- a control field must be a field of the record the report prints;
- a `controlHeading` or `controlFooting` must name a control the report breaks
  on, or none at all, which means `FINAL`;
- `sum` totals a numeric field — a `decimal` or a currency amount. It
  accumulates with COBOL's `ADD`, which will not take a string, and will not
  take an already-edited field either, that being a display form rather than a
  number;
- `sum` belongs in a `controlFooting` or a `pageFooting`. This one is stricter
  than COBOL: Report Writer allows a `SUM` clause in a group of any type,
  including a heading, and prints whatever had accumulated when the heading was
  written. banklang refuses it because a total read before the details it covers
  is a figure no reader can check against the lines around it;
- a report needs at least one `detail` group, since a report with nothing to
  generate prints its headings and stops;
- `generate` names a detail group, while `initiate` and `terminate` name the
  report itself.

## 10b. IBM MQ diagnostics

### `BANK-MQ-001` invalid queue access

An MQ statement names a queue that is not declared, or reaches one with no
status field, or the declaration names a queue manager or a queue longer than MQ
carries. `MQ_Q_MGR_NAME_LENGTH` and `MQ_Q_NAME_LENGTH` are both 48, which is what
`MQOD-OBJECTNAME` and `MQCONN`'s first parameter are declared as, so a longer
name is truncated into one the queue manager does not have.

The status field matters most. MQ reports what happened in a completion code and
a reason code, and without somewhere to read the reason a `getMessage` that
found an empty queue is indistinguishable from one that read a message — so the
program goes on to process whatever the message area held last.

### `BANK-MQ-002` queue used against its direction

A queue is opened for input or for output, not both, because that is what the
`MQOPEN` options say: an `output` queue is opened `MQOO-OUTPUT` and an `input`
queue `MQOO-INPUT-AS-Q-DEF`. Reading a queue opened for output fails at run time
with reason 2037, `MQRC-NOT-OPEN-FOR-INPUT`; putting to one opened for input
fails with 2039, `MQRC-NOT-OPEN-FOR-OUTPUT`. Both are refused when the program is
compiled instead.

It also covers a message record of the wrong shape: the buffer is the record the
queue declares, and MQ moves bytes without checking what they mean.

## 10a. IMS DL/I diagnostics

### `BANK-DLI-001` invalid DL/I access

A DL/I statement names a database that is not declared, moves a segment into a
record of the wrong shape, looks for a key that is not text, or reaches a
database with no status field.

The segment and key names are eight bytes each, because that is what a search
argument carries — a longer one is truncated into a name matching nothing in the
DBD.

The status field is the one that matters most. The two characters DL/I leaves in
the PCB are the **entire** error model: spaces worked, `GE` found nothing, `GB`
reached the end of the database. Without somewhere to read them, a `getUnique`
that found nothing is indistinguishable from one that worked, and the program
goes on to use whatever the segment area held last.

## 11. Copybook diagnostics

### `BANK-COPY-001` unsupported PIC clause

Copybook contains a PIC clause not supported by current parser.

### `BANK-COPY-002` unsupported REDEFINES shape

`REDEFINES` construct cannot be represented safely in BankTS subset.

### `BANK-COPY-003` incompatible layout change

New copybook layout changes field offsets or byte lengths incompatibly.

### `BANK-COPY-004` invalid variant record clause

A `redefines` names something COBOL will not let it redefine. A `depending on`
names something that is not a count declared before the table, which COBOL reads
to decide the record's length.

A redefinition **may** be longer than what it redefines. Enterprise COBOL then
extends the storage area rather than overrunning it — the Language Reference
gives `05 A PIC X(6).` redefined by `05 B REDEFINES A PIC N(4).`, eight bytes
over six, as a legal example — and the record runs to the end of the longest
reading of the area, so every field after it moves by the overhang. The layout
report shows this. The one case COBOL forbids is a redefined item declared as an
external data record, which this language cannot declare.

What it rejects:

- **A field that is not declared before it.** A redefinition re-reads storage
  that already exists.
- **A field that is not the one immediately before it.** COBOL requires the
  redefinitions of an area to follow its description with nothing in between
  that takes storage of its own; a further redefinition may name either the
  original or the redefinition before it. `A; X; B redefines A` is rejected by
  Enterprise COBOL and by GnuCOBOL ("REDEFINES must follow the original
  definition").
- **A table.** A table is a repetition of an area rather than one area, so there
  is no single run of bytes to alias, and COBOL forbids `OCCURS` on a redefined
  item. Wrap the table in a record and redefine that.
- **A `depending on` on the redefining field.** Neither end of a redefinition
  may vary in length: the area's size has to be known to lay out what follows.

On `depending on`, this compiler is **stricter than COBOL and says so**: the
varying table has to be the last field in the record that takes storage. A field
declared after it is _variably located_ — it sits at the start of the table plus
the count times the entry, so it moves every time the count does. IBM calls this
complex `ODO` and permits it. The layout report and the copybook could then only
state the offset that field has when the table is full, which is an offset no
other record has, and a copybook naming a byte position nothing is at is worse
than no copybook. GnuCOBOL refuses the shape outright ("cannot have OCCURS
DEPENDING because of ..."), so a program built this way could not be executed
locally either. The convention it stands against is ordinary: a variable-length
record ends with its table.

### `BANK-COPY-005` invalid field clause

`justified` right-aligns an alphanumeric value, so a number cannot carry it — a
number's alignment is decided by its picture. `blankWhenZero` prints spaces for
a zero, so there has to be a number to be zero.

### `BANK-COPY-006` invalid initial value

A field's initial value becomes a COBOL `VALUE` clause, which the compiler
evaluates when it compiles. It has to be something the compiler can see: a
written number, string, boolean, or enum member of the field's own type, short
enough to fit — a `VALUE` longer than its field would be truncated silently, so
it is refused instead.

A `REDEFINES` field cannot carry one. It has no storage of its own, only a
second reading of another field's bytes, so the value belongs on the field being
redefined.

### `BANK-FILE-009` invalid varying record

`varying <min> to <max> length <field>` becomes `RECORD IS VARYING IN SIZE`. The
bounds have to be a range of lengths — a shortest of at least one character, and
no longer than the longest.

The file has to be `sequential`: an indexed or relative dataset addresses a
record by key or by position, which a varying length would move.

### `BANK-FILE-010` update with nothing read

`rewrite` and `delete` replace the record the last `read` returned, so on a file
the program accesses sequentially they need one. Without it the operation **is
not performed and the file status is 92** — no abend and no exception, so a
program that does not test the status carries on believing it updated something.

Only `sequential` and `relative` files are affected. An indexed file is
`ACCESS MODE IS DYNAMIC`, where the record key in the record area says which
record is meant and no prior read is required.

A read in an enclosing block covers a branch inside it, but a read inside a
branch does not travel back out — the path that skipped the branch reaches the
update with nothing read. This is the same rule, and the same reasoning, as
`BANK-DLI-002`.

### `BANK-FILE-011` delete on a sequential file

Enterprise COBOL has no `DELETE` for a file with sequential organization: a
record is removed by leaving it out of the file the next program writes, not by
deleting it in place.

GnuCOBOL compiles the statement, so local validation does not catch this one —
the program passed every check here and would have been rejected by `IGYCRCTL`.

## 11a. Security diagnostics

### `BANK-SEC-001` restricted data reclassified

A value marked `sensitive` is assigned to a field that is not. A field's marking
is part of its record declaration and therefore part of its copybook, so this
would reclassify the data silently and defeat the marking everywhere downstream.

## 12. Code generation diagnostics

These diagnostics protect the traceability claim: every BankTS symbol that
reaches the backend must be locatable in the generated COBOL.

### `BANK-GEN-001` module missing source map entry

The generated source map has no entry for the compiled module.

### `BANK-GEN-002` record missing source map entry

A record reached the backend but has no source map entry.

### `BANK-GEN-003` field missing source map entry

A record field reached the backend but has no source map entry.

### `BANK-GEN-004` function missing source map entry

A function reached the backend but has no source map entry.

### `BANK-GEN-005` source map entry outside generated artifact

An entry targets a line range that does not exist in the generated COBOL, or an
inverted range where the end line precedes the start line.

### `BANK-GEN-006` source map entry not anchored to generated name

An entry targets a line range that exists but does not contain the COBOL name
the entry claims to describe. This catches entries that drift when the emitter
changes its line layout.

### `BANK-GEN-007` transaction missing source map entry

A transaction reached the backend but has no source map entry. `language-spec.md`
section 10 requires the generated COBOL to expose the transaction boundary in
the source map.

## 13. Severity levels

```txt
error      compilation must stop
warning    compilation may continue but risk is recorded
info       useful explanation
audit      included in audit report
```

## 14. Audit report integration

All warnings and errors should be available in machine-readable audit output.

Example:

```json
{
  "id": "BANK-DEC-002",
  "severity": "error",
  "source": "src/transfer.bank.ts",
  "line": 42,
  "message": "Implicit scale narrowing requires explicit rounding."
}
```
