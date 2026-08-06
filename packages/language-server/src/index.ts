import type { Diagnostic as BankDiagnostic } from "../../ast/src/index";
import { compile } from "../../compiler/src/index";
import { explainDiagnostic } from "../../diagnostics/src/index";
import { formatBankTs } from "../../formatter/src/index";
import { parseBankTs } from "../../parser/src/index";

/* ------------------------------------------------------------------ *
 * Minimal LSP types.
 *
 * Declared locally rather than depending on `vscode-languageserver`, so the
 * server stays dependency-free and the compiler remains the only thing that
 * has to be correct.
 * ------------------------------------------------------------------ */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface LspDiagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: "banklang";
  message: string;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const SYMBOL_KIND = {
  module: 2,
  record: 23,
  field: 8,
  function: 12,
  transaction: 6,
  file: 11,
  type: 5,
} as const;

/**
 * Document state and request handling for the BankLang language server.
 *
 * The class is deliberately transport-free: it takes a message and returns
 * responses and notifications. `bin.ts` owns stdio. That split is what makes
 * the server testable without spawning a process.
 */
export class LanguageServer {
  private readonly documents = new Map<string, string>();
  private shutdownRequested = false;

  public handle(message: JsonRpcMessage): JsonRpcMessage[] {
    switch (message.method) {
      case "initialize":
        return [this.reply(message, this.capabilities())];

      case "initialized":
        return [];

      case "textDocument/didOpen": {
        const params = message.params as {
          textDocument: { uri: string; text: string };
        };
        this.documents.set(params.textDocument.uri, params.textDocument.text);
        return [this.publishDiagnostics(params.textDocument.uri)];
      }

      case "textDocument/didChange": {
        const params = message.params as {
          textDocument: { uri: string };
          contentChanges: { text: string }[];
        };
        // Full-sync only: capabilities advertise TextDocumentSyncKind.Full.
        const text = params.contentChanges.at(-1)?.text;
        if (text !== undefined) {
          this.documents.set(params.textDocument.uri, text);
        }
        return [this.publishDiagnostics(params.textDocument.uri)];
      }

      case "textDocument/didClose": {
        const params = message.params as { textDocument: { uri: string } };
        this.documents.delete(params.textDocument.uri);
        return [
          {
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: { uri: params.textDocument.uri, diagnostics: [] },
          },
        ];
      }

      case "textDocument/hover":
        return [this.reply(message, this.hover(message.params))];

      case "textDocument/formatting":
        return [this.reply(message, this.formatting(message.params))];

      case "textDocument/documentSymbol":
        return [this.reply(message, this.documentSymbols(message.params))];

      case "shutdown":
        this.shutdownRequested = true;
        return [this.reply(message, null)];

      case "exit":
        return [];

      default:
        if (message.id === undefined || message.id === null) {
          return [];
        }
        return [
          {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: `Unknown method: ${message.method}`,
            },
          },
        ];
    }
  }

  public get isShutdown(): boolean {
    return this.shutdownRequested;
  }

  public documentCount(): number {
    return this.documents.size;
  }

  private capabilities(): unknown {
    return {
      capabilities: {
        textDocumentSync: 1,
        hoverProvider: true,
        documentFormattingProvider: true,
        documentSymbolProvider: true,
      },
      serverInfo: { name: "banklang-language-server", version: "0.1.0" },
    };
  }

  private reply(message: JsonRpcMessage, result: unknown): JsonRpcMessage {
    return { jsonrpc: "2.0", id: message.id ?? null, result };
  }

  private publishDiagnostics(uri: string): JsonRpcMessage {
    const text = this.documents.get(uri) ?? "";
    const result = compile(text, { sourceFile: uri });

    return {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: result.diagnostics.map(toLspDiagnostic),
      },
    };
  }

  private hover(params: unknown): unknown {
    const { textDocument, position } = params as {
      textDocument: { uri: string };
      position: Position;
    };
    const text = this.documents.get(textDocument.uri);
    if (text === undefined) {
      return null;
    }

    const result = compile(text, { sourceFile: textDocument.uri });
    const line = position.line + 1;

    // A diagnostic under the cursor is the most useful thing to show.
    const diagnostic = result.diagnostics.find(
      (candidate) =>
        candidate.span !== null &&
        candidate.span.start.line <= line &&
        line <= candidate.span.end.line,
    );

    if (diagnostic) {
      const doc = explainDiagnostic(diagnostic.id);
      const parts = [
        `**${diagnostic.id}** — ${doc?.title ?? "Diagnostic"}`,
        "",
      ];
      parts.push(diagnostic.message);
      if (doc) {
        parts.push("", doc.explanation, "", `**Fix:** ${doc.remediation}`);
      }
      return {
        contents: { kind: "markdown", value: parts.join("\n") },
      };
    }

    // Otherwise, describe the generated COBOL this line maps to.
    const entry = result.sourceMap?.entries
      .filter(
        (candidate) =>
          candidate.sourceStart.line <= line &&
          line <= candidate.sourceEnd.line,
      )
      .sort(
        (left, right) =>
          left.sourceEnd.line -
          left.sourceStart.line -
          (right.sourceEnd.line - right.sourceStart.line),
      )[0];

    if (!entry) {
      return null;
    }

    return {
      contents: {
        kind: "markdown",
        value: [
          `**${entry.category}** \`${entry.symbol}\``,
          "",
          `Generates COBOL lines ${entry.targetStartLine}–${entry.targetEndLine}.`,
        ].join("\n"),
      },
    };
  }

  private formatting(params: unknown): unknown {
    const { textDocument } = params as { textDocument: { uri: string } };
    const text = this.documents.get(textDocument.uri);
    if (text === undefined) {
      return [];
    }

    const result = formatBankTs(text, textDocument.uri);
    if (result.unchanged || result.diagnostics.length > 0) {
      return [];
    }

    const lineCount = text.split("\n").length;
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lineCount, character: 0 },
        },
        newText: result.text,
      },
    ];
  }

  private documentSymbols(params: unknown): unknown {
    const { textDocument } = params as { textDocument: { uri: string } };
    const text = this.documents.get(textDocument.uri);
    if (text === undefined) {
      return [];
    }

    const parsed = parseBankTs(text, textDocument.uri);
    if (!parsed.program) {
      return [];
    }

    const symbols: unknown[] = [
      {
        name: parsed.program.module.name,
        kind: SYMBOL_KIND.module,
        range: toRange(parsed.program.module.span),
        selectionRange: toRange(parsed.program.module.span),
      },
    ];

    for (const declaration of parsed.program.declarations) {
      const range = toRange(declaration.span);
      const base = {
        // A file error handler is named after the file it covers rather than
        // carrying a name of its own.
        name:
          declaration.kind === "FileErrorHandler"
            ? `on error ${declaration.fileName}`
            : declaration.name,
        range,
        selectionRange: range,
      };

      switch (declaration.kind) {
        case "RecordDeclaration":
          symbols.push({
            ...base,
            kind: SYMBOL_KIND.record,
            children: declaration.fields.map((field) => ({
              name: field.name,
              kind: SYMBOL_KIND.field,
              range: toRange(field.span),
              selectionRange: toRange(field.span),
            })),
          });
          break;
        case "FunctionDeclaration":
          symbols.push({ ...base, kind: SYMBOL_KIND.function });
          break;
        case "TransactionDeclaration":
          symbols.push({ ...base, kind: SYMBOL_KIND.transaction });
          break;
        case "FileDeclaration":
          symbols.push({ ...base, kind: SYMBOL_KIND.file });
          break;
        case "TypeAliasDeclaration":
          symbols.push({ ...base, kind: SYMBOL_KIND.type });
          break;
      }
    }

    return symbols;
  }
}

function toLspDiagnostic(diagnostic: BankDiagnostic): LspDiagnostic {
  const span = diagnostic.span;
  return {
    range: span
      ? toRange(span)
      : {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
    severity: diagnostic.severity === "error" ? 1 : 2,
    code: diagnostic.id,
    source: "banklang",
    message: diagnostic.hint
      ? `${diagnostic.message}\n${diagnostic.hint}`
      : diagnostic.message,
  };
}

/** BankLang spans are 1-based; LSP positions are 0-based. */
function toRange(span: {
  start: { line: number; column: number };
  end: { line: number; column: number };
}): Range {
  return {
    start: { line: span.start.line - 1, character: span.start.column - 1 },
    end: { line: span.end.line - 1, character: span.end.column - 1 },
  };
}

/* ------------------------------------------------------------------ *
 * JSON-RPC framing over a byte stream.
 * ------------------------------------------------------------------ */

export function encodeMessage(message: JsonRpcMessage): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

/**
 * Incremental decoder for `Content-Length`-framed messages.
 *
 * A stdio transport delivers arbitrary chunks, so messages must be reassembled
 * rather than assumed to arrive whole.
 *
 * The buffer is bytes, not characters, throughout. `Content-Length` counts
 * bytes — the LSP specification's base protocol says so — and the two differ
 * for every non-ASCII character. Buffering the stream as a string and then
 * slicing it by the byte count takes too many characters, which leaves the
 * remainder starting partway into the next header and desynchronises the
 * connection for the rest of the session. Because `String.prototype.slice`
 * clamps rather than throwing, a message decoded on its own still comes out
 * intact; the damage only appears when something follows it, which on a live
 * connection is always.
 */
export class MessageDecoder {
  private buffer = Buffer.alloc(0);

  public push(chunk: string | Buffer): JsonRpcMessage[] {
    this.buffer = Buffer.concat([
      this.buffer,
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk,
    ]);
    const messages: JsonRpcMessage[] = [];

    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Unparseable header: drop it rather than spin forever.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length - bodyStart < length) {
        break;
      }

      const body = this.buffer
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);

      try {
        messages.push(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // A malformed body is skipped; the stream stays usable.
      }
    }

    return messages;
  }
}
