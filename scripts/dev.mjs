import { spawn } from "node:child_process";

let isShuttingDown = false;
const portless = spawn("portless", process.argv.slice(2), {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"]
});

function filterPortlessNoise(stream, output) {
  let pending = "";

  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      if (/^-- Using port \d+\s*$/.test(line) || /^Running: PORT=\d+\b/.test(line)) {
        continue;
      }

      output.write(`${line}\n`);
    }
  });

  stream.on("end", () => {
    if (pending.length > 0) {
      output.write(pending);
    }
  });
}

filterPortlessNoise(portless.stdout, process.stdout);
filterPortlessNoise(portless.stderr, process.stderr);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    portless.kill(signal);
  });
}

portless.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

portless.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
    return;
  }

  process.exit(code ?? 0);
});
