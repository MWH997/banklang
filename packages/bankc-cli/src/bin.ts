import { BankcError, CompilerInvariant } from "../../diagnostics/src/errors";
import { runBankc, watchProject, watchRefusal } from "./index";

const argv = process.argv.slice(2);

function write(result: { stdout: string; stderr: string; exitCode: number }) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

/**
 * What the user is told about a thrown error.
 *
 * Everything the compiler *means* to report comes back as a `CliResult` with a
 * message and an exit code. The rest are thrown — a job with no steps, two
 * programs whose names collapse to one load module, a copybook the parser
 * cannot read — and there are dozens of them across the packages. With no
 * boundary here Node printed the stack, the whole `node:internal` frame list
 * and its own version banner, and exited 1 anyway: the message the compiler
 * wrote was the second line of forty, and the first thing a new user saw was a
 * crash rather than a compiler telling them something.
 *
 * F3 then split the throws in two, and this is where the split is spent.
 *
 * A `BankcError` is the reader's file: it prints with its catalogue identifier
 * and where it is, and points at `bankc explain`, which is the same path a
 * diagnostic from the typechecker takes. No stack, because there is nothing in
 * this program's control flow for them to read — they have a line to look at.
 *
 * A `CompilerInvariant` is bankc's own: something the typechecker accepted
 * reached a place with no case for it. Nothing the reader does to their program
 * fixes that, so it says so and prints the stack without being asked, because
 * the stack is the bug report.
 *
 * Anything else keeps the original behaviour — the message, and the stack
 * behind `--debug`.
 *
 * Separate from `fail` because the same text is owed to a `--watch` session,
 * where exiting is precisely the wrong response. See F2 below.
 */
function describe(error: unknown): string {
  if (error instanceof BankcError) {
    const where = error.location ? ` (${error.location})` : "";
    return [
      `bankc: ${error.id}${where}: ${error.message}`,
      `Run \`bankc explain ${error.id}\` for why.`,
      "",
    ].join("\n");
  }

  const detail = error instanceof Error ? error.message : String(error);

  if (error instanceof CompilerInvariant) {
    return [
      `bankc: ${detail}`,
      "This is a defect in bankc, not in your program. Please open an issue with the program that produced it, and the stack below.",
      `${error.stack ?? ""}`,
      "",
    ].join("\n");
  }

  if (argv.includes("--debug") && error instanceof Error && error.stack) {
    return `bankc: ${detail}\n${error.stack}\n`;
  }
  return `bankc: ${detail}\nRun again with --debug for the stack.\n`;
}

/** The last thing between a thrown error and a one-shot run. */
function fail(error: unknown): never {
  process.stderr.write(describe(error));
  process.exit(1);
}

const refusal = argv.includes("--watch") ? watchRefusal(argv) : null;

if (refusal) {
  // `--watch` on a command that reads no project. Decided before the banner
  // below, because "Watching for changes" above a refusal to watch is a claim
  // the next line contradicts.
  write(refusal);
} else if (argv.includes("--watch")) {
  process.stdout.write("Watching for changes. Press Ctrl+C to stop.\n");
  try {
    const stop = watchProject(
      argv,
      process.cwd(),
      (result) => {
        write(result);
        process.stdout.write("\n");
      },
      /*
       * F2. A rebuild that throws must not end the session.
       *
       * The boundary below cannot see this one: by the time a file changes,
       * the `try` has long returned and the rebuild is running inside the
       * watcher's callback, where a throw is an uncaught exception and Node
       * ends the process. The user loses the watch over a typo in a copybook —
       * the case `--watch` exists to shorten.
       *
       * Reported exactly as a one-shot run reports it, then back to waiting.
       * The exit code follows the last build, the same way `write` sets it, so
       * fixing the file and saving clears it.
       */
      (error) => {
        process.stderr.write(describe(error));
        process.exitCode = 1;
        process.stdout.write("\n");
      },
    );
    process.on("SIGINT", () => {
      stop();
      process.exit(0);
    });
  } catch (error) {
    fail(error);
  }
} else {
  try {
    write(runBankc(argv));
  } catch (error) {
    fail(error);
  }
}
