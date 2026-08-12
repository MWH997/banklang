/**
 * Executing a COBOL program.
 *
 * The machine holds storage as bytes and every read and write goes through the
 * layout in `data.ts`, so a group move copies the same bytes a real compiler
 * would and a `REDEFINES` sees what was written through the other name. That is
 * more work than a map of field names to JavaScript values, and it is the only
 * version of this that can be checked: `tests/cobol-runtime-differential.test.ts`
 * runs every example here and under GnuCOBOL and fails on any disagreement.
 *
 * What this is not: a COBOL compiler, and not evidence about IBM Enterprise
 * COBOL. It implements the subset `packages/cobol-backend` emits plus what the
 * reference programs in `runtime/` use, and raises on everything else.
 */

import { flatten, type Condition, type Field, type Literal } from "./data";
import { edit } from "./value";
import type {
  FileControlEntry,
  FileDescription,
  Program,
  Unit,
} from "./program";
import { parsePicture, type Picture } from "./picture";
import { CobolUnsupportedError } from "./source";
import type { Cond, Expr, RelOp, Reference, Statement } from "./statements";
import {
  add,
  compare,
  decimalOf,
  digitsOf,
  isOverpunched,
  decodeNumeric,
  decodeText,
  divide,
  encodeNumeric,
  encodeText,
  multiply,
  negate,
  overflows,
  rescale,
  subtract,
  type Decimal,
} from "./value";

/* ------------------------------------------------------------------ *
 * Values.
 * ------------------------------------------------------------------ */

export type Value =
  /**
   * A number, and the item it was read from.
   *
   * The picture is carried because `DISPLAY` shows the *item*, not the value:
   * GnuCOBOL prints `PIC S9(16)V99` holding 1.01 as `+0000000000000001.01` and
   * `PIC 9(4)` holding zero as `0000`. Dropping the picture and printing `1.01`
   * is a difference a reader of the playground would see and a differential
   * test would fail on, which is how this was found.
   */
  | { kind: "number"; value: Decimal; picture?: Picture }
  | { kind: "text"; value: string }
  /**
   * A pointer, which is only ever compared against `NULL`.
   *
   * COBOL has no arithmetic on these and this interpreter offers none. What it
   * answers is the one question the generated code asks: was this LINKAGE item
   * passed at all?
   */
  | { kind: "pointer"; bound: boolean };

const SPACE = 0x20;

/* ------------------------------------------------------------------ *
 * Control-flow signals.
 * ------------------------------------------------------------------ */

/**
 * Control transfer, carried as a thrown value.
 *
 * `GO TO` leaves whatever statement nesting it is inside, and so does `GOBACK`
 * from three levels of `PERFORM`. An exception is the only mechanism that
 * unwinds arbitrary depth, so these are exceptions — and `Error` subclasses
 * rather than bare objects, because a signal that escapes its handler by
 * mistake should arrive somewhere with a stack attached rather than as
 * `undefined`.
 */
class Signal extends Error {}

class GoToSignal extends Signal {
  public constructor(public readonly target: string) {
    super(`GO TO ${target}`);
  }
}
class ExitParagraphSignal extends Signal {}
class ExitPerformSignal extends Signal {}
class GobackSignal extends Signal {}
class StopRunSignal extends Signal {}
/**
 * A sort or merge stopped by `SORT-RETURN`, from inside its own procedure.
 *
 * Control cannot leave an input or output procedure with `GOBACK`, so this is
 * how a procedure that has already reported failure gets out of the sort
 * without releasing or returning another record.
 */
class SortTerminatedSignal extends Signal {}

/** A run that could not continue: a real fault, not a program's own failure. */
export class CobolRuntimeError extends Error {}

/* ------------------------------------------------------------------ *
 * Storage.
 * ------------------------------------------------------------------ */

interface Binding {
  bytes: Uint8Array;
  base: number;
}

interface Location {
  field: Field;
  bytes: Uint8Array;
  offset: number;
  length: number;
}

interface OpenFile {
  entry: FileControlEntry;
  description: FileDescription;
  mode: "INPUT" | "OUTPUT" | "I-O" | "EXTEND" | null;
  /** Index of the next record a sequential READ returns. */
  position: number;
}

/**
 * The records passing through one `SD` file while its `SORT` or `MERGE` runs.
 *
 * Not in `fileData`: a sort work file is not a dataset. Holding it there would
 * put a `SORTWORK` entry in `RunResult.files` that the compiled side never
 * produces, and every generated sort names its work file `SORTWORK`, so two
 * sorts in one program would also share one set of records.
 */
interface SortWork {
  records: Uint8Array[];
  /** Index of the next record `RETURN` delivers. */
  position: number;
  /** True between the first `RELEASE` and the end of the ordering phase. */
  releasing: boolean;
}

/** The result of one run. */
export interface RunResult {
  /** The program's RETURN-CODE when it gave control back. */
  returnCode: number;
  /** Lines the program wrote with DISPLAY, in order. */
  sysout: string[];
  /** Every file the run left behind, keyed by its `ASSIGN TO` name. */
  files: Map<string, Uint8Array[]>;
  /** Statements executed, so a runaway loop can be reported rather than hang. */
  steps: number;
}

export interface RunOptions {
  /** Files present before the run, keyed by their `ASSIGN TO` name. */
  files?: Map<string, Uint8Array[]>;
  /**
   * Bytes to place in named records of the entry program before it starts,
   * keyed by the 01-level name.
   *
   * What a program's storage holds when it is entered is decided outside the
   * program on every real system: a dataset it reads, the PARM the step was
   * started with, a caller's communication area, a region. This is that, for a
   * caller that has none of those — the playground's Input panel, and a test
   * that wants a program to run on a particular request without writing a
   * dataset for it.
   *
   * Applied after the `VALUE` clauses, so it overrides them, and truncated or
   * padded to the record's declared length: a record area is a fixed number of
   * bytes and a caller that miscounts must not move every field after it.
   */
  storage?: Map<string, Uint8Array>;
  /**
   * Ceiling on executed statements.
   *
   * A browser tab is a hard place to stop a runaway `PERFORM UNTIL`, and a
   * generated program is not trusted to terminate simply because it compiled.
   */
  stepLimit?: number;
}

const DEFAULT_STEP_LIMIT = 5_000_000;

/** `RETURN-CODE`, which every program has and none declares. */
const RETURN_CODE_PICTURE: Picture = parsePicture("S9(4)");

/**
 * `SORT-RETURN`, the other register every program has and none declares.
 *
 * The Language Reference gives it as `01 SORT-RETURN GLOBAL PICTURE S9(4)
 * USAGE BINARY VALUE ZERO`, global in the outermost program — so one register
 * per machine, not one per program instance. It reads 0 after a sort or merge
 * that completed and 16 after one that did not, and a program may store 16
 * into it from an input or output procedure to stop the operation.
 *
 * GnuCOBOL 3.2.0 defines it wider: `DISPLAY SORT-RETURN` prints `+000000016`
 * there and `0016` here. That is divergence D25, and the reason the backend
 * moves it into a declared item before displaying it.
 */
const SORT_RETURN_PICTURE: Picture = parsePicture("S9(4)");

/**
 * Intrinsics whose result is characters rather than a number.
 *
 * `displayText` knows how to produce each; this is what stops the arithmetic
 * path from being asked to.
 */
const TEXT_FUNCTIONS = new Set(["TRIM", "UPPER-CASE", "LOWER-CASE", "CHAR"]);

/* ------------------------------------------------------------------ *
 * One loaded program, with its storage.
 * ------------------------------------------------------------------ */

class Instance {
  public readonly program: Program;
  public readonly roots = new Map<string, Binding>();
  public readonly fields = new Map<string, Field[]>();
  public readonly conditions = new Map<
    string,
    { field: Field; condition: Condition }[]
  >();
  public readonly paragraphIndex = new Map<string, number>();
  public readonly files = new Map<string, OpenFile>();
  /** Sort work files, by `SD` name, while their `SORT` or `MERGE` is running. */
  public readonly sortWork = new Map<string, SortWork>();
  /** LOCAL-STORAGE is reallocated per invocation; this is the current frame. */
  public localFrames: Map<string, Binding>[] = [];
  /** Paragraph index of the last paragraph of each section, by section name. */
  public readonly sectionEnd = new Map<string, number>();

  public constructor(program: Program) {
    this.program = program;
    for (const [index, paragraph] of program.paragraphs.entries()) {
      if (paragraph.name !== "") {
        this.paragraphIndex.set(paragraph.name, index);
      }
    }
    // A section runs to the paragraph before the next section header, or to
    // the end of the division. `PERFORM a-section` and a sort's input
    // procedure both need that extent: performing the header paragraph alone
    // would run a sort's input procedure as far as its first internal
    // paragraph and then order whatever had been released by then.
    //
    // The declaratives are their own region: the last `USE` section ends at
    // `END DECLARATIVES` and not at the next section header, which is in the
    // main body. Without this a program with one declarative would perform the
    // whole program whenever a file operation failed.
    const declarativesEnd = program.declaratives.reduce(
      (last, use) => Math.max(last, use.thru),
      -1,
    );
    let open: string | null = null;
    for (const paragraph of program.paragraphs) {
      if (paragraph.index === declarativesEnd + 1) {
        open = null;
      }
      if (paragraph.section) {
        open = paragraph.name;
      }
      if (open !== null) {
        this.sectionEnd.set(open, paragraph.index);
      }
    }
  }

  public index(record: Field): void {
    for (const field of flatten(record)) {
      const existing = this.fields.get(field.name);
      if (existing) {
        existing.push(field);
      } else {
        this.fields.set(field.name, [field]);
      }
      for (const condition of field.conditions) {
        const list = this.conditions.get(condition.name) ?? [];
        list.push({ field, condition });
        this.conditions.set(condition.name, list);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The machine.
 * ------------------------------------------------------------------ */

export class Machine {
  private readonly programs = new Map<string, Program>();
  private readonly instances = new Map<string, Instance>();
  private readonly externals = new Map<string, Binding>();
  private readonly fileData = new Map<string, Uint8Array[]>();
  private readonly sysout: string[] = [];
  private readonly returnCodeBytes = new Uint8Array(2);
  private readonly sortReturnBytes = new Uint8Array(2);
  private steps = 0;
  private stepLimit = DEFAULT_STEP_LIMIT;
  /** A failing I/O statement inside a USE procedure must not re-enter it. */
  private inDeclarative = false;
  /** Programs whose `CALL` this machine should answer, innermost frame last. */
  private readonly callStack: string[] = [];

  public constructor(units: Unit[]) {
    for (const unit of units) {
      for (const program of unit.programs) {
        this.programs.set(program.name, program);
      }
    }
  }

  /** Loads a source file's programs into a machine, ready to run. */
  public static load(
    sources: string[],
    parse: (source: string) => Unit,
  ): Machine {
    return new Machine(sources.map(parse));
  }

  public run(entry: string, options: RunOptions = {}): RunResult {
    this.stepLimit = options.stepLimit ?? DEFAULT_STEP_LIMIT;
    this.steps = 0;
    this.sysout.length = 0;
    this.fileData.clear();
    for (const [name, records] of options.files ?? []) {
      this.fileData.set(
        name,
        records.map((record) => Uint8Array.from(record)),
      );
    }
    this.returnCodeBytes.fill(0);
    this.sortReturnBytes.fill(0);

    const program = this.programs.get(entry);
    if (!program) {
      throw new CobolRuntimeError(`No program called ${entry} was loaded.`);
    }

    // Before the first statement and after the `VALUE` clauses, which is where
    // a dataset, a PARM or a caller would have put it.
    for (const [name, bytes] of options.storage ?? []) {
      const root = this.instanceOf(program).roots.get(name);
      if (!root) {
        throw new CobolRuntimeError(
          `${program.name} declares no record called ${name}, so there is nowhere to put the ${String(bytes.length)} bytes given for it.`,
        );
      }
      root.bytes.set(
        bytes.subarray(0, root.bytes.length - root.base),
        root.base,
      );
    }

    // `STOP RUN` unwinds every frame by throwing, so the outermost call is
    // where it stops being a signal and becomes an ordinary end to the run.
    // Without this it escaped `runCobol` as a bare `Error` with no message: the
    // generated programs all end in `GOBACK`, so nothing in the corpus reached
    // it, and every hand-written or migrated program ends in `STOP RUN`.
    try {
      this.invoke(program, []);
    } catch (signal) {
      if (!(signal instanceof StopRunSignal)) {
        throw signal;
      }
    }

    return {
      returnCode: this.returnCode(),
      sysout: [...this.sysout],
      files: new Map(
        [...this.fileData].map(([k, v]) => [
          k,
          v.map((r) => Uint8Array.from(r)),
        ]),
      ),
      steps: this.steps,
    };
  }

  private returnCode(): number {
    return Number(
      decodeNumeric(this.returnCodeBytes, 0, 2, RETURN_CODE_PICTURE, "binary")
        .units,
    );
  }

  /* -------------------------------------------------- instances */

  private instanceOf(program: Program): Instance {
    const existing = this.instances.get(program.name);
    if (existing) {
      return existing;
    }

    const instance = new Instance(program);

    const allocate = (records: Field[]): void => {
      for (const record of records) {
        instance.index(record);
        if (record.external) {
          const shared = this.externals.get(record.name) ?? {
            bytes: new Uint8Array(record.length),
            base: 0,
          };
          this.externals.set(record.name, shared);
          instance.roots.set(record.name, shared);
          continue;
        }
        // An 01 with a REDEFINES describes the same bytes as the record it
        // names, and every 01 used to get storage of its own instead — so
        // writing through the redefinition and reading through the original
        // returned whatever the original had been initialised to. The two
        // agreeing is the whole reason a program writes one.
        //
        // The redefining record may be the longer of the two: the Language
        // Reference constrains the size only when the redefined record is
        // EXTERNAL. The shared area is therefore as long as the longest
        // description of it, and the binding object is mutated rather than
        // replaced so that records already sharing it see the same bytes.
        const redefined = record.redefines
          ? instance.roots.get(record.redefines)
          : undefined;
        if (redefined) {
          if (redefined.bytes.length < record.length) {
            const grown = new Uint8Array(record.length);
            grown.set(redefined.bytes);
            redefined.bytes = grown;
          }
          instance.roots.set(record.name, redefined);
          continue;
        }
        instance.roots.set(record.name, {
          bytes: new Uint8Array(record.length),
          base: 0,
        });
      }
    };

    allocate(program.working);
    // LINKAGE has no storage of its own; it is bound at CALL time. Indexing it
    // now is what lets a reference to a parameter resolve before the bind.
    for (const record of program.linkage) {
      instance.index(record);
    }
    for (const record of program.local) {
      instance.index(record);
    }
    // A file's 01 records share one record area, which is why a REDEFINES is
    // not needed to read the same bytes two ways.
    for (const description of program.descriptions) {
      const area = new Uint8Array(description.recordLength);
      for (const record of description.records) {
        instance.index(record);
        instance.roots.set(record.name, { bytes: area, base: 0 });
      }
    }

    // Every item starts at its category default before any VALUE is applied:
    // spaces for a character item, zero for a numeric one. Enterprise COBOL
    // calls uninitialised WORKING-STORAGE undefined, and GnuCOBOL fills it this
    // way, so a program that reads a field it never wrote behaves the same
    // under both. Leaving the bytes at zero instead would give a packed item a
    // sign nibble no compiler ever writes.
    this.initialiseDefaults(instance, program.working);
    for (const description of program.descriptions) {
      this.initialiseDefaults(instance, description.records);
    }
    this.applyInitialValues(instance, program.working);
    this.instances.set(program.name, instance);
    return instance;
  }

  private initialiseDefaults(instance: Instance, records: Field[]): void {
    for (const record of records) {
      const binding = instance.roots.get(record.name);
      if (!binding) {
        continue;
      }
      for (const field of flatten(record)) {
        if (field.children.length > 0 || !field.picture) {
          continue;
        }
        const blank: Value =
          field.picture.category === "numeric" ||
          field.picture.category === "numeric-edited"
            ? { kind: "number", value: { units: 0n, scale: 0 } }
            : { kind: "text", value: "" };
        for (let index = 1; index <= occurrencesOf(field); index += 1) {
          this.store(this.locateOccurrence(field, binding, index), blank);
        }
      }
    }
  }

  /**
   * The address of one occurrence of a field, counted across every table it is
   * inside.
   *
   * Initialisation runs before any statement, so there is nothing to evaluate a
   * subscript expression against. Occurrences are numbered from 1 in row-major
   * order and this converts that number into an address directly.
   */
  private locateOccurrence(
    field: Field,
    binding: Binding,
    index: number,
  ): Location {
    const chain: Field[] = [];
    for (let node: Field | null = field; node; node = node.parent) {
      chain.unshift(node);
    }
    let offset = binding.base;
    let remaining = index - 1;
    for (const node of chain) {
      offset += node.offset;
      if (node.occurs > 1) {
        const stride = occurrencesBelow(chain, node);
        const at = Math.floor(remaining / stride) % node.occurs;
        offset += at * node.elementLength;
        remaining -= at * stride;
      }
    }
    return { field, bytes: binding.bytes, offset, length: field.elementLength };
  }

  private applyInitialValues(instance: Instance, records: Field[]): void {
    for (const record of records) {
      for (const field of flatten(record)) {
        if (field.value === null) {
          continue;
        }
        const binding = instance.roots.get(field.root.name);
        if (!binding) {
          continue;
        }
        const location = this.locate(instance, field, binding, []);
        this.store(location, this.literalValue(field.value));
      }
    }
  }

  private literalValue(literal: Literal): Value {
    switch (literal.kind) {
      case "text":
        return { kind: "text", value: literal.value };
      case "number":
        return { kind: "number", value: decimalOf(literal.value) };
      case "figurative":
        return { kind: "text", value: figurativeText(literal.value) };
    }
  }

  /* -------------------------------------------------- invocation */

  private invoke(program: Program, args: Binding[]): void {
    const instance = this.instanceOf(program);

    if (this.callStack.length > 400) {
      throw new CobolRuntimeError(
        `${program.name} recursed more than 400 deep. A generated program that recurses without a base case reaches this instead of exhausting the browser.`,
      );
    }
    this.callStack.push(program.name);

    // LOCAL-STORAGE is fresh for every invocation, which is what makes a
    // RECURSIVE program's locals its own. WORKING-STORAGE is not: it persists
    // between calls, and the reference ledger depends on that to hold balances.
    const locals = new Map<string, Binding>();
    for (const record of program.local) {
      locals.set(record.name, {
        bytes: new Uint8Array(record.length),
        base: 0,
      });
    }
    instance.localFrames.push(locals);
    this.applyInitialValues(
      { ...instance, roots: locals } as Instance,
      program.local,
    );

    // Bind the parameters.
    const previousLinkage = new Map<string, Binding | undefined>();
    for (const [index, name] of program.using.entries()) {
      previousLinkage.set(name, instance.roots.get(name));
      const argument = args[index];
      if (argument) {
        instance.roots.set(name, argument);
      }
    }

    try {
      // After the declaratives, never through them. A `USE` section is reached
      // only by a failed I/O statement; falling into it on the way past would
      // report every file as broken before the program had opened one.
      const start = program.declaratives.reduce(
        (after, use) => Math.max(after, use.thru + 1),
        0,
      );
      this.performRange(instance, start, program.paragraphs.length - 1);
    } catch (signal) {
      if (
        !(signal instanceof GobackSignal) &&
        !(signal instanceof StopRunSignal)
      ) {
        throw signal;
      }
      if (signal instanceof StopRunSignal) {
        instance.localFrames.pop();
        this.callStack.pop();
        throw signal;
      }
    }

    for (const [name, binding] of previousLinkage) {
      if (binding) {
        instance.roots.set(name, binding);
      } else {
        instance.roots.delete(name);
      }
    }
    instance.localFrames.pop();
    this.callStack.pop();
  }

  /* -------------------------------------------------- control flow */

  /**
   * Runs paragraphs `from` through `thru`, which is what `PERFORM ... THRU`
   * means and what the generated code relies on for every function it emits.
   *
   * A `GO TO` inside the range moves the counter; one outside it leaves the
   * range, which is how the emitted failure path reaches its handler.
   */
  private performRange(instance: Instance, from: number, thru: number): void {
    let at = from;
    while (at <= thru) {
      const paragraph = instance.program.paragraphs[at];
      if (!paragraph) {
        return;
      }
      try {
        this.execute(instance, paragraph.statements);
        at += 1;
      } catch (signal) {
        if (signal instanceof ExitParagraphSignal) {
          at += 1;
          continue;
        }
        if (signal instanceof GoToSignal) {
          const target = instance.paragraphIndex.get(signal.target);
          if (target === undefined) {
            throw new CobolRuntimeError(
              `GO TO ${signal.target}, which is not a paragraph in ${instance.program.name}.`,
            );
          }
          if (target >= from && target <= thru) {
            at = target;
            continue;
          }
          throw signal;
        }
        throw signal;
      }
    }
  }

  private execute(instance: Instance, statements: Statement[]): void {
    for (const statement of statements) {
      this.steps += 1;
      if (this.steps > this.stepLimit) {
        throw new CobolRuntimeError(
          `The program ran past ${String(this.stepLimit)} statements without ending. Check the loop bounds.`,
        );
      }
      this.step(instance, statement);
    }
  }

  private step(instance: Instance, statement: Statement): void {
    switch (statement.kind) {
      case "continue":
        return;

      case "move": {
        const value = this.evaluate(instance, statement.from);
        for (const target of statement.to) {
          this.store(this.resolve(instance, target), value);
        }
        return;
      }

      case "compute": {
        const value = this.arithmeticValue(instance, statement.value);
        this.assignArithmetic(
          instance,
          statement.targets,
          value,
          statement.onSizeError,
          statement.notOnSizeError,
        );
        return;
      }

      case "arith":
        this.executeArithmetic(instance, statement);
        return;

      case "if": {
        const branch = this.test(instance, statement.condition)
          ? statement.then
          : statement.otherwise;
        this.execute(instance, branch);
        return;
      }

      case "evaluate": {
        for (const branch of statement.branches) {
          // `WHEN OTHER` matches unconditionally; every other `WHEN` is a
          // condition to evaluate against the subject.
          const matched = branch.whens.some(
            (when) => when.kind === "other" || this.test(instance, when),
          );
          if (matched) {
            this.execute(instance, branch.body);
            return;
          }
        }
        return;
      }

      case "perform":
        this.executePerform(instance, statement);
        return;

      case "goto":
        throw new GoToSignal(statement.target);

      case "exit":
        if (statement.what === "perform") {
          throw new ExitPerformSignal();
        }
        if (statement.what === "program") {
          throw new GobackSignal();
        }
        throw new ExitParagraphSignal();

      case "goback":
        throw new GobackSignal();

      case "stop-run":
        throw new StopRunSignal();

      case "call":
        this.executeCall(instance, statement);
        return;

      case "display": {
        const text = statement.items
          .map((item) => this.displayText(instance, item.value))
          .join("");
        this.sysout.push(text);
        return;
      }

      case "set-address": {
        const source = this.resolve(instance, statement.source);
        const target = this.findField(instance, statement.target);
        instance.roots.set(target.root.name, {
          bytes: source.bytes,
          base: source.offset,
        });
        return;
      }

      case "set": {
        const value = this.evaluate(instance, statement.value);
        for (const target of statement.targets) {
          this.store(this.resolve(instance, target), value);
        }
        return;
      }

      case "set-condition": {
        for (const target of statement.targets) {
          const found = instance.conditions.get(target.name)?.[0];
          if (!found) {
            throw new CobolRuntimeError(
              `SET ${target.name} TO TRUE, but ${target.name} is not a condition name.`,
            );
          }
          const first = found.condition.ranges[0]?.from;
          if (!first) {
            throw new CobolRuntimeError(
              `${target.name} has no VALUE to set its item to.`,
            );
          }
          const binding = this.bindingFor(instance, found.field);
          this.store(
            this.locate(instance, found.field, binding, []),
            this.literalValue(first),
          );
        }
        return;
      }

      case "initialize": {
        for (const target of statement.targets) {
          const field = this.findField(instance, target);
          for (const leaf of flatten(field)) {
            if (leaf.children.length > 0) {
              continue;
            }
            const location = this.resolveField(
              instance,
              leaf,
              target.subscripts,
            );
            this.store(
              location,
              leaf.picture && leaf.picture.category === "numeric"
                ? { kind: "number", value: { units: 0n, scale: 0 } }
                : { kind: "text", value: "" },
            );
          }
        }
        return;
      }

      case "inspect": {
        const target = this.resolve(instance, statement.target);
        let text = decodeText(target.bytes, target.offset, target.length);
        for (const replacement of statement.replacements) {
          const from = this.displayText(instance, replacement.from);
          const to = this.displayText(instance, replacement.to);
          if (from.length !== to.length) {
            throw new CobolRuntimeError(
              `INSPECT REPLACING needs both operands the same length; ${JSON.stringify(from)} and ${JSON.stringify(to)} are not.`,
            );
          }
          text = text.split(from).join(to);
        }
        encodeText(target.bytes, target.offset, target.length, text);
        return;
      }

      case "inspect-tallying": {
        const target = this.resolve(instance, statement.target);
        const text = decodeText(target.bytes, target.offset, target.length);
        let found = 0;
        for (const count of statement.counts) {
          if (count.what === "characters") {
            found += text.length;
            continue;
          }
          const of = this.displayText(instance, count.of!);
          if (of.length === 0) {
            // A zero-length operand would match everywhere and count forever.
            throw new CobolRuntimeError(
              "INSPECT TALLYING needs something to count.",
            );
          }
          if (count.what === "leading") {
            let at = 0;
            while (text.startsWith(of, at)) {
              found += 1;
              at += of.length;
            }
            continue;
          }
          // Non-overlapping, left to right, which is what `split` counts.
          found += text.split(of).length - 1;
        }
        // TALLYING adds to the counter rather than replacing it.
        const counter = this.resolve(instance, statement.counter);
        this.store(counter, {
          kind: "number",
          value: add(this.numberAt(counter), {
            units: BigInt(found),
            scale: 0,
          }),
        });
        return;
      }

      case "inspect-converting": {
        const target = this.resolve(instance, statement.target);
        const from = this.displayText(instance, statement.from);
        const to = this.displayText(instance, statement.to);
        if (from.length !== to.length) {
          throw new CobolRuntimeError(
            `INSPECT CONVERTING needs both operands the same length; ${JSON.stringify(from)} and ${JSON.stringify(to)} are not.`,
          );
        }
        // Character for character, and the leftmost mapping wins where an
        // operand repeats a character — the Language Reference forbids the
        // repeat rather than defining it, so this is a choice, made once and
        // stated, instead of whatever the last write happened to leave.
        const map = new Map<string, string>();
        for (let index = 0; index < from.length; index += 1) {
          const key = from[index] as string;
          if (!map.has(key)) {
            map.set(key, to[index] as string);
          }
        }
        const text = decodeText(target.bytes, target.offset, target.length);
        encodeText(
          target.bytes,
          target.offset,
          target.length,
          [...text]
            .map((character) => map.get(character) ?? character)
            .join(""),
        );
        return;
      }

      case "string":
        this.executeString(instance, statement);
        return;

      case "unstring":
        this.executeUnstring(instance, statement);
        return;

      case "open":
        for (const file of statement.files) {
          this.openFile(instance, file.name, file.mode);
        }
        return;

      case "close":
        for (const name of statement.files) {
          const open = this.fileOf(instance, name);
          // Closing a file that was never opened is status 42, not success.
          // Reporting `00` told a program that checks its status after every
          // operation — which is what `BANK-FILE-001` exists to require — that
          // a close it never had an open for had worked.
          if (open.mode === null) {
            this.setStatus(instance, open, "42");
            continue;
          }
          open.mode = null;
          this.setStatus(instance, open, "00");
        }
        return;

      case "read":
        this.executeRead(instance, statement);
        return;

      case "write":
      case "rewrite":
        this.executeWrite(instance, statement);
        return;

      case "start":
        this.executeStart(instance, statement);
        return;

      case "sort":
        this.executeSort(instance, statement);
        return;

      case "release":
        this.executeRelease(instance, statement);
        return;

      case "return":
        this.executeReturn(instance, statement);
        return;
    }

    // Unreachable while every statement kind is handled above, and a compile
    // error the moment one is not. `SORT` reached this switch as a parsed
    // statement with no case and was silently skipped for as long as it took to
    // notice — a sort that does nothing leaves the output file empty and the
    // program reports success.
    const unhandled: never = statement;
    throw new CobolRuntimeError(
      `${JSON.stringify(unhandled)} is a statement this interpreter parses and does not execute.`,
    );
  }

  /* -------------------------------------------------- sort and merge */

  /** The `SD` file a `SORT`, `MERGE`, `RELEASE` or `RETURN` names. */
  private sortDescriptionOf(
    instance: Instance,
    name: string,
    verb: string,
  ): FileDescription {
    const description = instance.program.descriptions.find(
      (item) => item.name === name,
    );
    if (!description) {
      throw new CobolRuntimeError(
        `${verb} ${name}, which is not a file in ${instance.program.name}.`,
      );
    }
    if (!description.sort) {
      throw new CobolRuntimeError(
        `${verb} ${name}, which is described by an FD. A sort work file needs an SD.`,
      );
    }
    return description;
  }

  private sortReturn(): number {
    return Number(
      decodeNumeric(this.sortReturnBytes, 0, 2, SORT_RETURN_PICTURE, "binary")
        .units,
    );
  }

  /**
   * `SORT` and `MERGE`, format 1.
   *
   * Three phases, and the register is checked between them because the
   * Language Reference lets a procedure stop the operation by storing 16 into
   * it: fill the work file, order it, empty it. What fills it is `USING` or an
   * input procedure; what empties it is `GIVING` or an output procedure.
   */
  private executeSort(
    instance: Instance,
    statement: Extract<Statement, { kind: "sort" }>,
  ): void {
    const description = this.sortDescriptionOf(
      instance,
      statement.file,
      statement.operation,
    );
    const work: SortWork = { records: [], position: 0, releasing: true };
    instance.sortWork.set(statement.file, work);

    // The completion code of *this* operation, so a program with two sorts does
    // not read the first one's answer after the second.
    encodeNumeric(
      this.sortReturnBytes,
      0,
      2,
      decimalOf("0"),
      SORT_RETURN_PICTURE,
      "binary",
    );

    try {
      if (statement.inputProcedure) {
        this.performProcedure(instance, statement.inputProcedure);
      } else {
        this.readIntoWork(instance, statement, description, work);
      }
      work.releasing = false;

      if (this.sortReturn() === 0) {
        this.orderWork(instance, statement, description, work);

        if (statement.outputProcedure) {
          this.performProcedure(instance, statement.outputProcedure);
        } else {
          this.writeFromWork(instance, statement, work);
        }
      }
    } catch (signal) {
      if (!(signal instanceof SortTerminatedSignal)) {
        throw signal;
      }
    } finally {
      instance.sortWork.delete(statement.file);
    }
  }

  /** `PERFORM`s an input or output procedure, section extent included. */
  private performProcedure(
    instance: Instance,
    procedure: { from: string; thru: string | null },
  ): void {
    const from = instance.paragraphIndex.get(procedure.from);
    if (from === undefined) {
      throw new CobolRuntimeError(
        `${procedure.from} is not a procedure in ${instance.program.name}.`,
      );
    }
    const last = procedure.thru ?? procedure.from;
    const thru =
      instance.sectionEnd.get(last) ?? instance.paragraphIndex.get(last);
    if (thru === undefined) {
      throw new CobolRuntimeError(
        `${last} is not a procedure in ${instance.program.name}.`,
      );
    }
    this.performRange(instance, from, thru);
  }

  /**
   * `USING` — the sort opens, reads, and closes the input files itself.
   *
   * A record shorter than the work record is padded with spaces and a longer
   * one truncated, which is what moving it into the fixed record area does.
   */
  private readIntoWork(
    instance: Instance,
    statement: Extract<Statement, { kind: "sort" }>,
    description: FileDescription,
    work: SortWork,
  ): void {
    for (const name of statement.using) {
      const open = this.fileOf(instance, name);
      this.openFile(instance, name, "INPUT");
      if (open.mode === null) {
        // The dataset is not there. The sort did not complete, which is what
        // `SORT-RETURN` is for; GnuCOBOL reports it the same way.
        this.failSort();
        return;
      }
      for (const record of this.recordsOf(open)) {
        work.records.push(sized(record, description.recordLength));
      }
      open.mode = null;
    }
  }

  /** Orders the work file, in place, by the statement's keys. */
  private orderWork(
    instance: Instance,
    statement: Extract<Statement, { kind: "sort" }>,
    description: FileDescription,
    work: SortWork,
  ): void {
    const record = description.records[0];
    if (!record) {
      throw new CobolRuntimeError(
        `${statement.file} has no record description, so its keys have nowhere to be.`,
      );
    }
    const keys = statement.keys.map((key) => ({
      field: this.findField(instance, key.ref),
      descending: key.descending,
    }));
    for (const key of keys) {
      if (key.field.root.name !== record.name) {
        throw new CobolRuntimeError(
          `${key.field.name} is not a field of ${record.name}, so it cannot be a key of ${statement.file}.`,
        );
      }
    }

    const compareRecords = (left: Uint8Array, right: Uint8Array): number => {
      for (const key of keys) {
        const order = compareValues(
          this.readAt(keyLocation(key.field, left)),
          this.readAt(keyLocation(key.field, right)),
        );
        if (order !== 0) {
          return key.descending ? -order : order;
        }
      }
      return 0;
    };

    /*
     * `Array.prototype.sort` is stable, which is what `MERGE` and a `SORT WITH
     * DUPLICATES IN ORDER` both require: equal keys come back in the order they
     * arrived, and for a merge the records arrive in `USING` order, which is
     * the order the Language Reference specifies for equal keys.
     *
     * Without the DUPLICATES phrase the order of equal keys is undefined in
     * Enterprise COBOL, so a stable result here is one valid answer and not the
     * only one. The backend emits the phrase for exactly that reason; a program
     * that does not carry it is ordered stably here and might not be on the
     * target, which is divergence D26.
     */
    work.records.sort(compareRecords);
  }

  /** `GIVING` — the sort opens, writes, and closes the output files itself. */
  private writeFromWork(
    instance: Instance,
    statement: Extract<Statement, { kind: "sort" }>,
    work: SortWork,
  ): void {
    for (const name of statement.giving) {
      const open = this.fileOf(instance, name);
      this.openFile(instance, name, "OUTPUT");
      if (open.mode === null) {
        this.failSort();
        return;
      }
      const records = this.recordsOf(open);
      for (const record of work.records) {
        records.push(trimmedForOrganization(open, record));
      }
      open.position = records.length;
      open.mode = null;
    }
  }

  /** Stores 16 in `SORT-RETURN`, which is how a sort says it did not finish. */
  private failSort(): void {
    encodeNumeric(
      this.sortReturnBytes,
      0,
      2,
      decimalOf("16"),
      SORT_RETURN_PICTURE,
      "binary",
    );
  }

  /** `RELEASE` — one record from an input procedure into the work file. */
  private executeRelease(
    instance: Instance,
    statement: Extract<Statement, { kind: "release" }>,
  ): void {
    const field = this.findField(instance, statement.record);
    const description = instance.program.descriptions.find((item) =>
      item.records.some((each) => each.name === field.root.name),
    );
    if (!description?.sort) {
      throw new CobolRuntimeError(
        `RELEASE ${statement.record.name}, which is not a record of a sort work file.`,
      );
    }
    const work = instance.sortWork.get(description.name);
    if (!work?.releasing) {
      throw new CobolRuntimeError(
        `RELEASE ${statement.record.name} outside the input procedure of a SORT on ${description.name}.`,
      );
    }

    if (statement.from) {
      this.store(this.resolveField(instance, field, []), {
        kind: "text",
        value: this.displayText(instance, statement.from),
      });
    }

    // "You can set the SORT-RETURN special register to 16 in an error
    // declarative or input/output procedure to terminate a sort or merge
    // operation ... The operation is terminated on the next input or output
    // function." This is that next input function.
    if (this.sortReturn() !== 0) {
      throw new SortTerminatedSignal();
    }

    const area = this.recordAreaOf(instance, description);
    work.records.push(
      Uint8Array.from(
        area.bytes.subarray(area.offset, area.offset + area.length),
      ),
    );
  }

  /** `RETURN` — the next ordered record, into the work file's record area. */
  private executeReturn(
    instance: Instance,
    statement: Extract<Statement, { kind: "return" }>,
  ): void {
    const description = this.sortDescriptionOf(
      instance,
      statement.file,
      "RETURN",
    );
    const work = instance.sortWork.get(statement.file);
    if (!work) {
      throw new CobolRuntimeError(
        `RETURN ${statement.file} outside the output procedure of a SORT or MERGE on it.`,
      );
    }

    const record = work.records[work.position];
    if (!record || this.sortReturn() !== 0) {
      this.execute(instance, statement.atEnd ?? []);
      return;
    }
    work.position += 1;

    const area = this.recordAreaOf(instance, description);
    area.bytes.fill(SPACE, area.offset, area.offset + area.length);
    area.bytes.set(
      record.subarray(0, Math.min(record.length, area.length)),
      area.offset,
    );

    if (statement.into) {
      this.store(this.resolve(instance, statement.into), {
        kind: "text",
        value: decodeText(area.bytes, area.offset, area.length),
      });
    }
    if (statement.notAtEnd) {
      this.execute(instance, statement.notAtEnd);
    }
  }

  /* -------------------------------------------------- arithmetic */

  private assignArithmetic(
    instance: Instance,
    targets: { ref: Reference; rounded: boolean }[],
    value: Decimal,
    onSizeError: Statement[] | null,
    notOnSizeError: Statement[] | null,
  ): void {
    let sizeError = false;
    for (const target of targets) {
      const location = this.resolve(instance, target.ref);
      const picture = location.field.picture;
      if (!picture) {
        throw new CobolRuntimeError(
          `${target.ref.name} is a group item and cannot receive an arithmetic result.`,
        );
      }
      const stored = target.rounded
        ? roundHalfUp(value, picture.scale)
        : rescale(value, picture.scale);
      if (overflows(stored, picture.digits, picture.scale)) {
        sizeError = true;
        // ON SIZE ERROR leaves the receiving item unchanged, which is the whole
        // point of the phrase: a truncated balance must not reach the field.
        continue;
      }
      this.store(location, { kind: "number", value: stored });
    }

    if (sizeError) {
      if (!onSizeError) {
        throw new CobolRuntimeError(
          "An arithmetic result did not fit its receiving item, and the statement has no ON SIZE ERROR phrase.",
        );
      }
      this.execute(instance, onSizeError);
      return;
    }
    if (notOnSizeError) {
      this.execute(instance, notOnSizeError);
    }
  }

  private executeArithmetic(
    instance: Instance,
    statement: Extract<Statement, { kind: "arith" }>,
  ): void {
    const operands = statement.operands.map((expr) =>
      this.arithmeticValue(instance, expr),
    );
    const rhs = statement.rhs.map((entry) => ({
      entry,
      value: this.numberAt(this.resolve(instance, entry.ref)),
    }));

    const sum = (values: Decimal[]): Decimal =>
      values.reduce((total, value) => add(total, value), {
        units: 0n,
        scale: 0,
      });

    const giving = statement.giving;
    const results: {
      targets: { ref: Reference; rounded: boolean }[];
      value: Decimal;
    }[] = [];
    /** The two operands a REMAINDER is worked out from, once one is divided. */
    let division: { dividend: Decimal; divisor: Decimal } | null = null;

    switch (statement.verb) {
      case "ADD": {
        const left = sum(operands);
        if (giving.length > 0) {
          const total = add(left, sum(rhs.map((item) => item.value)));
          results.push({ targets: giving, value: total });
        } else {
          for (const item of rhs) {
            results.push({
              targets: [item.entry],
              value: add(left, item.value),
            });
          }
        }
        break;
      }
      case "SUBTRACT": {
        const left = sum(operands);
        if (giving.length > 0) {
          const total = subtract(sum(rhs.map((item) => item.value)), left);
          results.push({ targets: giving, value: total });
        } else {
          for (const item of rhs) {
            results.push({
              targets: [item.entry],
              value: subtract(item.value, left),
            });
          }
        }
        break;
      }
      case "MULTIPLY": {
        const left = operands[0] ?? { units: 0n, scale: 0 };
        if (giving.length > 0) {
          const product = multiply(
            left,
            rhs[0]?.value ?? { units: 1n, scale: 0 },
          );
          results.push({ targets: giving, value: product });
        } else {
          for (const item of rhs) {
            results.push({
              targets: [item.entry],
              value: multiply(left, item.value),
            });
          }
        }
        break;
      }
      case "DIVIDE": {
        const left = operands[0] ?? { units: 0n, scale: 0 };
        if (statement.joiner === "BY") {
          // `DIVIDE A BY B GIVING C` — A over B.
          const divisor = operands[1] ??
            rhs[0]?.value ?? { units: 1n, scale: 0 };
          division = { dividend: left, divisor };
          results.push({ targets: giving, value: divide(left, divisor) });
          break;
        }
        // `DIVIDE A INTO B` — B over A.
        if (giving.length > 0) {
          const dividend = rhs[0]?.value ?? { units: 0n, scale: 0 };
          division = { dividend, divisor: left };
          results.push({ targets: giving, value: divide(dividend, left) });
        } else {
          for (const item of rhs) {
            results.push({
              targets: [item.entry],
              value: divide(item.value, left),
            });
          }
        }
        break;
      }
    }

    for (const result of results) {
      this.assignArithmetic(
        instance,
        result.targets,
        result.value,
        statement.onSizeError,
        null,
      );
    }

    /*
     * `REMAINDER`, which was parsed and then dropped.
     *
     * The Language Reference works it out from the quotient *as stored*:
     * multiply the quotient by the divisor and subtract that product from the
     * dividend. So it has to be read back out of the receiving field, after the
     * assignment above has truncated it to that field's picture — computing it
     * from the exact quotient would make it zero every time.
     *
     * Nothing here computed it at all, which left the field holding whatever it
     * held before. Every generated rounding mode this compiler emits reads that
     * field to decide its final step, so `HALF_EVEN` — the one this project
     * calls the usual choice for money — silently truncated instead: 100000
     * divided by 7 came back 14285.7142 where `cobc` gives 14285.7143.
     */
    const remainder = statement.remainder;
    if (remainder && division) {
      const quotient = giving[0];
      const stored = quotient
        ? this.numberAt(this.resolve(instance, quotient.ref))
        : { units: 0n, scale: 0 };
      this.assignArithmetic(
        instance,
        [{ ref: remainder, rounded: false }],
        subtract(division.dividend, multiply(stored, division.divisor)),
        statement.onSizeError,
        null,
      );
    }
  }

  /* -------------------------------------------------- perform */

  private executePerform(
    instance: Instance,
    statement: Extract<Statement, { kind: "perform" }>,
  ): void {
    const body = (): void => {
      if (statement.body) {
        this.execute(instance, statement.body);
        return;
      }
      const target = statement.target!;
      const from = instance.paragraphIndex.get(target.from);
      if (from === undefined) {
        throw new CobolRuntimeError(
          `PERFORM ${target.from}, which is not a paragraph in ${instance.program.name}.`,
        );
      }
      // Performing a section performs every paragraph in it, not just the one
      // the header names. `PERFORM A THRU A-EXIT` — what the emitter writes for
      // every function — is unaffected, because a paragraph is its own extent.
      const last = target.thru ?? target.from;
      const thru =
        instance.sectionEnd.get(last) ?? instance.paragraphIndex.get(last);
      if (thru === undefined) {
        throw new CobolRuntimeError(
          `PERFORM ... THRU ${target.thru ?? ""}, which is not a paragraph in ${instance.program.name}.`,
        );
      }
      this.performRange(instance, from, thru);
    };

    try {
      if (statement.varying) {
        const control = this.resolve(instance, statement.varying.ref);
        this.store(control, {
          kind: "number",
          value: this.arithmeticValue(instance, statement.varying.from),
        });
        const by = this.arithmeticValue(instance, statement.varying.by);
        for (;;) {
          if (
            !statement.testAfter &&
            this.test(instance, statement.varying.until)
          ) {
            return;
          }
          body();
          if (
            statement.testAfter &&
            this.test(instance, statement.varying.until)
          ) {
            return;
          }
          const current = this.numberAt(
            this.resolve(instance, statement.varying.ref),
          );
          this.store(this.resolve(instance, statement.varying.ref), {
            kind: "number",
            value: add(current, by),
          });
          this.guardSteps();
        }
      }

      if (statement.until) {
        for (;;) {
          if (!statement.testAfter && this.test(instance, statement.until)) {
            return;
          }
          body();
          if (statement.testAfter && this.test(instance, statement.until)) {
            return;
          }
          this.guardSteps();
        }
      }

      if (statement.times) {
        const count = Number(
          rescale(this.arithmeticValue(instance, statement.times), 0).units,
        );
        for (let index = 0; index < count; index += 1) {
          body();
          this.guardSteps();
        }
        return;
      }

      body();
    } catch (signal) {
      if (signal instanceof ExitPerformSignal) {
        return;
      }
      throw signal;
    }
  }

  private guardSteps(): void {
    this.steps += 1;
    if (this.steps > this.stepLimit) {
      throw new CobolRuntimeError(
        `The program ran past ${String(this.stepLimit)} statements without ending. Check the loop bounds.`,
      );
    }
  }

  /* -------------------------------------------------- call */

  private executeCall(
    instance: Instance,
    statement: Extract<Statement, { kind: "call" }>,
  ): void {
    const name = this.displayText(instance, statement.program).trim();
    const target = this.programs.get(name);
    if (!target) {
      throw new CobolUnsupportedError(
        `Line ${String(statement.line)}: CALL "${name}", and no program of that name is loaded. Load its source, or run a program that does not call it.`,
      );
    }

    const args: Binding[] = statement.using.map((argument) => {
      if (argument.value.kind !== "ref") {
        // BY CONTENT of a literal needs storage of its own; the generated code
        // never does it, so it raises rather than silently aliasing nothing.
        throw new CobolUnsupportedError(
          `Line ${String(statement.line)}: CALL ... USING a literal is not implemented.`,
        );
      }
      const location = this.resolve(instance, argument.value.ref);
      if (argument.by === "content") {
        const copy = new Uint8Array(location.length);
        copy.set(
          location.bytes.subarray(
            location.offset,
            location.offset + location.length,
          ),
        );
        return { bytes: copy, base: 0 };
      }
      return { bytes: location.bytes, base: location.offset };
    });

    this.invoke(target, args);
  }

  /* -------------------------------------------------- string */

  /**
   * `UNSTRING source DELIMITED BY d INTO a b c`.
   *
   * The sending field is scanned left to right. For each receiver in turn, the
   * characters up to the next delimiter — or to the end of the field, when
   * there is no next delimiter — are the one it gets; the delimiter itself is
   * discarded and the scan resumes after it. A receiver the scan never reaches
   * is left as it was, which is why the emitter writes `MOVE SPACES TO` in
   * front of every one of these.
   *
   * Adjacent delimiters therefore produce an empty field rather than being
   * collapsed. `A--B` into three receivers gives `A`, empty, `B`: collapsing
   * runs is what `DELIMITED BY ALL` asks for, and this parser refuses that
   * form rather than guessing which was meant.
   *
   * The overflow condition is IBM's third case, which is the only one reachable
   * here because the emitted statement has no pointer: "All data receiving
   * fields have been acted upon and the sending field still contains unexamined
   * character positions." A source with exactly as many fields as receivers
   * does not overflow; one with more does.
   */
  private executeUnstring(
    instance: Instance,
    statement: Extract<Statement, { kind: "unstring" }>,
  ): void {
    const source = this.displayText(instance, statement.source);
    const delimiter = this.displayText(instance, statement.delimiter);

    let at = 0;
    let filled = 0;
    for (const reference of statement.into) {
      if (at > source.length) {
        break;
      }
      // A zero-length delimiter would never advance the scan, so the whole
      // remaining field goes into this receiver and the scan ends. COBOL has no
      // way to write one; a runtime value can still be all spaces after a
      // `MOVE`, and a loop that never terminates is worse than a short answer.
      const cut = delimiter === "" ? -1 : source.indexOf(delimiter, at);
      const field = cut === -1 ? source.slice(at) : source.slice(at, cut);
      this.store(this.resolve(instance, reference), {
        kind: "text",
        value: field,
      });
      filled += 1;
      if (cut === -1) {
        at = source.length + 1;
        break;
      }
      at = cut + delimiter.length;
    }

    const unexamined = at <= source.length;
    if (unexamined && filled === statement.into.length && statement.overflow) {
      this.execute(instance, statement.overflow);
    }
  }

  private executeString(
    instance: Instance,
    statement: Extract<Statement, { kind: "string" }>,
  ): void {
    const target = this.resolve(instance, statement.into);
    let at = 0;
    if (statement.pointer) {
      at =
        Number(
          rescale(this.numberAt(this.resolve(instance, statement.pointer)), 0)
            .units,
        ) - 1;
    }

    let overflowed = false;
    for (const source of statement.sources) {
      let text = this.displayText(instance, source.value);
      if (source.delimiter !== "SIZE") {
        const delimiter = this.displayText(instance, source.delimiter);
        const cut = text.indexOf(delimiter);
        if (cut >= 0) {
          text = text.slice(0, cut);
        }
      }
      for (const char of text) {
        if (at >= target.length) {
          overflowed = true;
          break;
        }
        target.bytes[target.offset + at] = char.charCodeAt(0);
        at += 1;
      }
      if (overflowed) {
        break;
      }
    }

    if (statement.pointer) {
      this.store(this.resolve(instance, statement.pointer), {
        kind: "number",
        value: { units: BigInt(at + 1), scale: 0 },
      });
    }
    if (overflowed && statement.overflow) {
      this.execute(instance, statement.overflow);
    }
  }

  /* -------------------------------------------------- files */

  private fileOf(instance: Instance, name: string): OpenFile {
    const existing = instance.files.get(name);
    if (existing) {
      return existing;
    }
    const entry = instance.program.files.find((file) => file.name === name);
    const description = instance.program.descriptions.find(
      (item) => item.name === name,
    );
    if (!entry || !description) {
      throw new CobolRuntimeError(
        `${name} is not a file in ${instance.program.name}.`,
      );
    }
    const open: OpenFile = { entry, description, mode: null, position: 0 };
    instance.files.set(name, open);
    return open;
  }

  private setStatus(instance: Instance, open: OpenFile, status: string): void {
    if (open.entry.status === null) {
      return;
    }
    const field = instance.fields.get(open.entry.status)?.[0];
    if (!field) {
      return;
    }
    this.store(this.resolveField(instance, field, []), {
      kind: "text",
      value: status,
    });
  }

  /**
   * Runs the file's `USE AFTER STANDARD ERROR PROCEDURE`, if the last operation
   * failed and the statement did not handle it itself.
   *
   * Enterprise COBOL runs the declarative when the status is not `0x` and the
   * statement carried no applicable `AT END` or `INVALID KEY` phrase. A
   * statement that handled its own outcome has already decided what to do.
   */
  private afterIo(instance: Instance, open: OpenFile, handled: boolean): void {
    if (handled || this.inDeclarative) {
      return;
    }
    const status = this.statusOf(instance, open);
    if (status === null || status.startsWith("0")) {
      return;
    }
    const use = instance.program.declaratives.find(
      (candidate) => candidate.file === open.entry.name,
    );
    if (!use) {
      return;
    }
    this.inDeclarative = true;
    try {
      this.performRange(instance, use.from, use.thru);
    } finally {
      this.inDeclarative = false;
    }
  }

  private statusOf(instance: Instance, open: OpenFile): string | null {
    if (open.entry.status === null) {
      return null;
    }
    const field = instance.fields.get(open.entry.status)?.[0];
    if (!field) {
      return null;
    }
    const location = this.resolveField(instance, field, []);
    return decodeText(location.bytes, location.offset, location.length);
  }

  private recordsOf(open: OpenFile): Uint8Array[] {
    const existing = this.fileData.get(open.entry.assign);
    if (existing) {
      return existing;
    }
    const created: Uint8Array[] = [];
    this.fileData.set(open.entry.assign, created);
    return created;
  }

  private openFile(
    instance: Instance,
    name: string,
    mode: "INPUT" | "OUTPUT" | "I-O" | "EXTEND",
  ): void {
    const open = this.fileOf(instance, name);
    open.mode = mode;
    const present = this.fileData.has(open.entry.assign);

    switch (mode) {
      case "INPUT":
      case "I-O":
        if (!present && open.entry.optional) {
          // An OPTIONAL file that is not there opens as an empty one, with file
          // status 05 rather than 35. The program carries on and its first READ
          // hits AT END, which is what "no checkpoint, start from the top"
          // looks like to a restartable batch.
          this.fileData.set(open.entry.assign, []);
          open.position = 0;
          this.setStatus(instance, open, "05");
          return;
        }
        if (!present) {
          // File status 35: the dataset an OPEN names is not there. The
          // generated code tests for it, and `examples/failed-open` exists
          // because a program that does not is a job that ends with return code
          // 0 having processed nothing.
          this.setStatus(instance, open, "35");
          open.mode = null;
          this.afterIo(instance, open, false);
          return;
        }
        open.position = 0;
        break;
      case "OUTPUT":
        this.fileData.set(open.entry.assign, []);
        open.position = 0;
        break;
      case "EXTEND":
        if (!present) {
          this.fileData.set(open.entry.assign, []);
        }
        open.position = this.recordsOf(open).length;
        break;
    }
    this.setStatus(instance, open, "00");
  }

  private recordArea(instance: Instance, open: OpenFile): Location {
    return this.recordAreaOf(instance, open.description);
  }

  /**
   * The bytes a file's records share.
   *
   * Every 01 under one FD or SD describes the same area, so the first one names
   * it and its length is the longest description of it.
   */
  private recordAreaOf(
    instance: Instance,
    description: FileDescription,
  ): Location {
    const record = description.records[0];
    if (!record) {
      throw new CobolRuntimeError(
        `${description.name} has no record description.`,
      );
    }
    const binding = this.bindingFor(instance, record);
    return {
      field: record,
      bytes: binding.bytes,
      offset: binding.base,
      length: description.recordLength,
    };
  }

  private executeRead(
    instance: Instance,
    statement: Extract<Statement, { kind: "read" }>,
  ): void {
    const open = this.fileOf(instance, statement.file);
    if (open.mode === null) {
      this.setStatus(instance, open, "47");
      this.afterIo(instance, open, statement.atEnd !== null);
      if (statement.atEnd) {
        this.execute(instance, statement.atEnd);
      }
      return;
    }

    const records = this.recordsOf(open);
    const area = this.recordArea(instance, open);

    // A keyed READ on an indexed file finds the record whose key matches; every
    // other READ takes the next one in sequence.
    let index = open.position;
    if (
      open.entry.organization === "indexed" &&
      !statement.next &&
      open.entry.recordKey
    ) {
      const key = this.resolveField(
        instance,
        this.fieldNamed(instance, open.entry.recordKey),
        [],
      );
      const wanted = decodeText(key.bytes, key.offset, key.length);
      index = records.findIndex((record) => {
        const keyOffset = key.offset - area.offset;
        return decodeText(record, keyOffset, key.length) === wanted;
      });
      if (index < 0) {
        this.setStatus(instance, open, "23");
        this.afterIo(
          instance,
          open,
          statement.invalidKey !== null || statement.atEnd !== null,
        );
        if (statement.invalidKey) {
          this.execute(instance, statement.invalidKey);
        } else if (statement.atEnd) {
          this.execute(instance, statement.atEnd);
        }
        return;
      }
    }

    const record = records[index];
    if (!record) {
      this.setStatus(instance, open, "10");
      this.afterIo(instance, open, statement.atEnd !== null);
      if (statement.atEnd) {
        this.execute(instance, statement.atEnd);
      }
      return;
    }

    area.bytes.fill(SPACE, area.offset, area.offset + area.length);
    area.bytes.set(
      record.subarray(0, Math.min(record.length, area.length)),
      area.offset,
    );
    open.position = index + 1;
    this.setStatus(instance, open, "00");

    if (statement.into) {
      this.store(this.resolve(instance, statement.into), {
        kind: "text",
        value: decodeText(area.bytes, area.offset, area.length),
      });
    }
    if (statement.notAtEnd) {
      this.execute(instance, statement.notAtEnd);
    }
    if (statement.notInvalidKey) {
      this.execute(instance, statement.notInvalidKey);
    }
  }

  private executeWrite(
    instance: Instance,
    statement: Extract<Statement, { kind: "write" | "rewrite" }>,
  ): void {
    const field = this.findField(instance, statement.record);
    const open =
      [...instance.files.values()].find((candidate) =>
        candidate.description.records.some(
          (record) => record.name === field.name,
        ),
      ) ?? this.fileForRecord(instance, field.name);

    if (statement.from) {
      this.store(this.resolveField(instance, field, []), {
        kind: "text",
        value: this.displayText(instance, statement.from),
      });
    }

    /*
     * The length written is the *named record's*, not the record area's.
     *
     * Several 01 entries under one FD share an area as long as the longest of
     * them, and `WRITE HEADING-RECORD` writes the heading's length — not the
     * area's, and not whatever the last, longer record left in the bytes past
     * its end. Writing the area instead produced `A0001   123.45 DUE`, where
     * ` DUE` is the tail of a heading written three statements earlier, and
     * `cobc` produced `A0001   123.45`. Found by running the first
     * multi-record program through both engines.
     *
     * For a file with one record description the two lengths are equal, which
     * is why this went unnoticed until there was a second one.
     */
    const written = this.resolveField(instance, field, []);
    const bytes = trimmedForOrganization(
      open,
      written.bytes.subarray(written.offset, written.offset + written.length),
    );
    const records = this.recordsOf(open);

    if (statement.kind === "rewrite") {
      const at = Math.max(0, open.position - 1);
      records[at] = bytes;
      this.setStatus(instance, open, "00");
      return;
    }

    // An indexed file is held in key order, and a key may appear once.
    //
    // Appending was wrong twice over. A record written with a key between two
    // existing ones landed at the end, so the next sequential read returned the
    // file out of order and a `START` bisecting it positioned on the wrong
    // record. And a key that was already present was accepted silently, which
    // put a duplicate primary key in the file — `cobc` reports status 22 and
    // takes `INVALID KEY`, and so does z/OS VSAM.
    if (open.entry.organization === "indexed") {
      const keyName = open.entry.recordKey;
      if (keyName !== null) {
        const area = this.recordArea(instance, open);
        const keyField = this.resolveField(
          instance,
          this.fieldNamed(instance, keyName),
          [],
        );
        const keyOffset = keyField.offset - area.offset;
        const wanted = decodeText(bytes, keyOffset, keyField.length);
        const keyAt = (record: Uint8Array): string =>
          decodeText(record, keyOffset, keyField.length);

        if (records.some((record) => keyAt(record) === wanted)) {
          this.setStatus(instance, open, "22");
          this.afterIo(instance, open, statement.invalidKey !== null);
          if (statement.invalidKey) {
            this.execute(instance, statement.invalidKey);
          }
          return;
        }

        const at = records.findIndex((record) => keyAt(record) > wanted);
        if (at < 0) {
          records.push(bytes);
        } else {
          records.splice(at, 0, bytes);
        }
        open.position = records.length;
        this.setStatus(instance, open, "00");
        return;
      }
    }

    records.push(bytes);
    open.position = records.length;
    this.setStatus(instance, open, "00");
  }

  private fileForRecord(instance: Instance, record: string): OpenFile {
    const description = instance.program.descriptions.find((item) =>
      item.records.some((entry) => entry.name === record),
    );
    if (!description) {
      throw new CobolRuntimeError(`${record} is not a record of any file.`);
    }
    return this.fileOf(instance, description.name);
  }

  private executeStart(
    instance: Instance,
    statement: Extract<Statement, { kind: "start" }>,
  ): void {
    const open = this.fileOf(instance, statement.file);
    const records = this.recordsOf(open);
    const keyName = statement.key?.name ?? open.entry.recordKey;
    if (!keyName) {
      throw new CobolUnsupportedError(
        `Line ${String(statement.line)}: START with no key.`,
      );
    }
    const area = this.recordArea(instance, open);
    const key = this.resolveField(
      instance,
      this.fieldNamed(instance, keyName),
      [],
    );
    const wanted = decodeText(key.bytes, key.offset, key.length);
    const keyOffset = key.offset - area.offset;

    const matches = (value: string): boolean => {
      switch (statement.op) {
        case "=":
          return value === wanted;
        case ">":
          return value > wanted;
        case ">=":
          return value >= wanted;
        case "<":
          return value < wanted;
        case "<=":
          return value <= wanted;
        case "<>":
          return value !== wanted;
      }
    };

    // `<` and `<=` position at the *highest* key satisfying the relation, not
    // the lowest. The file is ordered by key, so scanning forward finds the
    // wrong end of the range: `START ... KEY <= "BBB"` over AAA/BBB/CCC left the
    // file on AAA, and the READ NEXT after it returned a record the program had
    // positioned past. `cobc` returns BBB. `<` happened to agree whenever only
    // one record qualified, which is why this survived.
    //
    // Reference: *Enterprise COBOL for z/OS Language Reference*, START
    // statement — the file is positioned at the record with the highest key
    // that satisfies a LESS THAN or LESS THAN OR EQUAL comparison.
    const backwards = statement.op === "<" || statement.op === "<=";
    const keyOf = (record: Uint8Array): string =>
      decodeText(record, keyOffset, key.length);
    let found = -1;
    if (backwards) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (matches(keyOf(records[index]!))) {
          found = index;
          break;
        }
      }
    } else {
      found = records.findIndex((record) => matches(keyOf(record)));
    }
    if (found < 0) {
      this.setStatus(instance, open, "23");
      this.afterIo(instance, open, statement.invalidKey !== null);
      if (statement.invalidKey) {
        this.execute(instance, statement.invalidKey);
      }
      return;
    }
    open.position = found;
    this.setStatus(instance, open, "00");
  }

  /* -------------------------------------------------- references */

  private fieldNamed(instance: Instance, name: string): Field {
    const found = instance.fields.get(name)?.[0];
    if (!found) {
      throw new CobolRuntimeError(
        `${name} is not declared in ${instance.program.name}.`,
      );
    }
    return found;
  }

  private findField(instance: Instance, ref: Reference): Field {
    if (ref.name === "RETURN-CODE") {
      return RETURN_CODE_FIELD;
    }
    if (ref.name === "SORT-RETURN") {
      return SORT_RETURN_FIELD;
    }
    const candidates = instance.fields.get(ref.name);
    if (!candidates || candidates.length === 0) {
      throw new CobolRuntimeError(
        `Line ${String(ref.line)}: ${ref.name} is not declared in ${instance.program.name}.`,
      );
    }
    if (ref.qualifiers.length === 0) {
      if (candidates.length > 1) {
        // Enterprise COBOL rejects an ambiguous reference at compile time, and
        // so does this: picking one would run a different program from the one
        // a compiler would accept.
        throw new CobolRuntimeError(
          `Line ${String(ref.line)}: ${ref.name} is declared ${String(candidates.length)} times and this reference does not say which.`,
        );
      }
      return candidates[0]!;
    }
    const matched = candidates.filter((field) => {
      let at = 0;
      for (const qualifier of ref.qualifiers) {
        const found = field.qualifiers.indexOf(qualifier, at);
        if (found < 0) {
          return false;
        }
        at = found + 1;
      }
      return true;
    });
    if (matched.length !== 1) {
      throw new CobolRuntimeError(
        `Line ${String(ref.line)}: ${ref.name} OF ${ref.qualifiers.join(" OF ")} matches ${String(matched.length)} items.`,
      );
    }
    return matched[0]!;
  }

  private bindingFor(instance: Instance, field: Field): Binding {
    if (field.root === RETURN_CODE_FIELD) {
      return { bytes: this.returnCodeBytes, base: 0 };
    }
    if (field.root === SORT_RETURN_FIELD) {
      return { bytes: this.sortReturnBytes, base: 0 };
    }
    if (field.area === "local") {
      const frame = instance.localFrames[instance.localFrames.length - 1];
      const binding = frame?.get(field.root.name);
      if (!binding) {
        throw new CobolRuntimeError(
          `${field.name} is in LOCAL-STORAGE and there is no active invocation.`,
        );
      }
      return binding;
    }
    const binding = instance.roots.get(field.root.name);
    if (!binding) {
      throw new CobolRuntimeError(
        `${field.root.name} has no storage. A LINKAGE item is only addressable once it has been passed or its address set.`,
      );
    }
    return binding;
  }

  private resolve(instance: Instance, ref: Reference): Location {
    const field = this.findField(instance, ref);
    const location = this.resolveField(instance, field, ref.subscripts);
    if (!ref.refmod) {
      return location;
    }
    const from = Number(
      rescale(this.arithmeticValue(instance, ref.refmod.from), 0).units,
    );
    const length = ref.refmod.length
      ? Number(
          rescale(this.arithmeticValue(instance, ref.refmod.length), 0).units,
        )
      : location.length - from + 1;
    if (from < 1 || length < 0 || from - 1 + length > location.length) {
      throw new CobolRuntimeError(
        `Line ${String(ref.line)}: ${ref.name}(${String(from)}:${String(length)}) reaches outside the item.`,
      );
    }
    return {
      field: location.field,
      bytes: location.bytes,
      offset: location.offset + from - 1,
      length,
    };
  }

  private resolveField(
    instance: Instance,
    field: Field,
    subscripts: Expr[],
  ): Location {
    const binding = this.bindingFor(instance, field);
    return this.locate(instance, field, binding, subscripts);
  }

  /**
   * Where an item sits, following the chain from its record down to it.
   *
   * Subscripts are consumed outermost table first, which is the order COBOL
   * writes them in: `WS-CELL(ROW, COLUMN)`.
   */
  private locate(
    instance: Instance,
    field: Field,
    binding: Binding,
    subscripts: Expr[],
  ): Location {
    const chain: Field[] = [];
    for (let node: Field | null = field; node; node = node.parent) {
      chain.unshift(node);
    }

    let offset = binding.base;
    let subscript = 0;
    for (const node of chain) {
      offset += node.offset;
      if (node.occurs > 1) {
        const expr = subscripts[subscript];
        subscript += 1;
        if (!expr) {
          throw new CobolRuntimeError(
            `${field.name} is inside ${node.name}, which OCCURS ${String(node.occurs)} times, and the reference gives no subscript.`,
          );
        }
        const index = Number(
          rescale(this.arithmeticValue(instance, expr), 0).units,
        );
        if (index < 1 || index > node.occurs) {
          throw new CobolRuntimeError(
            `Subscript ${String(index)} on ${node.name}, which OCCURS ${String(node.occurs)} times.`,
          );
        }
        offset += (index - 1) * node.elementLength;
      }
    }

    return { field, bytes: binding.bytes, offset, length: field.elementLength };
  }

  /* -------------------------------------------------- read and write */

  private readAt(location: Location): Value {
    const { field } = location;
    const picture = field.picture;
    if (
      !picture ||
      picture.category === "alphanumeric" ||
      picture.category === "alphabetic"
    ) {
      return {
        kind: "text",
        value: decodeText(location.bytes, location.offset, location.length),
      };
    }
    if (picture.category === "numeric") {
      return {
        kind: "number",
        picture,
        value: decodeNumeric(
          location.bytes,
          location.offset,
          location.length,
          picture,
          field.usage,
        ),
      };
    }
    return {
      kind: "text",
      value: decodeText(location.bytes, location.offset, location.length),
    };
  }

  private numberAt(location: Location): Decimal {
    return numberOf(this.readAt(location));
  }

  private store(location: Location, value: Value): void {
    const picture = location.field.picture;

    if (
      !picture ||
      picture.category === "alphanumeric" ||
      picture.category === "alphabetic"
    ) {
      encodeText(
        location.bytes,
        location.offset,
        location.length,
        textOf(value),
      );
      return;
    }

    if (picture.category === "numeric") {
      const number = numberOf(value);
      encodeNumeric(
        location.bytes,
        location.offset,
        location.length,
        number,
        picture,
        location.field.usage,
      );
      return;
    }

    // Numeric-edited: the value is formatted, then the characters are stored.
    encodeText(
      location.bytes,
      location.offset,
      location.length,
      edit(numberOf(value), picture),
    );
  }

  /* -------------------------------------------------- expressions */

  private evaluate(instance: Instance, expr: Expr): Value {
    switch (expr.kind) {
      case "ref":
        return this.readAt(this.resolve(instance, expr.ref));
      case "slice":
        return { kind: "text", value: this.sliceText(instance, expr) };
      case "number":
        return { kind: "number", value: decimalOf(expr.text) };
      case "string":
        return { kind: "text", value: expr.value };
      case "figurative":
        return expr.value === "NULL"
          ? { kind: "pointer", bound: false }
          : { kind: "text", value: figurativeText(expr.value) };
      case "address": {
        const field = this.findField(instance, expr.ref);
        return {
          kind: "pointer",
          bound:
            field.area === "local"
              ? (instance.localFrames.at(-1)?.has(field.root.name) ?? false)
              : instance.roots.has(field.root.name),
        };
      }
      case "all":
        // `ALL "-"` fills the receiving item; the receiver's length decides how
        // far, so a long run is produced and truncated on the way in.
        return { kind: "text", value: expr.value.repeat(256) };
      case "unary":
      case "binary":
        return { kind: "number", value: this.arithmeticValue(instance, expr) };
      case "function":
        // The alphanumeric intrinsics return characters, so a `MOVE FUNCTION
        // CHAR(n) TO item` has to produce text rather than be pushed through
        // the arithmetic path — which threw "not implemented" for every one of
        // them, including `TRIM`, outside the DISPLAY and STRING statements
        // that happened to ask for their text directly.
        return TEXT_FUNCTIONS.has(expr.name)
          ? { kind: "text", value: this.displayText(instance, expr) }
          : { kind: "number", value: this.arithmeticValue(instance, expr) };
    }
  }

  private arithmeticValue(instance: Instance, expr: Expr): Decimal {
    switch (expr.kind) {
      case "number":
        return decimalOf(expr.text);
      case "slice":
        return textToNumber(this.sliceText(instance, expr));
      case "ref":
        return this.numberAt(this.resolve(instance, expr.ref));
      case "figurative":
        if (expr.value === "ZEROS") {
          return { units: 0n, scale: 0 };
        }
        throw new CobolRuntimeError(
          `${expr.value} cannot take part in arithmetic.`,
        );
      case "string":
        return textToNumber(expr.value);
      case "all":
        throw new CobolRuntimeError("ALL cannot take part in arithmetic.");
      case "address":
        throw new CobolRuntimeError(
          "A pointer cannot take part in arithmetic.",
        );
      case "unary":
        return expr.op === "-"
          ? negate(this.arithmeticValue(instance, expr.operand))
          : this.arithmeticValue(instance, expr.operand);
      case "binary": {
        const left = this.arithmeticValue(instance, expr.left);
        const right = this.arithmeticValue(instance, expr.right);
        switch (expr.op) {
          case "+":
            return add(left, right);
          case "-":
            return subtract(left, right);
          case "*":
            return multiply(left, right);
          case "/":
            return divide(left, right);
          case "**": {
            const exponent = Number(rescale(right, 0).units);
            if (exponent < 0) {
              throw new CobolUnsupportedError(
                "A negative exponent is not implemented.",
              );
            }
            let result: Decimal = { units: 1n, scale: 0 };
            for (let index = 0; index < exponent; index += 1) {
              result = multiply(result, left);
            }
            return result;
          }
          default:
            throw new CobolUnsupportedError(`Unknown operator ${expr.op}.`);
        }
      }
      case "function":
        return this.intrinsicNumber(instance, expr);
    }
  }

  private intrinsicNumber(
    instance: Instance,
    expr: Extract<Expr, { kind: "function" }>,
  ): Decimal {
    const args = expr.args;
    const number = (index: number): Decimal =>
      this.arithmeticValue(instance, args[index]!);

    switch (expr.name) {
      case "ABS":
      case "ABSOLUTE-VALUE": {
        const value = number(0);
        return value.units < 0n ? negate(value) : value;
      }
      case "MOD": {
        const left = number(0);
        const right = number(1);
        if (right.units === 0n) {
          throw new CobolRuntimeError("FUNCTION MOD by zero.");
        }
        // COBOL's MOD takes the sign of the divisor, which is not what a
        // truncating remainder gives for a negative dividend.
        const quotient = floorDivide(left, right);
        return subtract(left, multiply(quotient, right));
      }
      case "REM": {
        const left = number(0);
        const right = number(1);
        const quotient = rescale(divide(left, right), 0);
        return subtract(left, multiply(quotient, right));
      }
      case "INTEGER":
        return floorScale(number(0));
      case "INTEGER-PART":
        return rescale(number(0), 0);
      case "LENGTH": {
        const first = args[0];
        if (first?.kind !== "ref") {
          throw new CobolUnsupportedError("FUNCTION LENGTH needs an item.");
        }
        return {
          units: BigInt(this.resolve(instance, first.ref).length),
          scale: 0,
        };
      }
      case "NUMVAL":
        return textToNumber(this.displayText(instance, args[0]!));
      // `toNumber` lowers to NUMVAL-C, which is the same reading with a
      // currency string and comma separators allowed in front of the digits.
      case "NUMVAL-C":
        return textToNumber(this.displayText(instance, args[0]!), true);
      /**
       * `ORD` is the position of a character in the collating sequence, and
       * the Language Reference numbers that sequence from 1 — so the ordinal
       * of a byte is the byte plus one, and `CHAR` below is its inverse.
       */
      case "ORD": {
        const text = this.displayText(instance, args[0]!);
        return { units: BigInt((text.charCodeAt(0) || 0) + 1), scale: 0 };
      }
      case "MAX": {
        let best = number(0);
        for (let index = 1; index < args.length; index += 1) {
          const candidate = number(index);
          if (compare(candidate, best) > 0) {
            best = candidate;
          }
        }
        return best;
      }
      case "MIN": {
        let best = number(0);
        for (let index = 1; index < args.length; index += 1) {
          const candidate = number(index);
          if (compare(candidate, best) < 0) {
            best = candidate;
          }
        }
        return best;
      }
      default:
        throw new CobolUnsupportedError(
          `Line ${String(expr.line)}: FUNCTION ${expr.name} is not implemented.`,
        );
    }
  }

  /**
   * `FUNCTION CURRENT-DATE(1:8)` — the characters of a value, sliced.
   *
   * A reference modification of something that is not an item, so there is no
   * storage to point into and the answer is the text. The bounds are checked as
   * `resolve` checks an item's: a slice reaching outside its value is a defect
   * to report, not a shorter answer to return.
   */
  private sliceText(
    instance: Instance,
    expr: Extract<Expr, { kind: "slice" }>,
  ): string {
    const text = this.displayText(instance, expr.value);
    const from = Number(
      rescale(this.arithmeticValue(instance, expr.from), 0).units,
    );
    const length = expr.length
      ? Number(rescale(this.arithmeticValue(instance, expr.length), 0).units)
      : text.length - from + 1;
    if (from < 1 || length < 0 || from - 1 + length > text.length) {
      throw new CobolRuntimeError(
        `(${String(from)}:${String(length)}) reaches outside a value of ${String(text.length)} characters.`,
      );
    }
    return text.slice(from - 1, from - 1 + length);
  }

  /** The characters an item contributes to DISPLAY, STRING or a CALL name. */
  private displayText(instance: Instance, expr: Expr): string {
    if (expr.kind === "slice") {
      return this.sliceText(instance, expr);
    }
    if (expr.kind === "function") {
      switch (expr.name) {
        /**
         * `FUNCTION CURRENT-DATE` — twenty-one characters of clock.
         *
         * `YYYYMMDDhhmmsshh` then the offset from Greenwich as `±hhmm`, which
         * is the Language Reference's layout and the one the backend slices:
         * `today()` takes `(1:8)` and `now()` takes the pieces one at a time.
         *
         * This reads the real clock, so a program that writes the time into an
         * output file is not differentially comparable — the two engines run at
         * different moments. That is a property of such a program rather than a
         * defect here, and it is why `today()`, which reaches only the date, is
         * the form the benchmark tasks use.
         */
        case "CURRENT-DATE": {
          const now = new Date();
          const pad = (value: number, width: number): string =>
            String(value).padStart(width, "0");
          const offset = -now.getTimezoneOffset();
          const sign = offset < 0 ? "-" : "+";
          const size = Math.abs(offset);
          return [
            pad(now.getFullYear(), 4),
            pad(now.getMonth() + 1, 2),
            pad(now.getDate(), 2),
            pad(now.getHours(), 2),
            pad(now.getMinutes(), 2),
            pad(now.getSeconds(), 2),
            pad(Math.floor(now.getMilliseconds() / 10), 2),
            sign,
            pad(Math.floor(size / 60), 2),
            pad(size % 60, 2),
          ].join("");
        }
        case "TRIM":
          return this.displayText(instance, expr.args[0]!).trim();
        case "UPPER-CASE":
          return this.displayText(instance, expr.args[0]!).toUpperCase();
        case "LOWER-CASE":
          return this.displayText(instance, expr.args[0]!).toLowerCase();
        /**
         * The character at a position in the collating sequence, counting from
         * one — the inverse of `ORD`. It yields a character rather than a
         * number, so it belongs here and not with the arithmetic functions.
         */
        case "CHAR": {
          const position = Number(
            rescale(this.arithmeticValue(instance, expr.args[0]!), 0).units,
          );
          return String.fromCharCode(Math.min(255, Math.max(1, position) - 1));
        }
        default:
          break;
      }
    }
    return textOf(this.evaluate(instance, expr));
  }

  /**
   * `IS NUMERIC`, as the Language Reference defines it.
   *
   * > NUMERIC — identifier-1 consists entirely of the characters 0 through 9,
   * > with or without an operational sign. If its PICTURE does not contain an
   * > operational sign, the identifier being tested is determined to be numeric
   * > only if the contents are numeric and an operational sign is not present.
   * > If its PICTURE does contain an operational sign, the identifier being
   * > tested is determined to be numeric only if the item is an elementary
   * > item, the contents are numeric, and a valid operational sign is present.
   *
   * — *Enterprise COBOL for z/OS Language Reference*, "Class condition".
   *
   * This was `/^[0-9]*$/` over the trimmed text, which is wrong in both
   * directions and in the direction that matters. It rejected the `+` on a
   * `SIGN IS LEADING SEPARATE` item — the shape every numeric PARM parameter
   * has — so a program refused a PARM that z/OS would have accepted. Trimming
   * also made an all-blank field test numeric, since the empty string matches:
   * a PARM nobody filled in would pass the check written to catch it and be
   * computed on as zero.
   */
  private isNumeric(
    instance: Instance,
    operand: Expr,
    fallback: string,
  ): boolean {
    const located = this.locationOf(instance, operand);

    // Without a field to consult — a literal, or an expression — the most that
    // can be said is that the characters are digits.
    if (!located) {
      return /^[0-9]+$/.test(fallback);
    }

    // The raw bytes, not the decoded value. `IS NUMERIC` asks whether the
    // characters in the field are digits at all, and decoding has already
    // answered that question its own way: a field holding spaces decodes to
    // zero, so testing the decoded text would report every blank field numeric.
    const { field, bytes, offset, length } = located;
    const text = decodeText(bytes, offset, length);
    const picture = field.picture;

    if (!picture?.signed) {
      return /^[0-9]+$/.test(text);
    }
    if (picture.sign === "leading-separate") {
      return /^[-+][0-9]+$/.test(text);
    }
    if (picture.sign === "trailing-separate") {
      return /^[0-9]+[-+]$/.test(text);
    }
    // An embedded sign is overpunched onto the last digit, so every character
    // but that one is a digit, and that one is either a digit or an overpunch.
    const last = text[text.length - 1];
    return (
      text.length > 0 &&
      /^[0-9]*$/.test(text.slice(0, -1)) &&
      last !== undefined &&
      (/[0-9]/.test(last) || isOverpunched(last))
    );
  }

  /** Where an operand sits, when the operand names a field at all. */
  private locationOf(instance: Instance, operand: Expr): Location | null {
    if (operand.kind !== "ref") {
      return null;
    }
    try {
      return this.resolve(instance, operand.ref);
    } catch {
      return null;
    }
  }

  /* -------------------------------------------------- conditions */

  private test(instance: Instance, condition: Cond): boolean {
    switch (condition.kind) {
      case "not":
        return !this.test(instance, condition.operand);
      case "and":
        return (
          this.test(instance, condition.left) &&
          this.test(instance, condition.right)
        );
      case "or":
        return (
          this.test(instance, condition.left) ||
          this.test(instance, condition.right)
        );
      case "relation":
        return this.relate(
          instance,
          condition.left,
          condition.op,
          condition.right,
        );
      case "condition-name":
        return this.testConditionName(instance, condition.ref);
      case "class": {
        const text = this.displayText(instance, condition.operand);
        return condition.test === "NUMERIC"
          ? this.isNumeric(instance, condition.operand, text)
          : /^[A-Za-z ]*$/.test(text);
      }
      case "sign": {
        const value = this.arithmeticValue(instance, condition.operand);
        if (condition.test === "POSITIVE") {
          return value.units > 0n;
        }
        if (condition.test === "NEGATIVE") {
          return value.units < 0n;
        }
        return value.units === 0n;
      }
    }
  }

  private testConditionName(instance: Instance, ref: Reference): boolean {
    const candidates = instance.conditions.get(ref.name);
    if (!candidates || candidates.length === 0) {
      throw new CobolRuntimeError(
        `Line ${String(ref.line)}: ${ref.name} is not a condition name.`,
      );
    }
    if (candidates.length > 1) {
      throw new CobolRuntimeError(
        `Line ${String(ref.line)}: ${ref.name} is a condition name on ${String(candidates.length)} items.`,
      );
    }
    const { field, condition } = candidates[0]!;
    const location = this.resolveField(instance, field, ref.subscripts);
    const value = this.readAt(location);

    return condition.ranges.some((range) => {
      const from = this.literalValue(range.from);
      if (!range.to) {
        return compareValues(value, from) === 0;
      }
      const to = this.literalValue(range.to);
      return compareValues(value, from) >= 0 && compareValues(value, to) <= 0;
    });
  }

  private relate(
    instance: Instance,
    left: Expr,
    op: RelOp,
    right: Expr,
  ): boolean {
    const a = this.evaluate(instance, left);
    const b = this.evaluate(instance, right);
    const order = compareValues(a, b);
    switch (op) {
      case "=":
        return order === 0;
      case "<>":
        return order !== 0;
      case "<":
        return order < 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      case ">=":
        return order >= 0;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

/** A special register: a binary item every program has and none declares. */
function specialRegister(name: string, picture: Picture): Field {
  const field: Field = {
    name,
    level: 1,
    parent: null,
    children: [],
    picture,
    usage: "binary",
    offset: 0,
    elementLength: 2,
    length: 2,
    occurs: 1,
    redefines: null,
    external: false,
    value: null,
    conditions: [],
    area: "working",
    root: null as unknown as Field,
    qualifiers: [],
  };
  field.root = field;
  return field;
}

/** The synthetic record every program's `RETURN-CODE` lives in. */
const RETURN_CODE_FIELD: Field = specialRegister(
  "RETURN-CODE",
  RETURN_CODE_PICTURE,
);

/** The same, for the register a `SORT` or `MERGE` reports through. */
const SORT_RETURN_FIELD: Field = specialRegister(
  "SORT-RETURN",
  SORT_RETURN_PICTURE,
);

/**
 * A record fitted to a record area: space-padded, or truncated.
 *
 * What a `SORT ... USING` does to a record shorter than the `SD`'s, and what
 * moving it into the fixed record area would do.
 */
function sized(record: Uint8Array, length: number): Uint8Array {
  const fitted = new Uint8Array(length).fill(SPACE);
  fitted.set(record.subarray(0, Math.min(record.length, length)));
  return fitted;
}

/**
 * A record as the file holds it.
 *
 * A LINE SEQUENTIAL file holds text lines, so trailing blanks are not part of
 * the record — GnuCOBOL strips them before the newline, and a file written here
 * has to match one written there byte for byte or the differential test is
 * comparing two different things.
 */
function trimmedForOrganization(open: OpenFile, bytes: Uint8Array): Uint8Array {
  if (open.entry.organization !== "line-sequential") {
    return Uint8Array.from(bytes);
  }
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === SPACE) {
    end -= 1;
  }
  return Uint8Array.from(bytes.subarray(0, end));
}

/**
 * A sort key, read out of a record that is not in the record area.
 *
 * The work file's records are bytes in a list, and `Field.offset` is measured
 * from the start of the record it belongs to — so the same field description
 * reads the key out of any copy of that record.
 */
function keyLocation(field: Field, record: Uint8Array): Location {
  return {
    field,
    bytes: record,
    offset: field.offset,
    length: field.length,
  };
}

function figurativeText(value: string): string {
  switch (value) {
    case "SPACES":
      return " ".repeat(256);
    case "ZEROS":
      return "0".repeat(256);
    case "HIGH-VALUES":
      return "ÿ".repeat(256);
    case "LOW-VALUES":
      return "\u0000".repeat(256);
    default:
      return '"'.repeat(256);
  }
}

function textOf(value: Value): string {
  if (value.kind === "text") {
    return value.value;
  }
  if (value.kind === "pointer") {
    return value.bound ? "POINTER" : "NULL";
  }
  return value.picture
    ? displayItem(value.value, value.picture)
    : displayNumber(value.value);
}

/**
 * A numeric item as `DISPLAY` renders it.
 *
 * Every digit position the picture declares, an explicit decimal point where
 * the picture has an assumed one, and a leading sign when the item is signed.
 * That is what GnuCOBOL writes and what a program printing a total is expected
 * to produce; `tests/cobol-runtime-differential.test.ts` compares the two lines
 * character for character.
 */
function displayItem(value: Decimal, picture: Picture): string {
  const digits = digitsOf(value, picture.digits, picture.scale);
  const whole = digits.slice(0, picture.digits - picture.scale);
  const fraction = digits.slice(picture.digits - picture.scale);
  const sign = picture.signed ? (value.units < 0n ? "-" : "+") : "";
  return `${sign}${whole}${picture.scale > 0 ? `.${fraction}` : ""}`;
}

/**
 * A number as `DISPLAY` shows it.
 *
 * The generated programs display literals and `PIC X` items only, so this is
 * exercised by the reference runtime rather than by the corpus. The digits are
 * shown without the assumed decimal point, which is what an unedited numeric
 * item holds; a program that wants a point moves the value to an edited item
 * first, which is exactly what `runtime/BANKLEDG.cbl` does.
 */
function displayNumber(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString();
  return `${negative ? "-" : ""}${digits}`;
}

/**
 * `FUNCTION NUMVAL` and `FUNCTION NUMVAL-C`, which read a number out of text.
 *
 * `toNumber` lowers to NUMVAL-C, so this is on the path of every BankTS program
 * that parses a field, and it had no implementation here at all — the
 * interpreter refused the statement and the differential comparison silently
 * did not happen. The verb-level coverage matrix could not see it, because a
 * missing intrinsic is not a missing verb.
 *
 * The Language Reference gives both functions the same argument format apart
 * from two things NUMVAL-C also allows: a currency string in front of the
 * digits, and commas separating them. Both accept a leading sign, and a
 * trailing `+`, `-`, `CR` or `DB`. Anything else still raises: a character item
 * used as a number is not something a COBOL compiler would accept, and guessing
 * here would hide a program this interpreter should have refused.
 */
function textToNumber(text: string, currency = false): Decimal {
  let rest = text.trim();
  if (rest === "") {
    return { units: 0n, scale: 0 };
  }

  let negative = false;
  const leading = /^([+-])\s*/.exec(rest);
  if (leading) {
    negative = leading[1] === "-";
    rest = rest.slice(leading[0].length);
  }

  if (currency) {
    // The currency string is whatever precedes the digits, which is how the
    // Language Reference describes it: `$`, `USD`, `£` are all one shape.
    rest = rest.replace(/^[^\d.,]+/, "").trimStart();
  }

  const trailing = /\s*(CR|DB|[+-])$/i.exec(rest);
  if (trailing) {
    const mark = (trailing[1] as string).toUpperCase();
    if (leading) {
      throw new CobolRuntimeError(
        `${JSON.stringify(text)} carries a sign at both ends.`,
      );
    }
    negative = mark !== "+";
    rest = rest.slice(0, rest.length - trailing[0].length);
  }

  if (currency) {
    rest = rest.split(",").join("");
  }
  rest = rest.trim();

  if (rest === "" || !/^\d*(?:\.\d*)?$/.test(rest)) {
    throw new CobolRuntimeError(`${JSON.stringify(text)} is not numeric.`);
  }

  const value = decimalOf(rest.startsWith(".") ? `0${rest}` : rest);
  return negative ? negate(value) : value;
}

function compareValues(left: Value, right: Value): number {
  if (left.kind === "pointer" || right.kind === "pointer") {
    const a = left.kind === "pointer" ? left.bound : true;
    const b = right.kind === "pointer" ? right.bound : true;
    return a === b ? 0 : 1;
  }
  if (left.kind === "number" && right.kind === "number") {
    return compare(left.value, right.value);
  }
  // A comparison with one numeric side compares numerically when the other side
  // is a numeric literal, and as characters otherwise. The generated code only
  // ever does the second: `IF BANK-FAILURE-CODE NOT = SPACES`.
  if (left.kind === "number" || right.kind === "number") {
    const a = left.kind === "number" ? left.value : tryNumber(left.value);
    const b = right.kind === "number" ? right.value : tryNumber(right.value);
    if (a && b) {
      return compare(a, b);
    }
  }
  const a = textOf(left);
  const b = textOf(right);
  const width = Math.max(a.length, b.length);
  const padded = a.padEnd(width, " ");
  const other = b.padEnd(width, " ");
  return padded < other ? -1 : padded > other ? 1 : 0;
}

function tryNumber(text: string): Decimal | null {
  const trimmed = text.trim();
  return /^[+-]?\d*(?:\.\d+)?$/.test(trimmed) && trimmed !== ""
    ? decimalOf(trimmed)
    : null;
}

/** `ROUNDED`, which in Enterprise COBOL is half-up away from zero. */
function roundHalfUp(value: Decimal, scale: number): Decimal {
  if (value.scale <= scale) {
    return rescale(value, scale);
  }
  const shift = value.scale - scale;
  let divisor = 1n;
  for (let index = 0; index < shift; index += 1) {
    divisor *= 10n;
  }
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return { units: negative ? -rounded : rounded, scale };
}

function floorDivide(left: Decimal, right: Decimal): Decimal {
  const quotient = divide(left, right);
  return floorScale(quotient);
}

/** The greatest integer not above the value, which is what `INTEGER` returns. */
function floorScale(value: Decimal): Decimal {
  const truncated = rescale(value, 0);
  if (value.units >= 0n || compare(truncated, value) === 0) {
    return truncated;
  }
  return { units: truncated.units - 1n, scale: 0 };
}

/** How many occurrences a field has, counting every table it sits inside. */
function occurrencesOf(field: Field): number {
  let total = 1;
  for (let node: Field | null = field; node; node = node.parent) {
    total *= node.occurs;
  }
  return total;
}

/** Occurrences of the tables nested below `node`, which is its stride. */
function occurrencesBelow(chain: Field[], node: Field): number {
  let total = 1;
  let seen = false;
  for (const item of chain) {
    if (item === node) {
      seen = true;
      continue;
    }
    if (seen) {
      total *= item.occurs;
    }
  }
  return total;
}

function numberOf(value: Value): Decimal {
  if (value.kind === "number") {
    return value.value;
  }
  if (value.kind === "pointer") {
    throw new CobolRuntimeError("A pointer is not a number.");
  }
  return textToNumber(value.value);
}
