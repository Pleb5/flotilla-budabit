import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const output = path.resolve("styles/index.css");
const controller = new AbortController();
let interrupted = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    controller.abort();
  });
}

// Svelte owns dist; CSS must survive its clean/full builds. Stage on the same
// filesystem so readers see either the previous complete CSS or the new one.
await mkdir(path.dirname(output), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(output), ".build-"));

try {
  const temporaryOutput = path.join(staging, "index.css");
  const { stderr } = await execFileAsync(
    process.execPath,
    [
      require.resolve("tailwindcss/lib/cli.js"),
      "--input",
      "src/index.css",
      "--output",
      temporaryOutput,
      "--minify",
    ],
    { signal: controller.signal }
  );
  process.stderr.write(stderr);

  let previous;
  try {
    previous = await readFile(output, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Avoid unnecessary HMR when an edit doesn't change the generated styles.
  if (!interrupted && previous !== (await readFile(temporaryOutput, "utf8"))) {
    await rename(temporaryOutput, output);
  }
} catch (error) {
  if (!interrupted) {
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
