import { join } from "node:path";

import type { ExtensionContext } from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const configured = workspace
    .getConfiguration("banklang")
    .get<string>("server.path");

  const serverModule =
    configured && configured.length > 0
      ? configured
      : join(context.extensionPath, "server", "bin.js");

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "bankts" }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/banklang.json"),
    },
  };

  client = new LanguageClient(
    "banklang",
    "BankLang Language Server",
    serverOptions,
    clientOptions,
  );

  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
