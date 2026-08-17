      *> Stand-in for the Db2 language interface module.
      *>
      *> The precompiler in packages/precompiler rewrites each EXEC SQL
      *> block into `CALL "DSNHLI" USING SQLCA, SQL-STMT-NUMBER, <host
      *> variables>`, which is the shape the Db2 precompiler produces on
      *> z/OS: a statement descriptor identifying the call site, then
      *> the SQLCA the statement reports through. Linking against this
      *> program lets a generated program with embedded SQL be executed
      *> locally.
      *>
      *> Outcomes are scripted, not computed. A test writes
      *> sql-outcomes.txt, one line per outcome it wants, as
      *> `<statement> <sqlcode> <sqlstate> <times>`:
      *>
      *>     0001 +000 00000 0000   statement 1 always succeeds
      *>     0002 +000 00000 0003   statement 2 succeeds three times
      *>     0002 +100 02000 0000   and reports end of data thereafter
      *>     0004 -911 40001 0000   statement 4 is rolled back by a
      *>                            deadlock
      *>
      *> A count of 0000 means every remaining call, which is what a
      *> statement run once wants. A finite count is what a FETCH inside
      *> a cursor loop wants: the loop ends when a fetch stops returning
      *> zero, so the number of rows it processes is the number of
      *> successes scripted here.
      *>
      *> Lines are matched in file order, so the first entry for a
      *> statement that still has calls left wins. A statement the file
      *> does not mention succeeds, and with no file at all every
      *> statement succeeds.
      *>
      *> What running against this proves: the program links, reaches
      *> its SQL call sites in the expected order, and takes the branch
      *> its SQLCODE test selects, so a not-found path, and the end of
      *> a cursor, are executed rather than assumed.
      *>
      *> What it does NOT prove: anything about the SQL itself. No
      *> statement is parsed, no table is read, no plan is bound, and no
      *> SQLCODE here was produced by a database deciding anything. A
      *> scripted 100 shows the generated COBOL handles a missing row;
      *> it does not show that Db2 would return 100 for that query. That
      *> needs a real Db2 and a bind.
      *>
      *> Host variables are never written. They are passed, so the COBOL
      *> compiler checks that each one resolves, but this program has no
      *> way to know their types or lengths and does not touch them. A
      *> fetched row therefore arrives unchanged: a test can assert how
      *> many rows a loop processed and that it opened, bounded, and
      *> closed correctly, but not what was in them.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DSNHLI.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SQL-LOG-FILE ASSIGN TO "sql-calls.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS SQL-LOG-STATUS.
           SELECT OUTCOME-FILE ASSIGN TO "sql-outcomes.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS OUTCOME-STATUS.
           SELECT ROW-FILE ASSIGN TO "sql-rows.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS ROW-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  SQL-LOG-FILE.
       01  SQL-LOG-RECORD           PIC X(80).
       FD  OUTCOME-FILE.
       01  OUTCOME-RECORD           PIC X(80).
       FD  ROW-FILE.
       01  ROW-RECORD               PIC X(560).

       WORKING-STORAGE SECTION.
       01  SQL-LOG-STATUS           PIC XX.
       01  OUTCOME-STATUS           PIC XX.
       01  ROW-STATUS               PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-CALL-COUNT            PIC 9(4) COMP VALUE 0.
       01  WS-SHOW-COUNT            PIC 9(4).
       01  WS-SHOW-CODE             PIC -(8)9.
       01  WS-LINE                  PIC X(80).

      *> Scripted outcomes, read once and held across calls.
       01  WS-OUTCOME-COUNT         PIC 9(4) COMP VALUE 0.
       01  WS-OUTCOMES.
           05  WS-OUTCOME OCCURS 100 TIMES.
               10  WS-OUTCOME-STMT  PIC 9(4).
               10  WS-OUTCOME-CODE  PIC S9(9) COMP-5.
               10  WS-OUTCOME-STATE PIC X(5).
      *> Calls this entry still applies to. -1 means every remaining
      *> call.
               10  WS-OUTCOME-LEFT  PIC S9(9) COMP-5.
       01  WS-INDEX                 PIC 9(4) COMP.

      *> Scripted host-variable values, one line per variable per row.
      *>
      *>     0002 0001 0001 01 0016 4143432D...
      *>     stmt call row  hv len  the bytes, in hex
      *>
      *> `call` is which call of that statement the line answers, and
      *> `row` which row of the rowset that call delivers. A single-row
      *> FETCH has one row per call and counts calls; a rowset FETCH has
      *> one call and counts rows inside it, each landing one element
      *> further along the host-variable array.
      *>
      *> Hex because a row carries packed decimal as often as text, and
      *> a byte of packed decimal is not a character a line sequential
      *> file can hold. The writer knows the record layout, so the bytes
      *> are exactly what the copybook says they are.
       01  WS-ROW-COUNT             PIC 9(4) COMP VALUE 0.
       01  WS-ROWS.
           05  WS-ROW OCCURS 200 TIMES.
               10  WS-ROW-STMT      PIC 9(4).
               10  WS-ROW-SEQ       PIC 9(4).
               10  WS-ROW-ROW       PIC 9(4).
               10  WS-ROW-VAR       PIC 9(2).
               10  WS-ROW-LEN       PIC 9(4).
               10  WS-ROW-DATA      PIC X(256).

      *> How many rows each statement has already delivered, so a second
      *> FETCH gets the second row.
       01  WS-SEEN-COUNT            PIC 9(4) COMP VALUE 0.
       01  WS-SEENS.
           05  WS-SEEN OCCURS 100 TIMES.
               10  WS-SEEN-STMT     PIC 9(4).
               10  WS-SEEN-ROWS     PIC 9(4) COMP.
       01  WS-SEEN-INDEX            PIC 9(4) COMP.
       01  WS-ROW-INDEX             PIC 9(4) COMP.
       01  WS-THIS-SEQ              PIC 9(4) COMP.
       01  WS-HEX-INDEX             PIC 9(4) COMP.
       01  WS-HEX-AT                PIC 9(4) COMP.
       01  WS-HEX-HIGH              PIC 9(4) COMP.
       01  WS-HEX-LOW               PIC 9(4) COMP.
       01  WS-DIGITS                PIC X(16)
                                    VALUE "0123456789ABCDEF".
       01  WS-BYTE-NUMBER           PIC 9(4) COMP.
       01  WS-WRITE-AT              PIC 9(4) COMP.
       01  WS-SET-ROWS              PIC 9(4) COMP.
       01  WS-BYTES                 PIC X(256).
       01  WS-PARSED-ROW.
           05  WS-PR-STMT           PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PR-SEQ            PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PR-ROW            PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PR-VAR            PIC 9(2).
           05  FILLER               PIC X.
           05  WS-PR-LEN            PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PR-HEX            PIC X(512).
       01  WS-PARSED.
           05  WS-PARSED-STMT       PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PARSED-CODE       PIC S9(3) SIGN IS LEADING SEPARATE.
           05  FILLER               PIC X.
           05  WS-PARSED-STATE      PIC X(5).
           05  FILLER               PIC X.
           05  WS-PARSED-TIMES      PIC X(4).

       LINKAGE SECTION.
       01  SQLCA.
           05  SQLCAID              PIC X(8).
           05  SQLCABC              PIC S9(9) COMP-5.
           05  SQLCODE              PIC S9(9) COMP-5.
           05  SQLERRML             PIC S9(4) COMP-5.
           05  SQLERRMC             PIC X(70).
           05  SQLERRP              PIC X(8).
           05  SQLERRD              OCCURS 6 TIMES PIC S9(9) COMP-5.
           05  SQLWARN.
               10  SQLWARN0         PIC X.
               10  SQLWARN1         PIC X.
               10  SQLWARN2         PIC X.
               10  SQLWARN3         PIC X.
               10  SQLWARN4         PIC X.
               10  SQLWARN5         PIC X.
               10  SQLWARN6         PIC X.
               10  SQLWARN7         PIC X.
           05  SQLSTATE             PIC X(5).
       01  SQL-STMT-NUMBER          PIC 9(4).

      *> The host variables the statement named, in the order the
      *> generated CALL passes them. A caller passing fewer than these
      *> is the ordinary case and costs nothing: only the ones a script
      *> has a value for are ever addressed, and the script is written
      *> from the same record layout the call was generated from.
       01  SQL-HV-1                 PIC X(4096).
       01  SQL-HV-2                 PIC X(4096).
       01  SQL-HV-3                 PIC X(4096).
       01  SQL-HV-4                 PIC X(4096).
       01  SQL-HV-5                 PIC X(4096).
       01  SQL-HV-6                 PIC X(4096).
       01  SQL-HV-7                 PIC X(4096).
       01  SQL-HV-8                 PIC X(4096).

       PROCEDURE DIVISION USING SQLCA, SQL-STMT-NUMBER,
           SQL-HV-1, SQL-HV-2, SQL-HV-3, SQL-HV-4,
           SQL-HV-5, SQL-HV-6, SQL-HV-7, SQL-HV-8.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT SQL-LOG-FILE
               CLOSE SQL-LOG-FILE
               PERFORM LOAD-OUTCOMES
               PERFORM LOAD-ROWS
           END-IF

           ADD 1 TO WS-CALL-COUNT

      *> Success unless the test scripted something else for this
      *> statement.
           MOVE 0 TO SQLCODE
           MOVE "00000" TO SQLSTATE
           MOVE SPACES TO SQLWARN
           PERFORM APPLY-OUTCOME

      *> Every call, not only the ones that succeeded. A FETCH that ends
      *> the cursor still reports how many rows came with it, and the
      *> script simply has none for that call, so this writes nothing
      *> and sets the count to zero. Delivering only on success left the
      *> previous call's count in SQLERRD(3), and a rowset loop read the
      *> same set of rows a second time before it stopped.
           PERFORM DELIVER-ROW

           MOVE SQL-STMT-NUMBER TO WS-SHOW-COUNT
           MOVE SQLCODE TO WS-SHOW-CODE
           MOVE SPACES TO WS-LINE
           STRING "SQL " DELIMITED BY SIZE
                  WS-SHOW-COUNT DELIMITED BY SIZE
                  " SQLCODE " DELIMITED BY SIZE
                  FUNCTION TRIM(WS-SHOW-CODE) DELIMITED BY SIZE
                  INTO WS-LINE
           OPEN EXTEND SQL-LOG-FILE
           MOVE WS-LINE TO SQL-LOG-RECORD
           WRITE SQL-LOG-RECORD
           CLOSE SQL-LOG-FILE
           GOBACK.

      *> First entry for this statement that still has calls left. A
      *> finite entry is spent as it is used, so a later entry for the
      *> same statement takes over, which is how a cursor runs out of
      *> rows.
       APPLY-OUTCOME.
           PERFORM VARYING WS-INDEX FROM 1 BY 1
                   UNTIL WS-INDEX > WS-OUTCOME-COUNT
               IF WS-OUTCOME-STMT(WS-INDEX) = SQL-STMT-NUMBER
                  AND WS-OUTCOME-LEFT(WS-INDEX) NOT = 0
                   MOVE WS-OUTCOME-CODE(WS-INDEX) TO SQLCODE
                   MOVE WS-OUTCOME-STATE(WS-INDEX) TO SQLSTATE
                   IF WS-OUTCOME-LEFT(WS-INDEX) > 0
                       SUBTRACT 1 FROM WS-OUTCOME-LEFT(WS-INDEX)
                   END-IF
                   EXIT PERFORM
               END-IF
           END-PERFORM.

      *> The row this statement is up to, written into the host
      *> variables the CALL passed. Each line of the script names one
      *> variable by its place in that list, so a statement with three
      *> of them has three lines per row.
       DELIVER-ROW.
           PERFORM BUMP-SEEN
           MOVE 0 TO WS-SET-ROWS

           PERFORM VARYING WS-ROW-INDEX FROM 1 BY 1
                   UNTIL WS-ROW-INDEX > WS-ROW-COUNT
               IF WS-ROW-STMT(WS-ROW-INDEX) = SQL-STMT-NUMBER
                  AND WS-ROW-SEQ(WS-ROW-INDEX) = WS-THIS-SEQ
                   MOVE WS-ROW-LEN(WS-ROW-INDEX) TO WS-BYTE-NUMBER
                   MOVE WS-ROW-DATA(WS-ROW-INDEX) TO WS-BYTES
      *> One element further along the array per row, which is what a
      *> host-variable array is: an elementary item with an OCCURS, so
      *> its occurrences are contiguous and each is the same width.
                   COMPUTE WS-WRITE-AT =
                       ((WS-ROW-ROW(WS-ROW-INDEX) - 1) * WS-BYTE-NUMBER)
                       + 1
                   IF WS-ROW-ROW(WS-ROW-INDEX) > WS-SET-ROWS
                       MOVE WS-ROW-ROW(WS-ROW-INDEX) TO WS-SET-ROWS
                   END-IF
                   PERFORM WRITE-ONE
               END-IF
           END-PERFORM

      *> How many rows this FETCH returned, zero included. A single-row
      *> fetch does not read it; a rowset loop takes its trip count from
      *> it, which is how the last, partial set is processed and how the
      *> one after it is not.
           MOVE WS-SET-ROWS TO SQLERRD(3).

       WRITE-ONE.
           EVALUATE WS-ROW-VAR(WS-ROW-INDEX)
               WHEN 1
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-1(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 2
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-2(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 3
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-3(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 4
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-4(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 5
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-5(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 6
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-6(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 7
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-7(WS-WRITE-AT:WS-BYTE-NUMBER)
               WHEN 8
                   MOVE WS-BYTES(1:WS-BYTE-NUMBER) TO
                       SQL-HV-8(WS-WRITE-AT:WS-BYTE-NUMBER)
           END-EVALUATE.

      *> How many rows this statement has delivered, counting this one.
       BUMP-SEEN.
           MOVE 0 TO WS-THIS-SEQ
           PERFORM VARYING WS-SEEN-INDEX FROM 1 BY 1
                   UNTIL WS-SEEN-INDEX > WS-SEEN-COUNT
               IF WS-SEEN-STMT(WS-SEEN-INDEX) = SQL-STMT-NUMBER
                   ADD 1 TO WS-SEEN-ROWS(WS-SEEN-INDEX)
                   MOVE WS-SEEN-ROWS(WS-SEEN-INDEX) TO WS-THIS-SEQ
                   EXIT PERFORM
               END-IF
           END-PERFORM

           IF WS-THIS-SEQ = 0 AND WS-SEEN-COUNT < 100
               ADD 1 TO WS-SEEN-COUNT
               MOVE SQL-STMT-NUMBER TO WS-SEEN-STMT(WS-SEEN-COUNT)
               MOVE 1 TO WS-SEEN-ROWS(WS-SEEN-COUNT)
               MOVE 1 TO WS-THIS-SEQ
           END-IF.

      *> No file means no rows, which is the ordinary case: a statement
      *> nothing scripted leaves its host variables alone, exactly as
      *> before this existed.
       LOAD-ROWS.
           OPEN INPUT ROW-FILE
           IF ROW-STATUS NOT = "00"
               EXIT PARAGRAPH
           END-IF

           PERFORM UNTIL WS-ROW-COUNT >= 200
               READ ROW-FILE
                   AT END
                       EXIT PERFORM
               END-READ
               IF ROW-RECORD NOT = SPACES
                   MOVE ROW-RECORD TO WS-PARSED-ROW
                   ADD 1 TO WS-ROW-COUNT
                   MOVE WS-PR-STMT TO WS-ROW-STMT(WS-ROW-COUNT)
                   MOVE WS-PR-SEQ TO WS-ROW-SEQ(WS-ROW-COUNT)
                   MOVE WS-PR-ROW TO WS-ROW-ROW(WS-ROW-COUNT)
                   MOVE WS-PR-VAR TO WS-ROW-VAR(WS-ROW-COUNT)
                   MOVE WS-PR-LEN TO WS-ROW-LEN(WS-ROW-COUNT)
                   PERFORM DECODE-HEX
                   MOVE WS-BYTES TO WS-ROW-DATA(WS-ROW-COUNT)
               END-IF
           END-PERFORM

           CLOSE ROW-FILE.

      *> Two hex characters to a byte. `WS-DIGITS` is the alphabet, and
      *> a position in it is the nibble's value.
       DECODE-HEX.
           MOVE SPACES TO WS-BYTES
           MOVE WS-PR-LEN TO WS-BYTE-NUMBER
           PERFORM VARYING WS-HEX-INDEX FROM 1 BY 1
                   UNTIL WS-HEX-INDEX > WS-BYTE-NUMBER
               COMPUTE WS-HEX-AT = ((WS-HEX-INDEX - 1) * 2) + 1
               MOVE 0 TO WS-HEX-HIGH
               MOVE 0 TO WS-HEX-LOW
               PERFORM VARYING WS-INDEX FROM 1 BY 1 UNTIL WS-INDEX > 16
                   IF WS-DIGITS(WS-INDEX:1) = WS-PR-HEX(WS-HEX-AT:1)
                       COMPUTE WS-HEX-HIGH = WS-INDEX - 1
                   END-IF
                   IF WS-DIGITS(WS-INDEX:1) =
                       WS-PR-HEX(WS-HEX-AT + 1:1)
                       COMPUTE WS-HEX-LOW = WS-INDEX - 1
                   END-IF
               END-PERFORM
               MOVE FUNCTION CHAR(((WS-HEX-HIGH * 16) + WS-HEX-LOW) + 1)
                   TO WS-BYTES(WS-HEX-INDEX:1)
           END-PERFORM.

      *> No file means no script, which is the ordinary case: every
      *> statement succeeds. A missing file is therefore not an error.
       LOAD-OUTCOMES.
           OPEN INPUT OUTCOME-FILE
           IF OUTCOME-STATUS NOT = "00"
               EXIT PARAGRAPH
           END-IF

           PERFORM UNTIL WS-OUTCOME-COUNT >= 100
               READ OUTCOME-FILE
                   AT END
                       EXIT PERFORM
               END-READ
               IF OUTCOME-RECORD NOT = SPACES
                   MOVE OUTCOME-RECORD(1:20) TO WS-PARSED
                   ADD 1 TO WS-OUTCOME-COUNT
                   MOVE WS-PARSED-STMT TO
                       WS-OUTCOME-STMT(WS-OUTCOME-COUNT)
                   MOVE WS-PARSED-CODE TO
                       WS-OUTCOME-CODE(WS-OUTCOME-COUNT)
                   MOVE WS-PARSED-STATE TO
                       WS-OUTCOME-STATE(WS-OUTCOME-COUNT)
      *> An omitted or zero count means every remaining call, so a file
      *> written before counts existed still means what it meant.
                   IF WS-PARSED-TIMES = SPACES
                       OR WS-PARSED-TIMES = "0000"
                       MOVE -1 TO WS-OUTCOME-LEFT(WS-OUTCOME-COUNT)
                   ELSE
                       MOVE FUNCTION NUMVAL(WS-PARSED-TIMES) TO
                           WS-OUTCOME-LEFT(WS-OUTCOME-COUNT)
                   END-IF
               END-IF
           END-PERFORM

           CLOSE OUTCOME-FILE.

       END PROGRAM DSNHLI.
