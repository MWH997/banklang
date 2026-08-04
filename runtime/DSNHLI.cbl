      *> Stand-in for the Db2 language interface module.
      *>
      *> The precompiler in packages/precompiler rewrites each EXEC SQL block
      *> into `CALL "DSNHLI" USING SQLCA, <host variables>`, which is what the
      *> Db2 precompiler does on z/OS. Linking against this program lets a
      *> generated program with embedded SQL be executed locally.
      *>
      *> What running against this proves: the program links, reaches its SQL
      *> call sites in the expected order, and passes an SQLCA the surrounding
      *> COBOL can test.
      *>
      *> What it does NOT prove: anything about the SQL. No statement is parsed,
      *> no table is read, no plan is bound. SQLCODE is always zero because this
      *> program has no way to know what the statement asked for. Correct SQL
      *> behaviour requires a real Db2 and a bind, and this project has neither.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DSNHLI.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT SQL-LOG-FILE ASSIGN TO "sql-calls.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS SQL-LOG-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  SQL-LOG-FILE.
       01  SQL-LOG-RECORD           PIC X(80).

       WORKING-STORAGE SECTION.
       01  SQL-LOG-STATUS           PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-CALL-COUNT            PIC 9(4) COMP VALUE 0.
       01  WS-SHOW-COUNT            PIC 9(4).
       01  WS-LINE                  PIC X(80).

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

       PROCEDURE DIVISION USING SQLCA.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT SQL-LOG-FILE
               CLOSE SQL-LOG-FILE
           END-IF

           ADD 1 TO WS-CALL-COUNT

      *> Zero means "statement succeeded". This program cannot distinguish a
      *> row found from a row missing, so a test must not read meaning into it.
           MOVE 0 TO SQLCODE
           MOVE "00000" TO SQLSTATE
           MOVE SPACES TO SQLWARN

           MOVE WS-CALL-COUNT TO WS-SHOW-COUNT
           MOVE SPACES TO WS-LINE
           STRING "SQL CALL " DELIMITED BY SIZE
                  WS-SHOW-COUNT DELIMITED BY SIZE
                  INTO WS-LINE
           OPEN EXTEND SQL-LOG-FILE
           MOVE WS-LINE TO SQL-LOG-RECORD
           WRITE SQL-LOG-RECORD
           CLOSE SQL-LOG-FILE
           GOBACK.

       END PROGRAM DSNHLI.
