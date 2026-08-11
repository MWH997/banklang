import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  encodeMessage,
  MessageDecoder,
  type JsonRpcMessage,
} from "../packages/language-server/src/index";

/**
 * The language server, driven the way an editor drives it.
 *
 * `tests/language-server.test.ts` calls `LanguageServer.handle` directly. That
 * is the right way to test the request handling and it covers it well, but it
 * never touches the two things between the class and VS Code: the framing, and
 * the process. The 2026-08-06 audit found a defect in each.
 *
 * The framing counted `Content-Length` in bytes and then sliced the body by
 * character count, so any message carrying a non-ASCII character overran into
 * the next header and took both messages with it. Hover output is built as
 * `**BANK-LED-001** — Ledger postings must balance`, with an em dash, so
 * hovering a diagnostic broke the connection for the rest of the session. A
 * test named "counts content length in bytes, not characters" had passed over
 * that decoder for as long as it existed: it pushed one message and nothing
 * after it, and an overrunning `String.prototype.slice` clamps at the end of
 * the string rather than throwing.
 *
 * The process is the artifact the extension actually loads — `server/bin.js`,
 * built by `pnpm build:server` — not the TypeScript entry point. Before the
 * previous pass nothing built it, so the extension could not start at all.
 *
 * So this suite builds that bundle and holds a real conversation with it over
 * stdio: initialize, open, hover, symbols, format, change, close, shut down,
 * exit. Nothing here reaches into the server's internals.
 */

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSION = resolve(ROOT, "packages/vscode-extension");
const BUNDLE = resolve(EXTENSION, "server/bin.js");
const URI = "file:///project/src/main.bank.ts";

/**
 * A checked-in example, and the same example with its credit posting deleted.
 *
 * Taken from the corpus rather than written here, so a change to the language
 * cannot leave this file asserting against BankTS that no longer parses — which
 * would fail for a reason that has nothing to do with the language server.
 */
const BALANCED = readFileSync(
  resolve(ROOT, "examples/account-posting/src/main.bank.ts"),
  "utf8",
);
const CREDIT = "  credit(request.creditAccount, request.amount);\n";
const UNBALANCED = BALANCED.replace(CREDIT, "");

/** One editor session, spoken over the child process's stdio. */
class Session {
  private readonly decoder = new MessageDecoder();
  private readonly received: JsonRpcMessage[] = [];
  private readonly waiters: (() => void)[] = [];
  public readonly stderr: string[] = [];
  private nextId = 1;

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => {
      this.received.push(...this.decoder.push(chunk));
      for (const wake of this.waiters.splice(0)) {
        wake();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr.push(chunk.toString("utf8"));
    });
  }

  public notify(method: string, params: unknown): void {
    this.child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  /** Send a request without waiting, for when the reply is expected to be an error. */
  public send(method: string, params?: unknown): number {
    const id = this.nextId++;
    this.child.stdin.write(
      encodeMessage({ jsonrpc: "2.0", id, method, params }),
    );
    return id;
  }

  /**
   * Send several requests in one write, the way a client pipelines them.
   *
   * An editor does not wait for one reply before asking the next question, and
   * a server that answers only the first request of a batch, or answers them
   * out of order, leaves the client's pending promises unresolved.
   */
  public sendAll(calls: [string, unknown][]): number[] {
    const ids = calls.map(() => this.nextId++);
    this.child.stdin.write(
      calls
        .map(([method, params], index) =>
          encodeMessage({ jsonrpc: "2.0", id: ids[index], method, params }),
        )
        .join(""),
    );
    return ids;
  }

  /** A notification and a request written together, in that order. */
  public notifyThenRequest(
    notification: [string, unknown],
    request: [string, unknown],
  ): number {
    const id = this.nextId++;
    this.child.stdin.write(
      encodeMessage({
        jsonrpc: "2.0",
        method: notification[0],
        params: notification[1],
      }) +
        encodeMessage({
          jsonrpc: "2.0",
          id,
          method: request[0],
          params: request[1],
        }),
    );
    return id;
  }

  public async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.send(method, params);
    const reply = await this.await(
      (message) => message.id === id,
      `a reply to ${method}`,
    );
    if (reply.error) {
      throw new Error(`${method} failed: ${reply.error.message}`);
    }
    return reply.result;
  }

  /** The next message matching a predicate, or a failure naming what was seen. */
  public async await(
    matches: (message: JsonRpcMessage) => boolean,
    what = "a matching message",
  ): Promise<JsonRpcMessage> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const found = this.received.find(matches);
      if (found) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${what}. Received: ${this.received
            .map((message) => message.method ?? `reply#${message.id}`)
            .join(", ")}. stderr: ${this.stderr.join("")}`,
        );
      }
      await new Promise<void>((wake) => {
        this.waiters.push(wake);
        setTimeout(wake, 50);
      });
    }
  }

  public exited(): Promise<number | null> {
    return new Promise((done) => this.child.on("exit", done));
  }
}

function start(): Session {
  return new Session(
    spawn(process.execPath, [BUNDLE], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
}

/** Ask an already-initialized session to open the unbalanced program. */
async function openUnbalanced(session: Session) {
  session.notify("textDocument/didOpen", {
    textDocument: {
      uri: URI,
      languageId: "bankts",
      version: 1,
      text: UNBALANCED,
    },
  });
  const published = await session.await(
    (message) => message.method === "textDocument/publishDiagnostics",
    "publishDiagnostics",
  );
  return published.params as {
    uri: string;
    diagnostics: { code: string; message: string; range: unknown }[];
  };
}

describe("the language server the extension loads", () => {
  beforeAll(() => {
    // The same script `pnpm build` runs, so the test cannot pass against a
    // bundle built some other way. Invoke the package-manager CLI through the
    // Node process that launched Vitest when Corepack has not installed a
    // `pnpm` shim on PATH; Stryker's sandbox preserves `npm_execpath`, and the
    // scheduled lane must be able to run this compiler-facing integration
    // suite rather than excluding it wholesale.
    const packageManager = process.env.npm_execpath;
    const executable = packageManager ? process.execPath : "corepack";
    const command = packageManager
      ? [packageManager, "run", "build:server"]
      : ["pnpm", "run", "build:server"];
    execFileSync(executable, command, {
      cwd: EXTENSION,
      stdio: "pipe",
    });
  }, 120_000);

  it("is written by a build script rather than by hand", () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const manifest = JSON.parse(
      readFileSync(resolve(EXTENSION, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts.build).toContain("build:server");
  });

  it("answers initialize with the capabilities it implements", async () => {
    const session = start();
    const result = (await session.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    })) as {
      capabilities: Record<string, unknown>;
      serverInfo: { name: string };
    };

    expect(result.serverInfo.name).toBe("banklang-language-server");
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.documentFormattingProvider).toBe(true);
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    // Full sync, which is what didChange handling assumes.
    expect(result.capabilities.textDocumentSync).toBe(1);

    session.notify("exit", {});
  });

  it("holds a whole editing session without losing the stream", async () => {
    const session = start();
    await session.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    session.notify("initialized", {});

    // 1. Open a file. Diagnostics arrive unasked, as they do in an editor.
    const opened = await openUnbalanced(session);
    expect(opened.uri).toBe(URI);
    const codes = opened.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("BANK-LED-001");

    // 2. Hover the offending line, and ask for two more things in the same
    //    write, the way an editor pipelines. Every one has to come back, and
    //    the hover reply has to survive the em dash it is built with.
    const ledgerLine = UNBALANCED.split("\n").findIndex((line) =>
      line.includes("debit(request.debitAccount"),
    );
    const [hoverId, symbolId, formatId] = session.sendAll([
      [
        "textDocument/hover",
        {
          textDocument: { uri: URI },
          position: { line: ledgerLine, character: 4 },
        },
      ],
      ["textDocument/documentSymbol", { textDocument: { uri: URI } }],
      [
        "textDocument/formatting",
        {
          textDocument: { uri: URI },
          options: { tabSize: 2, insertSpaces: true },
        },
      ],
    ]);

    const hover = (
      await session.await((message) => message.id === hoverId, "hover")
    ).result as { contents: { kind: string; value: string } };
    expect(hover.contents.kind).toBe("markdown");
    expect(hover.contents.value).toContain("BANK-LED-001");
    expect(hover.contents.value).toContain("—");

    // 3. The replies queued behind the hover arrive too.
    const symbols = (
      await session.await((message) => message.id === symbolId, "symbols")
    ).result as { name: string; kind: number }[];
    expect(symbols.map((symbol) => symbol.name)).toEqual([
      "AccountPosting",
      "MoneyBDT",
      "PostTransferRequest",
      "postTransfer",
    ]);

    const edits = (
      await session.await((message) => message.id === formatId, "formatting")
    ).result as unknown[];
    // The program is already formatted, so there is nothing to change.
    expect(edits).toEqual([]);

    // 4. Edit the file the way full sync sends it, and watch the diagnostic go.
    session.notify("textDocument/didChange", {
      textDocument: { uri: URI, version: 2 },
      contentChanges: [{ text: BALANCED }],
    });
    const balanced = await session.await(
      (message) =>
        message.method === "textDocument/publishDiagnostics" &&
        !JSON.stringify(
          (message.params as { diagnostics: unknown[] }).diagnostics,
        ).includes("BANK-LED-001"),
      "diagnostics without BANK-LED-001",
    );
    expect((balanced.params as { diagnostics: unknown[] }).diagnostics).toEqual(
      [],
    );

    // 5. Closing clears the squiggles rather than leaving them on screen.
    session.notify("textDocument/didClose", { textDocument: { uri: URI } });
    await session.await(
      (message) =>
        message.method === "textDocument/publishDiagnostics" &&
        (message.params as { diagnostics: unknown[] }).diagnostics.length ===
          0 &&
        message !== balanced,
      "cleared diagnostics",
    );

    // 6. Shut down cleanly, which is how VS Code ends a session.
    expect(await session.request("shutdown")).toBeNull();
    session.notify("exit", {});
    expect(await session.exited()).toBe(0);
    expect(session.stderr.join("")).toBe("");
  }, 60_000);

  it("refuses a request it has no handler for instead of going quiet", async () => {
    const session = start();
    await session.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    session.notify("initialized", {});

    // An editor asks for things the server never advertised. VS Code sends
    // `textDocument/definition` whenever the user ctrl-clicks, whether or not
    // the server said it could answer. A request that gets no reply at all
    // leaves the editor's client waiting forever, so the error matters.
    session.send("textDocument/definition", {
      textDocument: { uri: URI },
      position: { line: 0, character: 0 },
    });
    const reply = await session.await(
      (message) => message.error !== undefined,
      "an error reply",
    );
    expect(reply.error?.code).toBe(-32601);

    // A notification it has no handler for is dropped in silence, which is
    // what the specification asks for: notifications are never replied to.
    session.notify("$/setTrace", { value: "off" });
    const answered = await session.request("textDocument/documentSymbol", {
      textDocument: { uri: URI },
    });
    expect(answered).toEqual([]);

    session.notify("exit", {});
  }, 30_000);

  it("reads a message with a non-ASCII character without losing the next one", async () => {
    // `Content-Length` counts bytes. A decoder that then slices the body by
    // character count overruns into the following header, which costs both
    // messages and every one after them, because the buffer never realigns.
    // A message on its own survives the overrun — `String.prototype.slice`
    // clamps — so the two have to arrive in one write, which is exactly how a
    // client sends a notification and the request that follows it.
    //
    // A non-ASCII path is not exotic: it is someone whose project lives under
    // their name.
    const session = start();
    await session.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    session.notify("initialized", {});

    const uri = "file:///Users/andré/projets/café/src/main.bank.ts";
    const id = session.notifyThenRequest(
      [
        "textDocument/didOpen",
        {
          textDocument: {
            uri,
            languageId: "bankts",
            version: 1,
            text: BALANCED,
          },
        },
      ],
      ["textDocument/documentSymbol", { textDocument: { uri } }],
    );

    const reply = await session.await(
      (message) => message.id === id,
      "the request written behind a non-ASCII notification",
    );
    expect((reply.result as { name: string }[]).map((s) => s.name)).toEqual([
      "AccountPosting",
      "MoneyBDT",
      "PostTransferRequest",
      "postTransfer",
    ]);

    session.notify("exit", {});
  }, 30_000);

  it("exits non-zero when told to exit without a shutdown", async () => {
    const session = start();
    await session.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    session.notify("exit", {});
    // The specification asks for success only after shutdown; anything else is
    // an error exit, so a supervising editor knows the session was cut short.
    expect(await session.exited()).toBe(1);
  }, 30_000);

  afterAll(() => {
    // Nothing to tear down: every session is asked to exit.
  });
});
