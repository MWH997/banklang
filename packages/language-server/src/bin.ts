import { encodeMessage, LanguageServer, MessageDecoder } from "./index";

const server = new LanguageServer();
const decoder = new MessageDecoder();

// No `setEncoding`: the framing counts bytes, so the decoder is given bytes.
// Decoding to a string here and framing by byte count is what broke every
// message carrying a non-ASCII character, and hover output carries an em dash.
process.stdin.on("data", (chunk: Buffer) => {
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
