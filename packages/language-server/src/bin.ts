import { encodeMessage, LanguageServer, MessageDecoder } from "./index";

const server = new LanguageServer();
const decoder = new MessageDecoder();

process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk: string) => {
  for (const message of decoder.push(chunk)) {
    for (const response of server.handle(message)) {
      process.stdout.write(encodeMessage(response));
    }

    if (message.method === "exit") {
      process.exit(server.isShutdown ? 0 : 1);
    }
  }
});

process.stdin.on("close", () => {
  process.exit(0);
});
