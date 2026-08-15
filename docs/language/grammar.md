# BankTS grammar

The whole language, as productions. Everything BankTS accepts is here and
nothing else is: `tests/grammar.test.ts` compares the keywords named below
against the lexer's own table in both directions, so a keyword the compiler
accepts and this page does not mention fails the build, and so does one this
page names and the compiler has never heard of.

This is a **reference grammar**, not the parser. The parser is a hand-written
recursive-descent reader in `packages/parser/src/index.ts` and it is the
authority on what compiles; where the two disagree, the parser is right and this
page is a bug.

## Notation

ISO 14977 EBNF, with the usual reading:

| Form         | Means                            |
| ------------ | -------------------------------- |
| `a b`        | `a` then `b`                     |
| `a \| b`     | `a` or `b`                       |
| `[ a ]`      | `a` once or not at all           |
| `{ a }`      | `a` zero or more times           |
| `"text"`     | exactly those characters         |
| `(* note *)` | a comment, not part of the input |

## Lexical structure

BankTS is case-sensitive and free-format. A line comment runs from `//` to the
end of the line; there is no block comment, because a block comment is how a
statement gets commented out and forgotten.

```ebnf
identifier   = letter , { letter | digit | "_" } ;
letter       = "A".."Z" | "a".."z" ;
digit        = "0".."9" ;

number       = digit , { digit } , [ "." , { digit } ] ;
string       = '"' , { character - '"' } , '"' ;
boolean      = "true" | "false" ;

comment      = "//" , { character - newline } ;
```

A number's written form decides its scale: `0.00` is scale 2 and `0` is scale 0,
and the two are not interchangeable where money is expected. See
[the numeric model](../numeric-model.md).

## A program

One module per file, and one file per program. That is a decision rather than an
omission, and [ADR-0004](../adr/0004-one-module-one-program.md) records it: a
COBOL program is one compilation unit, so a BankTS source that spanned files
would have to decide how to flatten them, and every answer to that question is a
build system. Record layouts are shared through
[copybook import](../language/records.md) instead, which is how a mainframe
estate already shares them.

```ebnf
program      = module , { declaration } ;
module       = "module" , identifier , ";" ;

declaration  = type_alias
             | record
             | enum
             | file
             | report
             | database
             | queue
             | function
             | transaction
             | test ;
```

## Types

```ebnf
type_alias   = "type" , identifier , "=" , type , ";" ;

type         = primitive
             | identifier , [ type_arguments ]
             | "nullable" , "<" , type , ">" ;

type_arguments = "<" , type_argument , { "," , type_argument } , ">" ;
type_argument  = type | number | string ;

primitive    = "decimal" , "<" , number , "," , number , ">"
             | "currency" , "<" , string , "," , number , "," , number , ">"
             | "string" , "<" , number , ">"
             | "national" , "<" , number , ">"
             | "date" | "time" | "timestamp"
             | "bool"
             | "binary" , "<" , number , ">"
             | "zoned" , "<" , number , "," , number , ">"
             | "unsigned" , "<" , number , ">"
             | "edited" , "<" , string , ">" ;
```

`decimal<p, s>` is `p` digits with `s` after the point. `currency<"BDT", 18, 2>`
is the same storage and a different type: an amount in one currency will not
assign to a field in another, and that check is the reason the tag is in the
type rather than in a comment.

## Records

```ebnf
record       = "record" , identifier , [ type_parameters ] ,
               [ "extends" , identifier ] ,
               "{" , { field } , "}" ;

type_parameters = "<" , identifier , { "," , identifier } , ">" ;

field        = { field_modifier } , identifier , ":" , type ,
               [ field_clause ] , ";" ;

field_modifier = "sensitive" | "reserved" ;

field_clause = "redefines" , identifier
             | "renames" , identifier , "through" , identifier
             | "depending" , "on" , identifier
             | "justified"
             | "sync"
             | "blankWhenZero"
             | "native" ;

enum         = "enum" , identifier , "{" ,
               enum_member , { "," , enum_member } , [ "," ] , "}" ;
enum_member  = identifier , [ "=" , ( string | number ) ] ;
```

`extends` lays the base fields first, so an existing copybook still reads the
leading bytes of a derived record correctly. That is a layout guarantee, not an
object model: there is no dispatch and no vtable.

## The environment

```ebnf
file         = "file" , identifier , file_organization , file_mode ,
               "record" , identifier ,
               [ "cursor" , identifier ] ,
               [ "status" , identifier ] , ";" ;

file_organization = "sequential" | "lineSequential" | "indexed" | "relative" ;
file_mode         = "input" | "output" | "extend" | "readFile" | "writeFile" ;

database     = "database" , identifier , "{" , { cursor_declaration } , "}" ;
cursor_declaration = "cursor" , identifier , [ "hold" ] , [ "rowset" ] ,
                     "=" , sql_query , ";" ;
sql_query    = "sql" , string ;

queue        = "queue" , identifier , "{" , { queue_clause } , "}" ;
queue_clause = identifier , ":" , ( string | number ) , ";" ;

report       = "report" , identifier , "{" , { report_clause } , "}" ;
report_clause = ( "by" | "sort" | "descending" | "every" ) ,
                identifier , ";" ;
```

## Functions and transactions

```ebnf
function     = "function" , identifier , [ type_parameters ] ,
               "(" , [ parameters ] , ")" , [ ":" , type ] , block ;

parameters   = parameter , { "," , parameter } ;
parameter    = identifier , ":" , type ;

transaction  = [ "entry" ] , "transaction" , identifier ,
               "(" , [ parameters ] , ")" , transaction_body ;

transaction_body = "{" , [ failure_handler ] , { statement } , "}" ;
failure_handler  = "on" , "failure" , block ;

test         = "test" , identifier , "for" , identifier , block ;
```

A transaction is not a function that happens to move money. It carries a unit of
work, and the compiler refuses one without an idempotency key, without an audit
event, or whose postings do not balance. See
[the diagnostics](../diagnostics.md).

## Statements

```ebnf
block        = "{" , { statement } , "}" ;

statement    = declaration_statement
             | assignment
             | if
             | while
             | for_each
             | switch
             | return
             | raise
             | operation
             | io
             | ";" ;

declaration_statement = "let" , identifier , [ ":" , type ] , "=" , expression , ";" ;
assignment   = target , "=" , expression , ";" ;
target       = identifier , { "." , identifier } , [ "[" , expression , "]" ] ;

if           = "if" , expression , block , [ "else" , ( if | block ) ] ;
while        = "while" , expression , block ;
for_each     = "for" , "each" , identifier , "in" , expression ,
               [ "by" , number ] , block ;
switch       = "switch" , expression , "{" , { switch_case } , "}" ;
switch_case  = "case" , expression , block ;

return       = "return" , [ expression ] , ";" ;
raise        = "raise" , string , ";" ;

operation    = ( "debit" | "credit" | "audit" | "log" ) ,
               "(" , [ arguments ] , ")" , ";" ;
```

`for each` needs a bound: a loop over a file with no ceiling is a batch that
runs until the region dies, and the compiler will not emit one.

## Input and output

```ebnf
io           = file_statement
             | sql_statement
             | cics_statement
             | ims_statement
             | mq_statement
             | report_statement
             | checkpoint_statement ;

file_statement = ( "readFile" | "writeFile" | "rewriteFile" ) ,
                 identifier , [ "in" , identifier ] , ";" ;

sql_statement  = "execute" , sql_query , [ "in" , identifier ] , ";"
               | "commit" , ";"
               | "rollback" , ";" ;

cics_statement = ( "link" | "returnTransid" | "syncpoint" | "readQueue"
                 | "writeQueue" | "cics" ) , "(" , [ arguments ] , ")" , ";" ;

ims_statement  = ( "getUnique" | "getNext" | "getHoldUnique" | "getHoldNext"
                 | "insertSegment" | "replaceSegment" | "deleteSegment" ) ,
                 "(" , [ arguments ] , ")" , ";" ;

mq_statement   = ( "connectQueue" | "putMessage" | "getMessage"
                 | "disconnectQueue" ) , "(" , [ arguments ] , ")" , ";" ;

report_statement = ( "initiate" | "generate" | "terminate" ) ,
                   identifier , ";" ;

checkpoint_statement = ( "checkpoint" | "restart" | "reset" ) ,
                       [ identifier ] , ";" ;
```

## Batch operations

The verbs a night is made of. Each is a statement rather than a library call,
because each compiles to a COBOL construct with rules of its own. A `SORT` has
an input procedure, a `SEARCH ALL` needs an ordered table, and neither survives
being wrapped in a function.

```ebnf
batch_statement = sort | merge | search | split | accept
                | dynamic_call | return_code ;

sort         = "sort" , identifier , { "," , identifier } ,
               "into" , identifier , "on" , sort_key ,
               { "," , sort_key } , [ block ] , ";" ;
sort_key     = [ "descending" ] , identifier ;

merge        = "merge" , identifier , { "," , identifier } ,
               "into" , identifier , "on" , identifier , ";" ;

(* `release` hands one record to the sort from inside an input procedure. *)
release      = "release" , identifier , ";" ;

search       = "search" , [ "sorted" ] , identifier , "in" , expression ,
               "where" , expression , block ;

split        = "split" , expression , "by" , string ,
               "into" , target , { "," , target } , ";" ;

accept       = "accept" , ( "date" | "time" | "timestamp" | "parameter" ) ,
               "into" , target , ";" ;

dynamic_call = "call" , target , [ "using" , expression ] ,
               [ "on" , "error" , block ] , ";"
             | "cancel" , target , ";" ;

return_code  = "returnCode" , "=" , expression , ";" ;
```

`returnCode` is an assignment to a name the language reserves, not a variable.
A job step reads it, and [the JCL model](../jcl-model.md) says what each value
means.

## Structured payloads

```ebnf
payload_statement = json_statement | xml_statement ;

json_statement = "json" , target , "into" , target ,
                 [ "on" , "error" , block ] , ";"
               | "json" , target , "from" , target ,
                 [ "count" , target ] , [ "on" , "error" , block ] , ";" ;

xml_statement  = "xml" , target , "into" , target ,
                 [ "on" , "error" , block ] , ";"
               | "xml" , target , "from" , target ,
                 [ "count" , target ] , ";"
               | "xml" , target , "processing" , block , ";" ;
```

`into` parses a document into a record and `from` generates one from it, which
is the direction Enterprise COBOL's `JSON PARSE` and `JSON GENERATE` read.
GnuCOBOL compiles both and does nothing at run time, so the local build
translates them into calls on `runtime/BANKJSON.cbl`; see
[divergences](../divergences.md).

## Declaratives

```ebnf
error_declarative = "error" , identifier , block ;
```

An `error` block on a file is COBOL's `USE AFTER STANDARD ERROR PROCEDURE`: it
runs when an I/O statement on that file fails and the statement did not handle
the failure itself. `examples/failed-open` exists because the alternative is a
job that ends with return code 0 having processed nothing.

## Expressions

Loosest binding first. Every operator is left-associative except `**`.

```ebnf
expression   = or_expression ;
or_expression  = and_expression , { "||" , and_expression } ;
and_expression = comparison , { "&&" , comparison } ;
comparison   = additive , [ comparison_op , additive ] ;
comparison_op = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
additive     = multiplicative , { ( "+" | "-" ) , multiplicative } ;
multiplicative = unary , { ( "*" | "/" ) , unary } ;
unary        = [ "-" | "!" ] , postfix ;
postfix      = primary , { "." , identifier | "[" , expression , "]" } ;

primary      = number | string | boolean
             | identifier
             | call
             | "(" , expression , ")" ;

call         = identifier , [ type_arguments ] , "(" , [ arguments ] , ")" ;
arguments    = expression , { "," , expression } ;
```

There is no `%`, no bitwise operator, and no implicit conversion between a
decimal and anything else. A division must name its rounding mode, which is why
`round` takes one; see [`BANK-DEC-003`](../diagnostics.md).

## Words the language reserves

Every keyword, from the lexer's own table. A name in this list cannot be an
identifier.

```txt
accept          binary          blankWhenZero   bool
by              call            cancel          case
checkpoint      cics            commit          connectQueue
currency        cursor          database        date
decimal         deleteSegment   depending       descending
disconnectQueue each            edited          else
entry           enum            error           every
execute         extends         failure         false
file            for             function        generate
getHoldNext     getHoldUnique   getMessage      getNext
getUnique       hold            if              in
initiate        insertSegment   json            justified
let             link            log             merge
module          national        native          nullable
on              putMessage      queue           raise
readFile        readQueue       record          redefines
release         renames         replaceSegment  report
reserved        reset           restart         return
returnCode      returnTransid   rewriteFile     rollback
rowset          search          sensitive       sort
split           sql             string          switch
sync            syncpoint       terminate       through
time            timestamp       transaction     true
type            unsigned        while           writeFile
writeQueue      xml             zoned
```

## What the grammar does not say

A grammar says what parses. Most of what makes a BankTS program legal is
elsewhere:

- **Types** are checked in `packages/typechecker`, and
  [`docs/language/types.md`](types.md) is what to read.
- **Banking safety** (balance, idempotency, audit, bounded loops, checked file
  status) is checked in `packages/semantic-analyzer` and catalogued in
  [`docs/diagnostics.md`](../diagnostics.md).
- **Layout** (how a record becomes bytes) is in
  [`docs/language/records.md`](records.md) and enforced by
  `packages/copybook`.

A program can parse cleanly and still be refused by all three, which is the
point.
