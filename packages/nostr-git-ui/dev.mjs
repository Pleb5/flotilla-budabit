#!/usr/bin/env node

import { spawn } from "child_process";
import { mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

const tasks = [
  { name: "lib", color: "\x1b[36m", command: "pnpm", args: ["run", "watch:lib"] },
  { name: "tailwind", color: "\x1b[35m", command: "pnpm", args: ["run", "watch:tailwind"] },
];

let shuttingDown = false;
const children = [];

const prefixOutput = (stream, prefix, color) => {
  stream?.on("data", (data) => {
    const lines = data
      .toString()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    for (const line of lines) {
      console.log(`${color}[${prefix}]\x1b[0m ${line}`);
    }
  });
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down @nostr-git/ui watch...");
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
    process.exit(exitCode);
  }, 800);
};

const handleChildExit = (name, code, signal) => {
  if (shuttingDown) return;
  const hasFailure = (code ?? 0) !== 0;
  if (hasFailure) {
    console.error(`\x1b[31m[${name}]\x1b[0m exited with code ${code ?? "unknown"}`);
  } else {
    console.error(`\x1b[31m[${name}]\x1b[0m exited unexpectedly${signal ? ` (${signal})` : ""}`);
  }
  shutdown(1);
};

for (const task of tasks) {
  const child = spawn(task.command, task.args, {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });
  children.push(child);
  prefixOutput(child.stdout, task.name, task.color);
  prefixOutput(child.stderr, task.name, task.color);

  child.on("error", (err) => {
    console.error(`\x1b[31m[${task.name}]\x1b[0m failed to start: ${err.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    handleChildExit(task.name, code, signal);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("\x1b[32m✓\x1b[0m @nostr-git/ui watch started. Press Ctrl+C to stop.\n");
