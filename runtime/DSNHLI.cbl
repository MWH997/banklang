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
      *> its SQLCODE test selects — so a not-found path, and the end of
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

       DATA DIVISION.
       FILE SECTION.
       FD  SQL-LOG-FILE.
       01  SQL-LOG-RECORD           PIC X(80).
       FD  OUTCOME-FILE.
       01  OUTCOME-RECORD           PIC X(80).

       WORKING-STORAGE SECTION.
       01  SQL-LOG-STATUS           PIC XX.
       01  OUTCOME-STATUS           PIC XX.
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

       PROCEDURE DIVISION USING SQLCA, SQL-STMT-NUMBER.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT SQL-LOG-FILE
               CLOSE SQL-LOG-FILE
               PERFORM LOAD-OUTCOMES
           END-IF

           ADD 1 TO WS-CALL-COUNT

      *> Success unless the test scripted something else for this
      *> statement.
           MOVE 0 TO SQLCODE
           MOVE "00000" TO SQLSTATE
           MOVE SPACES TO SQLWARN
           PERFORM APPLY-OUTCOME

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
      *> same statement takes over — which is how a cursor runs out of
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
