#!/usr/bin/env node

import {spawn} from "child_process"
import {fileURLToPath} from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, "..")

const tasks = [
  {name: "tsc", color: "\x1b[36m", command: "pnpm", args: ["run", "watch:tsc"]},
  {name: "worker", color: "\x1b[33m", command: "pnpm", args: ["run", "watch:worker"]},
]

let shuttingDown = false
const children = []

const prefixOutput = (stream, prefix, color) => {
  stream?.on("data", data => {
    const lines = data
      .toString()
      .split("\n")
      .map(line => line.trimEnd())
      .filter(Boolean)
    for (const line of lines) {
      console.log(`${color}[${prefix}]\x1b[0m ${line}`)
    }
  })
}

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log("\nShutting down @nostr-git/core watch...")
  for (const child of children) {
    try {
      child.kill("SIGTERM")
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill("SIGKILL")
        } catch {
          // ignore
        }
      }
    }
    process.exit(exitCode)
  }, 800)
}

const handleChildExit = (name, code, signal) => {
  if (shuttingDown) return
  const hasFailure = (code ?? 0) !== 0
  if (hasFailure) {
    console.error(`\x1b[31m[${name}]\x1b[0m exited with code ${code ?? "unknown"}`)
  } else {
    console.error(`\x1b[31m[${name}]\x1b[0m exited unexpectedly${signal ? ` (${signal})` : ""}`)
  }
  shutdown(1)
}

for (const task of tasks) {
  const child = spawn(task.command, task.args, {
    cwd: rootDir,
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  })
  children.push(child)
  prefixOutput(child.stdout, task.name, task.color)
  prefixOutput(child.stderr, task.name, task.color)

  child.on("error", err => {
    console.error(`\x1b[31m[${task.name}]\x1b[0m failed to start: ${err.message}`)
    shutdown(1)
  })

  child.on("exit", (code, signal) => {
    handleChildExit(task.name, code, signal)
  })
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

console.log("\x1b[32m✓\x1b[0m @nostr-git/core watch started. Press Ctrl+C to stop.\n")
