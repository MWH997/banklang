import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  encodeMessage,
  LanguageServer,
  MessageDecoder,
  type JsonRpcMessage,
} from "../packages/language-server/src/index";

const URI = "file:///project/src/main.bank.ts";

const CLEAN = readFileSync("examples/account-posting/src/main.bank.ts", "utf8");

/**
 * The zero-based line a construct is written on, found rather than counted.
 *
 * A hard-coded line number couples the test to an example's layout, so a
 * comment added to `account-posting` silently moves what is being hovered — and
 * the assertion still passes or fails for a reason that has nothing to do with
 * the language server.
 */
function lineOf(source: string, needle: string): number {
  const line = source.split("\n").findIndex((text) => text.includes(needle));
  if (line === -1) {
    throw new Error(`No line contains ${needle}`);
  }
  return line;
}

const UNSAFE = `module Unsafe;

type MoneyBDT = decimal<18, 2>;

record Posting {
  debitAccount: string<16>;
  amount: MoneyBDT;
}

transaction post(request: Posting) {
  debit(request.debitAccount, request.amount);
}
`;

function open(server: LanguageServer, text: string): JsonRpcMessage[] {
  return server.handle({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: URI, text } },
  });
}

function diagnosticsFrom(messages: JsonRpcMessage[]) {
  const params = messages[0].params as {
    uri: string;
    diagnostics: { code: string; severity: number; message: string }[];
  };
  return params.diagnostics;
}

describe("language server lifecycle", () => {
  it("advertises its capabilities on initialize", () => {
    const server = new LanguageServer();
    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    const result = response.result as {
      capabilities: Record<string, unknown>;
    };
    expect(response.id).toBe(1);
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.documentFormattingProvider).toBe(true);
    expect(result.capabilities.documentSymbolProvider).toBe(true);
  });

  it("returns an error for an unknown request but ignores unknown notifications", () => {
    const server = new LanguageServer();

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 7,
      method: "textDocument/nonsense",
    });
    expect(response.error?.code).toBe(-32601);

    expect(server.handle({ jsonrpc: "2.0", method: "$/notify" })).toEqual([]);
  });

  it("tracks open documents and clears diagnostics on close", () => {
    const server = new LanguageServer();
    open(server, CLEAN);
    expect(server.documentCount()).toBe(1);

    const closed = server.handle({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri: URI } },
    });

    expect(server.documentCount()).toBe(0);
    expect(diagnosticsFrom(closed)).toEqual([]);
  });
});

describe("language server diagnostics", () => {
  it("publishes nothing for a clean document", () => {
    const server = new LanguageServer();
    expect(diagnosticsFrom(open(server, CLEAN))).toEqual([]);
  });

  it("publishes banking safety diagnostics with codes and ranges", () => {
    const server = new LanguageServer();
    const diagnostics = diagnosticsFrom(open(server, UNSAFE));

    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "BANK-TXN-001",
      "BANK-AUD-001",
      "BANK-LED-001",
    ]);
    expect(diagnostics[0].severity).toBe(1);
    expect(diagnostics[0].message).toContain("idempotency key");
  });

  it("converts one-based spans to zero-based LSP ranges", () => {
    const server = new LanguageServer();
    const diagnostics = diagnosticsFrom(open(server, UNSAFE)) as unknown as {
      range: { start: { line: number; character: number } };
    }[];

    // The transaction is declared on source line 10, column 13. LSP counts
    // both from zero, so the range starts at line 9, character 12.
    //
    // The column used to be asserted as `toBeGreaterThanOrEqual(0)`, which is
    // true of every number the conversion can produce except one — and the one
    // it excluded, a negative column, is not the failure worth guarding. An
    // off-by-one that reported the wrong column, which is what the conversion
    // exists to get right, satisfied it.
    expect(diagnostics[0].range.start).toEqual({ line: 9, character: 12 });
  });

  it("republishes on change", () => {
    const server = new LanguageServer();
    open(server, CLEAN);

    const changed = server.handle({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: URI },
        contentChanges: [{ text: UNSAFE }],
      },
    });

    expect(diagnosticsFrom(changed).length).toBe(3);
  });
});

describe("language server hover", () => {
  it("explains a diagnostic under the cursor", () => {
    const server = new LanguageServer();
    open(server, UNSAFE);

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: {
        textDocument: { uri: URI },
        position: { line: 9, character: 2 },
      },
    });

    const value = (response.result as { contents: { value: string } }).contents
      .value;
    expect(value).toContain("BANK-TXN-001");
    expect(value).toContain("**Fix:**");
  });

  it("describes the generated COBOL for a clean line", () => {
    const server = new LanguageServer();
    open(server, CLEAN);

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/hover",
      params: {
        textDocument: { uri: URI },
        position: {
          line: lineOf(CLEAN, "transaction postTransfer"),
          character: 2,
        },
      },
    });

    const value = (response.result as { contents: { value: string } }).contents
      .value;
    expect(value).toContain("Generates COBOL lines");
  });

  it("returns null for an unknown document", () => {
    const server = new LanguageServer();
    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "textDocument/hover",
      params: {
        textDocument: { uri: "file:///missing" },
        position: { line: 0, character: 0 },
      },
    });

    expect(response.result).toBeNull();
  });
});

describe("language server formatting and symbols", () => {
  it("returns a full-document edit for unformatted source", () => {
    const server = new LanguageServer();
    open(server, "module   Messy;\ntype A=decimal<18,2>;\n");

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "textDocument/formatting",
      params: { textDocument: { uri: URI } },
    });

    const edits = response.result as { newText: string }[];
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe(
      "module Messy;\n\ntype A = decimal<18, 2>;\n",
    );
  });

  it("returns no edit when the document is already formatted", () => {
    const server = new LanguageServer();
    open(server, CLEAN);

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 6,
      method: "textDocument/formatting",
      params: { textDocument: { uri: URI } },
    });

    expect(response.result).toEqual([]);
  });

  it("produces an outline with nested record fields", () => {
    const server = new LanguageServer();
    open(server, CLEAN);

    const [response] = server.handle({
      jsonrpc: "2.0",
      id: 8,
      method: "textDocument/documentSymbol",
      params: { textDocument: { uri: URI } },
    });

    const symbols = response.result as {
      name: string;
      kind: number;
      children?: { name: string }[];
    }[];

    expect(symbols.map((symbol) => symbol.name)).toEqual([
      "AccountPosting",
      "MoneyBDT",
      "PostTransferRequest",
      "postTransfer",
    ]);
    expect(
      symbols.find((symbol) => symbol.name === "PostTransferRequest")?.children,
    ).toHaveLength(4);
  });
});

describe("json-rpc framing", () => {
  it("round-trips a message", () => {
    const decoder = new MessageDecoder();
    const encoded = encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" });

    expect(encoded).toContain("Content-Length:");
    expect(decoder.push(encoded)).toEqual([
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ]);
  });

  it("reassembles a message split across chunks", () => {
    const decoder = new MessageDecoder();
    const encoded = encodeMessage({ jsonrpc: "2.0", id: 2, method: "split" });
    const cut = Math.floor(encoded.length / 2);

    expect(decoder.push(encoded.slice(0, cut))).toEqual([]);
    expect(decoder.push(encoded.slice(cut))).toEqual([
      { jsonrpc: "2.0", id: 2, method: "split" },
    ]);
  });

  it("decodes several messages arriving in one chunk", () => {
    const decoder = new MessageDecoder();
    const chunk =
      encodeMessage({ jsonrpc: "2.0", id: 1, method: "a" }) +
      encodeMessage({ jsonrpc: "2.0", id: 2, method: "b" });

    expect(decoder.push(chunk).map((message) => message.method)).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips a malformed body without breaking the stream", () => {
    const decoder = new MessageDecoder();
    const broken = "Content-Length: 3\r\n\r\n{{{";
    const good = encodeMessage({ jsonrpc: "2.0", id: 9, method: "ok" });

    expect(
      decoder.push(broken + good).map((message) => message.method),
    ).toEqual(["ok"]);
  });

  it("counts content length in bytes, not characters", () => {
    // This test is older than the bug it now catches, and for that whole time
    // it passed against a decoder that sliced the body by character count.
    // Reading `Content-Length` bytes as characters overruns the body, but
    // `String.prototype.slice` clamps at the end of the string, so a lone
    // message still came back whole and the assertion held. The property only
    // has consequences when another message follows: the overrun eats into the
    // next header, and both messages are lost. So the check is a non-ASCII
    // message with a second one behind it, which is what a connection sends.
    const decoder = new MessageDecoder();
    const chunk =
      encodeMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "unicode",
        params: { text: "café ☕ — 円" },
      }) + encodeMessage({ jsonrpc: "2.0", id: 4, method: "after" });

    const decoded = decoder.push(chunk);
    expect(decoded.map((message) => message.method)).toEqual([
      "unicode",
      "after",
    ]);
    expect((decoded[0].params as { text: string }).text).toBe("café ☕ — 円");
  });

  it("keeps the stream aligned when a chunk splits a character in two", () => {
    // A stdio transport can deliver a chunk boundary in the middle of a
    // multi-byte character. Reassembly has to happen on bytes; decoding each
    // chunk to a string first would turn the halves into replacement
    // characters and change the byte length of the body.
    const decoder = new MessageDecoder();
    const encoded = Buffer.from(
      encodeMessage({
        jsonrpc: "2.0",
        id: 5,
        method: "split",
        params: { text: "€" },
      }),
      "utf8",
    );
    const middle = encoded.indexOf(Buffer.from("€", "utf8")) + 1;

    expect(decoder.push(encoded.subarray(0, middle))).toEqual([]);
    const decoded = decoder.push(encoded.subarray(middle));
    expect(decoded).toHaveLength(1);
    expect((decoded[0].params as { text: string }).text).toBe("€");
  });
});
