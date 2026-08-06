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
import { bankts } from "./bankts-language";
import { ALL_EXAMPLES, EXAMPLES } from "./examples";
import "./styles.css";

type TabId = "cobol" | "copybook" | "diagnostics" | "sourcemap" | "analysis";

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
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
};

let sourceView: EditorView | null = null;
let outputView: EditorView | null = null;
let latest: CompileResult | null = null;
let activeTab: TabId = "cobol";
let activeCopybook = 0;

const readonlyLanguage = new Compartment();

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
        stat("records", analysis.recordCount),
        stat("functions", analysis.functionCount),
        stat("transactions", analysis.transactionCount),
        stat("postings", analysis.ledgerPostingCount),
        stat("audit events", analysis.auditEventCount),
        stat("files", analysis.fileCount),
      ].join("")
    : "";
}

function stat(label: string, value: number): string {
  return `<span class="stat"><b>${value}</b>${label}</span>`;
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
  const editorPane = $("#output-editor");

  if (activeTab === "diagnostics") {
    diagnosticsPane.hidden = false;
    editorPane.hidden = true;
    renderDiagnostics(latest);
    return;
  }

  diagnosticsPane.hidden = true;
  editorPane.hidden = false;

  const text = outputTextFor(activeTab, latest);
  outputView.dispatch({
    changes: { from: 0, to: outputView.state.doc.length, insert: text },
  });
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

  pane.innerHTML = result.diagnostics
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
    .join("");

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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] as string,
  );
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

  // The theme, shared with the rest of the site through the same key.
  $("#theme").addEventListener("click", () => {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    window.localStorage.setItem("banklang-theme", root.dataset.theme);
  });

  runCompile();
}

boot();
