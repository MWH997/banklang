/**
 * The two kinds of failure that are not diagnostics, told apart.
 *
 * There were 38 `throw new Error` sites across the compiler, at least one of
 * them reachable from ordinary input. A boundary at the CLI stops any of them
 * reaching a user as a Node stack trace and a version banner. This file is the
 * other half: **which of them is the user's fault, and which is the
 * compiler's.**
 *
 * The distinction is not cosmetic. It decides what the message says, what the
 * reader should do next, and whether a stack trace is the right output:
 *
 * - **`BankcError`** is a fault in what the user handed the tool: a copybook
 *   that is not a copybook, a `job.json` with no steps. It carries a catalogue
 *   identifier, so `bankc explain` answers for it exactly as it does for a
 *   diagnostic the typechecker raised, and a location where there is one. No
 *   stack: the stack is a fact about this program's control flow and the reader
 *   has a file to fix.
 *
 * - **`CompilerInvariant`** is a fault in bankc. Something the typechecker
 *   accepted reached the backend in a shape the backend does not have a case
 *   for. There is nothing the reader can do to their program to fix it and the
 *   right output is a bug report, so the message says so and the stack is
 *   printed rather than hidden behind `--debug`.
 *
 * `tests/errors.test.ts` holds the rule that keeps this honest: no compiler
 * package throws a bare `Error`. Every failure is classified, because an
 * unclassified one is the shape both of those defects came in.
 */

/**
 * A failure the user can fix, with a catalogue entry that says how.
 *
 * The identifier is the same namespace the typechecker's diagnostics use and is
 * held to the same rules: `tests/diagnostic-catalogue.test.ts` requires an
 * entry, and `tests/feature-coverage.test.ts` requires a test that provokes it.
 * An error message with an identifier nobody can look up is a string.
 */
export class BankcError extends Error {
  /** Catalogue identifier, e.g. `BANK-COPY-008`. */
  readonly id: string;
  /** Where it is, as `file:line` or `line n`, or null where there is no point. */
  readonly location: string | null;

  constructor(id: string, message: string, location: string | null = null) {
    super(message);
    this.name = "BankcError";
    this.id = id;
    this.location = location;
  }
}

/**
 * A state the compiler is supposed to make impossible.
 *
 * Thrown where a `switch` has no case for something the typechecker should have
 * refused, or where a name the IR resolved is missing by the time the backend
 * looks it up. Reaching one is a defect in bankc.
 */
export class CompilerInvariant extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerInvariant";
  }
}

/** Assert something the compiler guarantees, and say what if it does not. */
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new CompilerInvariant(message);
  }
}
