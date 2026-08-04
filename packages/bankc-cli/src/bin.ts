import { runBankc, watchProject } from "./index";

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

if (argv.includes("--watch")) {
  process.stdout.write("Watching for changes. Press Ctrl+C to stop.\n");
  const stop = watchProject(argv, process.cwd(), (result) => {
    write(result);
    process.stdout.write("\n");
  });
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
} else {
  write(runBankc(argv));
}
