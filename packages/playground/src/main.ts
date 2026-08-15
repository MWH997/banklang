import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";

import {
  compile,
  type CompileResult,
  type SourceMapEntry,
} from "../../compiler/src/index";
import { explainDiagnostic } from "../../diagnostics/src/index";
import { CompilerInvariant } from "../../diagnostics/src/errors";
import { formatBankTs } from "../../formatter/src/index";
import { bankts } from "./bankts-language";
import { cobol as cobolLanguage } from "./cobol-language";
import { ALL_EXAMPLES, EXAMPLES } from "./examples";
import { escapeHtml, statChip } from "./html";
import {
  encodeInputs,
  inputsFor,
  parmText,
  cursorRowsOf,
  type InputSurface,
  type ProgramInputs,
} from "./inputs";
import type { RunOutcome } from "./run";
import "./styles.css";

type TabId =
  | "cobol"
  | "input"
  | "run"
  | "copybook"
  | "diagnostics"
  | "sourcemap"
  | "analysis";

/* ------------------------------------------------------------------ *
 * Cross-highlighting between BankTS source and generated COBOL.
 *
 * This is the point of the playground: the source map is not a claim in a
 * document, it is a link you can click.
 * ------------------------------------------------------------------ */

const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

const highlightMark = Decoration.line({ class: "cm-linked-line" });

function highlightField() {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      value = value.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (!effect.is(setHighlight)) {
          continue;
        }
        if (effect.value === null) {
          return Decoration.none;
        }
        const builder = [];
        const doc = transaction.state.doc;
        const from = Math.max(1, effect.value.from);
        const to = Math.min(doc.lines, effect.value.to);
        for (let line = from; line <= to; line += 1) {
          builder.push(highlightMark.range(doc.line(line).from));
        }
        return Decoration.set(builder);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function highlightLines(
  view: EditorView | null,
  range: { from: number; to: number } | null,
  scroll: boolean,
): void {
  if (!view) {
    return;
  }
  view.dispatch({ effects: setHighlight.of(range) });
  if (range && scroll && range.from <= view.state.doc.lines) {
    const line = view.state.doc.line(Math.max(1, range.from));
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * DOM wiring
 * ------------------------------------------------------------------ */

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new CompilerInvariant(`Missing element: ${selector}`);
  }
  return element;
};

let sourceView: EditorView | null = null;
let outputView: EditorView | null = null;
let latest: CompileResult | null = null;
let activeTab: TabId = "cobol";
let activeCopybook = 0;

/**
 * What the Input tab is holding, and the shape it was built for.
 *
 * Rebuilt when the program's input surfaces change — a renamed record, a file
 * added — and kept across every other recompilation, because a panel that
 * resets on each keystroke is one nobody can type into.
 */
let inputs: ProgramInputs | null = null;
let inputShape = "";

const readonlyLanguage = new Compartment();

/**
 * What a screen reader is told these two boxes are.
 *
 * CodeMirror renders its editable area as `role="textbox"` with no name at
 * all, so both of them announced as "text box" — F15, WCAG 4.1.2, on the
 * product's primary interactive surface and on the pane holding the output the
 * whole page exists to show. `contentAttributes` is where a name goes: it is
 * put on the contenteditable element itself rather than on a wrapper, which is
 * the element with the role.
 *
 * The output editor's name says it is read only as well as what it holds,
 * because a text box that refuses every keystroke and does not say why is the
 * more confusing of the two.
 */
function makeSourceEditor(parent: HTMLElement, doc: string): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bankts,
        highlightField(),
        EditorView.contentAttributes.of({ "aria-label": "BankTS source" }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            scheduleCompile();
          }
          if (update.selectionSet) {
            linkFromSource();
          }
        }),
      ],
    }),
  });
}

function makeOutputEditor(parent: HTMLElement): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        readonlyLanguage.of([]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightField(),
        EditorView.contentAttributes.of({
          "aria-label": "Generated COBOL, read only",
        }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            linkFromOutput();
          }
        }),
      ],
    }),
  });
}

/* ------------------------------------------------------------------ *
 * Compile loop
 * ------------------------------------------------------------------ */

let compileTimer: number | undefined;

function scheduleCompile(): void {
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(runCompile, 150);
}

function runCompile(): void {
  if (!sourceView) {
    return;
  }
  const source = sourceView.state.doc.toString();
  const started = performance.now();
  latest = compile(source, { sourceFile: "playground.bank.ts", emitJcl: true });
  const elapsed = performance.now() - started;

  persistToUrl(source);
  renderStatus(latest, elapsed);
  renderTabs(latest);
  renderOutput();

  // Line numbers shift on every edit, so a stale trace would point at the
  // wrong place in the new output.
  setTrace(null);
  highlightLines(outputView, null, false);
  highlightLines(sourceView, null, false);
}

function renderStatus(result: CompileResult, elapsed: number): void {
  const status = $("#status");
  const errors = result.diagnostics.length;
  status.className = errors > 0 ? "status status--error" : "status status--ok";
  status.textContent =
    errors > 0
      ? `${errors} diagnostic${errors === 1 ? "" : "s"} · ${elapsed.toFixed(1)} ms`
      : `Compiled cleanly · ${elapsed.toFixed(1)} ms`;

  const summary = $("#summary");
  const analysis = result.analysis;
  summary.innerHTML = analysis
    ? [
        statChip("record", analysis.recordCount),
        statChip("function", analysis.functionCount),
        statChip("transaction", analysis.transactionCount),
        statChip("posting", analysis.ledgerPostingCount),
        statChip("audit event", analysis.auditEventCount),
        statChip("file", analysis.fileCount),
      ].join("")
    : "";
}

function renderTabs(result: CompileResult): void {
  const count = result.diagnostics.length;
  const badge = $("#tab-diagnostics-count");
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = count === 0;

  const picker = $<HTMLSelectElement>("#copybook-picker");
  picker.innerHTML = result.copybooks
    .map(
      (book, index) =>
        `<option value="${index}">${escapeHtml(book.fileName)}</option>`,
    )
    .join("");
  picker.hidden = result.copybooks.length < 2;
  if (activeCopybook >= result.copybooks.length) {
    activeCopybook = 0;
  }
}

function renderOutput(): void {
  if (!latest || !outputView) {
    return;
  }

  $("#copybook-picker").hidden =
    activeTab !== "copybook" || latest.copybooks.length < 2;

  const diagnosticsPane = $("#diagnostics");
  const runPane = $("#run");
  const inputPane = $("#input");
  const editorPane = $("#output-editor");

  diagnosticsPane.hidden = activeTab !== "diagnostics";
  runPane.hidden = activeTab !== "run";
  inputPane.hidden = activeTab !== "input";
  editorPane.hidden = !["cobol", "copybook", "sourcemap", "analysis"].includes(
    activeTab,
  );

  if (activeTab === "diagnostics") {
    renderDiagnostics(latest);
    return;
  }
  if (activeTab === "input") {
    renderInput(latest);
    return;
  }
  if (activeTab === "run") {
    renderRun(latest);
    return;
  }

  const text = outputTextFor(activeTab, latest);
  // COBOL and a copybook are COBOL; a source map and an analysis are JSON.
  // Reconfiguring the compartment rather than leaving it empty is what gives
  // the output pane the highlighting every other page of the site already has.
  outputView.dispatch({
    changes: { from: 0, to: outputView.state.doc.length, insert: text },
    effects: readonlyLanguage.reconfigure(
      activeTab === "cobol" || activeTab === "copybook" ? [cobolLanguage] : [],
    ),
  });
}

/* ------------------------------------------------------------------ *
 * What the program is given.
 *
 * B2, closing the 2026-08-07 audit's F4. Every run used to start from
 * zero-initialised storage, so `account-posting` — the example whose subject is
 * a balanced transfer — posted 0.00 against 0.00 on the feature sold as "read
 * the postings it made". This is the job around the program: the record a
 * caller would have filled, the dataset a step would have allocated, the PARM
 * on the EXEC card.
 * ------------------------------------------------------------------ */

/** The PARM the panel currently holds, as the characters a step passes. */
function parmOf(program: ProgramInputs | null): string | undefined {
  const surface = program?.surfaces.find((each) => each.kind === "parm");
  return surface ? parmText(surface) : undefined;
}

/** The surfaces a program has, as a string, so a change to them is visible. */
function shapeOf(program: ProgramInputs): string {
  return program.surfaces
    .map(
      (surface) =>
        `${surface.kind}:${surface.name}:${surface.fields.map((field) => field.name).join(",")}`,
    )
    .join("|");
}

/** The panel's current state, rebuilt only when the program's shape changes. */
function currentInputs(result: CompileResult): ProgramInputs | null {
  if (!result.program || !result.layout) {
    return null;
  }
  const fresh = inputsFor(result.program, result.layout);
  const shape = shapeOf(fresh);
  if (!inputs || shape !== inputShape) {
    inputs = fresh;
    inputShape = shape;
  }
  return inputs;
}

function renderInput(result: CompileResult): void {
  const pane = $("#input");
  const program = currentInputs(result);

  if (!program) {
    pane.innerHTML = `<div class="empty"><strong>Nothing to fill in.</strong><p>The compiler produced no program. Open the Diagnostics tab to see why.</p></div>`;
    return;
  }

  if (program.surfaces.length === 0) {
    pane.innerHTML = `
      <div class="empty">
        <strong>This program takes no input.</strong>
        <p>${escapeHtml(program.reason ?? "")}</p>
      </div>`;
    return;
  }

  pane.innerHTML = `
    <p class="run__inputs">
      <b>This is the job around the program.</b> On z/OS a step allocates the
      datasets, the initiator passes the PARM, and a caller fills the record.
      Here you do. Everything below is written at the offsets the copybook
      reports, in the encoding it reports, packed decimal included.
    </p>
    ${program.surfaces.map(surfaceHtml).join("")}`;

  for (const field of pane.querySelectorAll<HTMLInputElement>(
    "input[data-surface]",
  )) {
    field.addEventListener("input", () => {
      const surface = program.surfaces[Number(field.dataset.surface)];
      const record = surface?.records[Number(field.dataset.record)];
      if (record) {
        record[field.dataset.field ?? ""] = field.value;
        // The program has to run again: the value it was run on has changed.
        lastRun = null;
      }
    });
  }
}

function surfaceHtml(surface: InputSurface, index: number): string {
  const title =
    surface.kind === "entry"
      ? `Entry record: <code>${escapeHtml(surface.name)}</code>`
      : surface.kind === "parm"
        ? "PARM"
        : surface.kind === "sql"
          ? `Db2 rows for <code>${escapeHtml(surface.name)}</code>`
          : `Dataset <code>${escapeHtml(surface.name)}</code>`;

  return `
    <section class="run__block input__surface">
      <h3>${title}</h3>
      <p class="input__note">${escapeHtml(surface.note)}</p>
      ${surface.records
        .map(
          (record, row) => `
        <div class="input__record">
          ${
            surface.records.length > 1
              ? `<span class="input__row">Record ${String(row + 1)}</span>`
              : ""
          }
          ${surface.fields
            .map((field) => {
              const id = `in-${String(index)}-${String(row)}-${field.name}`;
              return `
              <label class="input__field" for="${id}">
                <span class="input__name">${escapeHtml(field.name)}${
                  field.sensitive
                    ? ' <b class="input__sensitive">sensitive</b>'
                    : ""
                }</span>
                <input id="${id}" type="text" value="${escapeHtml(record[field.name] ?? "")}"
                  data-surface="${String(index)}" data-record="${String(row)}"
                  data-field="${escapeHtml(field.name)}" />
                <span class="input__picture">${escapeHtml(field.picture)}</span>
              </label>`;
            })
            .join("")}
        </div>`,
        )
        .join("")}
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Running the program.
 *
 * The COBOL in the pane beside this, executed. Nothing here is a summary of
 * what the compiler thinks it emitted: the ledger balances come from
 * `runtime/BANKLEDG.cbl` doing the arithmetic, the audit lines come from
 * `runtime/BANKAUDT.cbl`, and both are the same files CI compiles and links.
 * ------------------------------------------------------------------ */

let lastRun: { cobol: string; outcome: RunOutcome } | null = null;

/**
 * The interpreter and the reference runtime, fetched when Run is first opened.
 *
 * D4's other half. `./run` pulls in `@banklang/cobol-runtime`, the precompiler
 * and eight `runtime/*.cbl` files as text, and every one of them was in the
 * first download — including for a reader who opens the page, looks at the
 * COBOL, and leaves. None of it is needed until somebody asks for a run, and
 * `renderRun` is the only thing that asks.
 *
 * The module is cached by the browser's own module registry, so the second
 * `import()` is a resolved promise rather than a second fetch. Held in a
 * variable as well, so the first one is not started twice by two quick clicks.
 */
let runtimeModule: Promise<typeof import("./run")> | null = null;

function loadRuntime(): Promise<typeof import("./run")> {
  runtimeModule ??= import("./run");
  return runtimeModule;
}

function renderRun(result: CompileResult): void {
  const pane = $("#run");

  if (!result.cobol) {
    pane.innerHTML = `<div class="empty"><strong>Nothing to run.</strong><p>The compiler produced no program. Open the Diagnostics tab to see why.</p></div>`;
    return;
  }

  // Cached on the COBOL rather than on the source, so an edit that changes no
  // generated byte does not re-run the program. Editing the Input tab clears
  // the cache, because the same COBOL on different input is a different run.
  if (lastRun?.cobol === result.cobol) {
    paintRun(result, lastRun.outcome, pane);
    return;
  }

  const cobol = result.cobol;
  pane.innerHTML = `<div class="empty"><strong>Running…</strong><p>Loading the reference runtime.</p></div>`;

  void loadRuntime().then(({ run: runProgram }) => {
    const program = currentInputs(result);
    const given =
      program && result.program && result.layout
        ? {
            ...encodeInputs(program.surfaces, result.layout, result.program),
            cursorRows: cursorRowsOf(
              program.surfaces,
              result.layout,
              result.program,
            ),
          }
        : { storage: undefined, files: undefined, cursorRows: undefined };
    lastRun = {
      cobol,
      outcome: runProgram(cobol, { ...given, parm: parmOf(program) }),
    };
    // The reader may have moved on while the chunk was in flight, and a later
    // edit may have recompiled. Painting either would put one program's output
    // under another program's tab.
    if (activeTab === "run" && latest?.cobol === cobol) {
      paintRun(result, lastRun.outcome, pane);
    }
  });
}

function paintRun(
  result: CompileResult,
  outcome: RunOutcome,
  pane: HTMLElement,
): void {
  const program = currentInputs(result);

  if (!outcome.ok) {
    pane.innerHTML = `
      <div class="run__refusal">
        <strong>This program was not run.</strong>
        <p>${escapeHtml(outcome.refusal ?? "")}</p>
      </div>
      ${runFootnote()}`;
    return;
  }

  const sections: string[] = [];

  // Said before the results rather than after them, because the numbers below
  // are only as meaningful as what the program was given, and a reader who has
  // not opened the Input tab has no way to know what that was.
  const supplied = program?.surfaces ?? [];
  sections.push(
    supplied.length > 0
      ? `
    <p class="run__inputs">
      <b>Run on what the Input tab holds:</b>
      ${supplied
        .map(
          (surface) =>
            `<code>${escapeHtml(surface.name)}</code>${
              surface.kind === "dataset"
                ? ` (${String(surface.records.length)} records)`
                : surface.kind === "sql"
                  ? ` (${String(surface.records.length)} rows)`
                  : ""
            }`,
        )
        .join(", ")}. Change any of it there and this runs again.
    </p>`
      : `
    <p class="run__inputs">
      <b>Nothing was supplied as input.</b> ${escapeHtml(program?.reason ?? "")}
      The amounts below are what this program does with empty storage: real
      arithmetic on real storage, and not a worked example.
    </p>`,
  );

  if (outcome.missingInputs.length > 0) {
    sections.push(`
      <p class="run__inputs">
        <b>No input dataset either.</b> This program opens
        ${outcome.missingInputs.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")},
        and there is nothing behind ${outcome.missingInputs.length === 1 ? "it" : "them"} here.
        The <code>OPEN</code> returns file status 35 and what you are seeing
        below is the failure path, which is a path worth reading, and the one
        an unchecked <code>OPEN</code> would have skipped silently.
      </p>`);
  }

  sections.push(`
    <p class="run__verdict ${outcome.returnCode === 0 ? "run__verdict--ok" : "run__verdict--fail"}">
      <b>RETURN-CODE ${String(outcome.returnCode)}</b>
      ${outcome.returnCode === 0 ? "The work completed." : "The program named a failure."}
      <span class="run__cost">${String(outcome.steps)} statements · ${outcome.milliseconds.toFixed(1)} ms</span>
    </p>`);

  sections.push(
    block("SYSOUT", outcome.sysout, "The program displayed nothing.", (line) =>
      escapeHtml(line),
    ),
  );

  if (outcome.balances.length > 0) {
    sections.push(`
      <section class="run__block">
        <h3>Closing balances</h3>
        <table class="run__balances">
          <thead><tr><th scope="col">Account</th><th scope="col">Balance</th></tr></thead>
          <tbody>
            ${outcome.balances
              .map(
                ([account, balance]) =>
                  `<tr><td>${escapeHtml(account || "(unset)")}</td><td>${escapeHtml(balance)}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </section>`);
  }

  sections.push(
    block("Ledger journal", outcome.journal, "No posting was made.", (line) =>
      escapeHtml(line),
    ),
  );
  sections.push(
    block("Audit log", outcome.audit, "No audit event was emitted.", (line) =>
      escapeHtml(line),
    ),
  );

  for (const dataset of outcome.datasets) {
    sections.push(
      block(
        `Dataset ${dataset.name}`,
        dataset.records,
        "Written empty.",
        (line) => escapeHtml(line),
      ),
    );
  }

  pane.innerHTML = sections.join("") + runFootnote();
}

function block(
  title: string,
  lines: string[],
  empty: string,
  render: (line: string) => string,
): string {
  return `
    <section class="run__block">
      <h3>${escapeHtml(title)}</h3>
      ${
        lines.length === 0
          ? `<p class="run__empty">${escapeHtml(empty)}</p>`
          : `<pre class="run__lines">${lines.map(render).join("\n")}</pre>`
      }
    </section>`;
}

/**
 * What this run is, said every time rather than once at the top.
 *
 * A reader who scrolls to the balances and stops has to meet it there. The
 * whole project turns on never letting a local result read as a claim about
 * IBM's compiler.
 */
function runFootnote(): string {
  return `
    <p class="run__note">
      Executed by an interpreter written for this compiler's output, running in
      this tab. It is not GnuCOBOL and it is not IBM Enterprise COBOL. Every
      example here is also compiled by GnuCOBOL in CI and run against the same
      <code>runtime/</code> programs, and a test fails on any disagreement
      between the two.
    </p>`;
}

function outputTextFor(tab: TabId, result: CompileResult): string {
  switch (tab) {
    case "cobol":
      return result.cobol ?? placeholder(result, "COBOL");
    case "copybook":
      return (
        result.copybooks[activeCopybook]?.content ??
        placeholder(result, "copybook")
      );
    case "sourcemap":
      return result.sourceMap
        ? JSON.stringify(result.sourceMap, null, 2)
        : placeholder(result, "source map");
    case "analysis":
      return result.program
        ? JSON.stringify(
            {
              summary: result.analysis,
              coverage: {
                expectedSymbols: result.coverage?.expectedSymbolCount,
                tracedSymbols: result.coverage?.coveredSymbolCount,
                gaps: result.coverage?.diagnostics.length ?? 0,
              },
              layout: result.layout?.reports,
              jcl: result.jcl?.split("\n"),
            },
            null,
            2,
          )
        : placeholder(result, "analysis");
    default:
      return "";
  }
}

function placeholder(result: CompileResult, artifact: string): string {
  return result.diagnostics.length > 0
    ? `*> No ${artifact} was emitted.\n*> The compiler stopped at ${result.diagnostics[0]!.id}.\n*> Open the Diagnostics tab for details.`
    : `*> No ${artifact} for this program.`;
}

function renderDiagnostics(result: CompileResult): void {
  const pane = $("#diagnostics");
  if (result.diagnostics.length === 0) {
    pane.innerHTML = `<div class="empty"><strong>No diagnostics.</strong><p>Parsing, type checking, banking safety analysis, and source map coverage all passed.</p></div>`;
    return;
  }

  pane.innerHTML =
    result.diagnostics
      .map((diagnostic) => {
        const span = diagnostic.span;
        const where = span
          ? `line ${span.start.line}, column ${span.start.column}`
          : "no location";
        const doc = explainDiagnostic(diagnostic.id);
        return `
        <article class="diag" data-line="${span?.start.line ?? ""}" data-end="${span?.end.line ?? ""}">
          <header>
            <code class="diag__id">${escapeHtml(diagnostic.id)}</code>
            <span class="diag__sev diag__sev--${escapeHtml(diagnostic.severity)}">${escapeHtml(diagnostic.severity)}</span>
            <span class="diag__where">${escapeHtml(where)}</span>
          </header>
          <p class="diag__msg">${escapeHtml(diagnostic.message)}</p>
          ${diagnostic.hint ? `<p class="diag__hint">${escapeHtml(diagnostic.hint)}</p>` : ""}
          ${
            doc
              ? `<details class="diag__why">
                   <summary>Why this rule exists</summary>
                   <p>${escapeHtml(doc.explanation)}</p>
                   ${doc.specReference ? `<p class="diag__spec">Specified by <code>docs/${escapeHtml(doc.specReference)}</code></p>` : ""}
                 </details>`
              : ""
          }
        </article>`;
      })
      .join("") +
    // The full catalogue, linked from the pane that shows a diagnostic rather
    // than from the site navigation: a reader looking at `BANK-LED-001` wants
    // the entry for it, and that is the only place this link is worth having.
    `<p class="diag__more">
       <a href="/docs/diagnostics.html">Every diagnostic, with its rule and remediation →</a>
     </p>`;

  for (const node of pane.querySelectorAll<HTMLElement>(".diag")) {
    node.addEventListener("click", () => {
      const from = Number(node.dataset.line);
      const to = Number(node.dataset.end || node.dataset.line);
      if (Number.isFinite(from) && from > 0) {
        highlightLines(sourceView, { from, to }, true);
        sourceView?.focus();
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Source map linking
 * ------------------------------------------------------------------ */

function entriesFor(result: CompileResult | null): SourceMapEntry[] {
  return result?.sourceMap?.entries ?? [];
}

/** Editor cursor moved: highlight the COBOL that BankTS line produced. */
function linkFromSource(): void {
  if (!sourceView || !latest || activeTab !== "cobol") {
    return;
  }
  const line = sourceView.state.doc.lineAt(
    sourceView.state.selection.main.head,
  ).number;

  const match = smallestEntry(
    entriesFor(latest).filter(
      (entry) => entry.sourceStart.line <= line && line <= entry.sourceEnd.line,
    ),
    (entry) => entry.sourceEnd.line - entry.sourceStart.line,
  );

  highlightLines(
    outputView,
    match ? { from: match.targetStartLine, to: match.targetEndLine } : null,
    Boolean(match),
  );
  setTrace(match);
}

/** COBOL cursor moved: highlight the BankTS that produced that line. */
function linkFromOutput(): void {
  if (!outputView || !latest || activeTab !== "cobol") {
    return;
  }
  const line = outputView.state.doc.lineAt(
    outputView.state.selection.main.head,
  ).number;

  const match = smallestEntry(
    entriesFor(latest).filter(
      (entry) => entry.targetStartLine <= line && line <= entry.targetEndLine,
    ),
    (entry) => entry.targetEndLine - entry.targetStartLine,
  );

  highlightLines(
    sourceView,
    match ? { from: match.sourceStart.line, to: match.sourceEnd.line } : null,
    Boolean(match),
  );
  setTrace(match);
}

function smallestEntry(
  entries: SourceMapEntry[],
  size: (entry: SourceMapEntry) => number,
): SourceMapEntry | null {
  let best: SourceMapEntry | null = null;
  for (const entry of entries) {
    if (!best || size(entry) < size(best)) {
      best = entry;
    }
  }
  return best;
}

function setTrace(entry: SourceMapEntry | null): void {
  const trace = $("#trace");
  if (!entry) {
    trace.textContent =
      "Click a line in either pane to trace it through the source map.";
    trace.classList.remove("trace--active");
    return;
  }
  trace.innerHTML = `<b>${escapeHtml(entry.category)}</b> <code>${escapeHtml(entry.symbol)}</code> · BankTS ${entry.sourceStart.line}–${entry.sourceEnd.line} → COBOL ${entry.targetStartLine}–${entry.targetEndLine}`;
  trace.classList.add("trace--active");
}

/* ------------------------------------------------------------------ *
 * Sharing and boot
 * ------------------------------------------------------------------ */

/**
 * The hash format a shared link carries, and the reason it has a number.
 *
 * A link is a promise that the page will show what the sender saw. BankTS is
 * pre-1.0 and its syntax may change, so a link written today can be a program
 * that no longer parses — and the failure mode worth avoiding is not an error,
 * it is the *silent* one: the same characters compiling to something else, or
 * decoding into a mangled program that the reader assumes is what was sent.
 *
 * The version is checked before the payload is trusted. `v1` is base64 of the
 * UTF-8 source. Anything else is refused with a message that says so rather
 * than being fed to `atob` to see what happens.
 */
const HASH_VERSION = 1;

interface SharedLink {
  source: string | null;
  /** An example to open by name, from a deep link in the documentation. */
  example: string | null;
  /** Set when a link was present and could not be honoured. */
  problem: string | null;
}

function encodeSource(source: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(source)));
}

/** The URL a reader can send somebody, for the program in the editor now. */
function shareUrl(source: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#v${String(HASH_VERSION)}=${encodeURIComponent(encodeSource(source))}`;
}

function persistToUrl(source: string): void {
  try {
    window.history.replaceState(
      null,
      "",
      `#v${String(HASH_VERSION)}=${encodeURIComponent(encodeSource(source))}`,
    );
  } catch {
    /* Sharing is a convenience; never let it break the editor. */
  }
}

function readUrl(): SharedLink {
  const empty: SharedLink = { source: null, example: null, problem: null };
  const hash = window.location.hash;
  if (!hash || hash === "#") {
    return empty;
  }

  // A deep link from the documentation names an example rather than carrying
  // one, so a page that links to `interest-posting-batch` keeps working when
  // the example is edited. A slash is allowed because a job of several programs
  // is keyed by both parts: `end-of-day-settlement/extract`.
  const named = /^#example=([\w/-]+)$/.exec(hash);
  if (named) {
    return { ...empty, example: named[1] ?? null };
  }

  const versioned = /^#v(\d+)=(.+)$/.exec(hash);
  if (!versioned) {
    return {
      ...empty,
      problem:
        "That link is not one this playground wrote. Pick an example to start from.",
    };
  }

  const version = Number(versioned[1]);
  if (version !== HASH_VERSION) {
    return {
      ...empty,
      problem: `That link was written for version ${versioned[1] ?? "?"} of the share format and this playground reads version ${String(HASH_VERSION)}. The program it carries may no longer mean what it did, so it has not been loaded.`,
    };
  }

  try {
    const binary = atob(decodeURIComponent(versioned[2] ?? ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return { ...empty, source: new TextDecoder().decode(bytes) };
  } catch {
    return {
      ...empty,
      problem: "That link is damaged and its program could not be read.",
    };
  }
}

function boot(): void {
  const picker = $<HTMLSelectElement>("#example-picker");
  picker.innerHTML = ALL_EXAMPLES.map(
    (example) =>
      `<option value="${example.id}">${escapeHtml(example.title)}</option>`,
  ).join("");

  const link = readUrl();

  // A deep link naming an example opens that example, and says so in the
  // picker — otherwise the reader arrives at a program the picker claims is a
  // different one.
  const named = link.example
    ? ALL_EXAMPLES.find((item) => item.id === link.example)
    : undefined;
  if (named) {
    picker.value = named.id;
  }

  const initial =
    link.source ?? named?.source ?? EXAMPLES[0]?.source ?? "module Empty;\n";
  sourceView = makeSourceEditor($("#source-editor"), initial);
  outputView = makeOutputEditor($("#output-editor"));

  if (link.problem) {
    const notice = $("#link-problem");
    notice.textContent = link.problem;
    notice.hidden = false;
  }
  if (link.example && !named) {
    const notice = $("#link-problem");
    notice.textContent = `There is no example called "${link.example}" in this playground.`;
    notice.hidden = false;
  }

  picker.addEventListener("change", () => {
    const example = ALL_EXAMPLES.find((item) => item.id === picker.value);
    if (!example || !sourceView) {
      return;
    }
    $("#example-blurb").textContent = example.blurb;
    sourceView.dispatch({
      changes: {
        from: 0,
        to: sourceView.state.doc.length,
        insert: example.source,
      },
    });
  });
  // The blurb belongs to whatever the picker is showing. Setting it to the
  // first example unconditionally described the wrong program whenever a deep
  // link had already selected another one.
  $("#example-blurb").textContent = (named ?? ALL_EXAMPLES[0])?.blurb ?? "";

  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];

  /**
   * Select a tab, in the class the styling reads and the state a screen reader
   * reads. `role="tablist"` without `aria-selected` announces a tablist and
   * then cannot say which tab is current, which is worse than no role at all.
   */
  const selectTab = (button: HTMLButtonElement): void => {
    activeTab = button.dataset.tab as TabId;
    for (const other of tabs) {
      const current = other === button;
      other.classList.toggle("tab--active", current);
      other.setAttribute("aria-selected", String(current));
      // Roving tabindex: one stop for the whole strip, then arrow keys within
      // it. Five tabs each taking a Tab press is five presses to reach the
      // output.
      other.tabIndex = current ? 0 : -1;
    }
    renderOutput();
  };

  for (const [index, button] of tabs.entries()) {
    button.tabIndex = index === 0 ? 0 : -1;
    button.addEventListener("click", () => selectTab(button));
    button.addEventListener("keydown", (event) => {
      const step =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) {
        return;
      }
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length]!;
      next.focus();
      selectTab(next);
    });
  }

  /*
   * Say when the tab strip has more in it than fits.
   *
   * The strip scrolls and its scrollbar is hidden, so at 1280px in two columns
   * the Analysis tab sat off the right-hand edge with nothing on screen to
   * suggest it existed. The fade is a class rather than a permanent mask
   * because at a width where all seven fit, a fade dims the last one for no
   * reason. Measured on resize, since the pane's width is half the window's.
   */
  const strip = $<HTMLElement>(".pane--output .tabs");
  const syncOverflow = (): void => {
    strip.classList.toggle(
      "tabs--overflowing",
      strip.scrollWidth > strip.clientWidth + 1,
    );
  };
  syncOverflow();
  new ResizeObserver(syncOverflow).observe(strip);

  $<HTMLSelectElement>("#copybook-picker").addEventListener(
    "change",
    (event) => {
      activeCopybook = Number((event.target as HTMLSelectElement).value);
      renderOutput();
    },
  );

  $("#copy-output").addEventListener("click", () => {
    if (!latest) {
      return;
    }
    const button = $("#copy-output");
    const original = button.textContent;
    const restore = () =>
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);

    // The clipboard can refuse. It does so over plain HTTP, in a browser whose
    // permission has been denied, and in Firefox without a user gesture it
    // recognises. The handler used to be `async` and its rejection went
    // nowhere, so the button said nothing at all and the reader was left
    // deciding whether the click had registered. Say which happened.
    navigator.clipboard.writeText(outputTextFor(activeTab, latest)).then(
      () => {
        button.textContent = "Copied";
        restore();
      },
      () => {
        button.textContent = "Copy failed";
        restore();
      },
    );
  });

  // P4: a link to exactly this program, rather than asking the reader to
  // select the address bar and hope the hash came with it.
  $("#share").addEventListener("click", () => {
    if (!sourceView) {
      return;
    }
    const button = $("#share");
    const original = button.textContent;
    const restore = () =>
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);

    navigator.clipboard
      .writeText(shareUrl(sourceView.state.doc.toString()))
      .then(
        () => {
          button.textContent = "Link copied";
          restore();
        },
        () => {
          button.textContent = "Copy failed";
          restore();
        },
      );
  });

  /**
   * Format, which is the compiler's own formatter rather than a second one.
   *
   * `packages/formatter` prints from the AST, so what this button produces is
   * byte for byte what `pnpm bankc fmt` writes on the command line and what
   * `pnpm fmt:check` holds every example to. A formatter in the playground that
   * disagreed with the one in CI would be worse than none.
   *
   * A program that does not parse is left exactly as it is. A formatter that
   * rewrites source it could not fully understand is one that loses code.
   */
  $("#format").addEventListener("click", () => {
    if (!sourceView) {
      return;
    }
    const button = $("#format");
    const original = button.textContent;
    const restore = () =>
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);

    const formatted = formatBankTs(sourceView.state.doc.toString());
    if (formatted.diagnostics.length > 0) {
      button.textContent = "Cannot format";
      restore();
      return;
    }
    if (formatted.unchanged) {
      button.textContent = "Already formatted";
      restore();
      return;
    }

    // The cursor is kept where it was rather than reset to the top, so
    // formatting mid-edit does not lose the reader's place.
    const cursor = sourceView.state.selection.main.head;
    sourceView.dispatch({
      changes: {
        from: 0,
        to: sourceView.state.doc.length,
        insert: formatted.text,
      },
      selection: { anchor: Math.min(cursor, formatted.text.length) },
    });
    button.textContent = "Formatted";
    restore();
  });

  /*
   * The theme, shared with the rest of the site through the same key.
   *
   * E5. The button said "Theme" whatever was on, with no `aria-pressed` and a
   * constant label, so neither a sighted nor a screen-reader user could tell
   * the current mode from the control.
   *
   * A toggle button, which is what it is: the label names the thing being
   * toggled and `aria-pressed` says whether it is on. The ticket's other
   * suggestion was a label naming the destination — "Dark" while light, "Light"
   * while dark — and the two cannot both be right: a control whose label is
   * where it takes you is an action, and `aria-pressed` on an action button
   * announces a state the label contradicts.
   *
   * The dark preference is followed when nothing has been chosen, so the state
   * can change without a click, and the listener is what keeps the button
   * honest when it does.
   */
  const themeButton = $("#theme");
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = (): boolean => {
    const chosen = document.documentElement.dataset.theme;
    return chosen === "dark" || (chosen === undefined && dark.matches);
  };
  const syncTheme = (): void => {
    themeButton.setAttribute("aria-pressed", String(isDark()));
  };
  syncTheme();
  dark.addEventListener("change", syncTheme);
  themeButton.addEventListener("click", () => {
    document.documentElement.dataset.theme = isDark() ? "light" : "dark";
    window.localStorage.setItem(
      "banklang-theme",
      document.documentElement.dataset.theme,
    );
    syncTheme();
  });

  runCompile();
}

boot();
