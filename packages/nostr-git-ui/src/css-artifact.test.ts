import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createServer } from "vite";

import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

async function fixture() {
  const root = await mkdtemp(resolve(os.tmpdir(), "nostr-git-css-"));
  fixtures.push(root);
  await mkdir(resolve(root, "src/lib"), { recursive: true });
  await mkdir(resolve(root, "scripts"));
  await symlink(resolve(packageRoot, "node_modules"), resolve(root, "node_modules"), "dir");
  await copyFile(
    resolve(packageRoot, "scripts/build-css.mjs"),
    resolve(root, "scripts/build-css.mjs")
  );
  await copyFile(resolve(packageRoot, "dev.mjs"), resolve(root, "dev.mjs"));
  await writeFile(
    resolve(root, "package.json"),
    JSON.stringify({
      name: packageJson.name,
      type: "module",
      packageManager: "pnpm@10.12.4",
      exports: packageJson.exports,
      files: packageJson.files,
      scripts: packageJson.scripts,
    })
  );
  await writeFile(resolve(root, "svelte.config.js"), "export default {};");
  await writeFile(
    resolve(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { allowJs: true }, include: ["src/lib/**/*"] })
  );
  await writeFile(
    resolve(root, "tailwind.config.js"),
    'export default { content: ["./src/**/*.js"] };'
  );
  await writeFile(resolve(root, "src/lib/index.js"), 'export const classes = "text-red-500";');
  await writeFile(resolve(root, "src/index.css"), "@tailwind utilities;");
  await writeFile(resolve(root, "app.css"), '@import "@nostr-git/ui/index.css";');
  return root;
}

const run = (root: string, script: string) =>
  execFileAsync("pnpm", ["run", script], { cwd: root, timeout: 30_000 });

const cssPath = (root: string) => resolve(root, packageJson.exports["./index.css"]);

async function waitFor(check: () => Promise<boolean>, logs: () => string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(`CSS watcher did not reach the expected state:\n${logs()}`);
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CSS artifact", () => {
  it("keeps generated CSS out of tracked source paths", () => {
    expect(packageJson.exports["./index.css"]).toBe("./styles/index.css");
    expect(packageJson.files).toContain("styles/index.css");
    expect(packageJson.files).not.toContain("index.css");
    expect(existsSync(resolve(packageRoot, "index.css"))).toBe(false);
  });

  it("serves complete CSS through Vite during repeated full package builds", async () => {
    const root = await fixture();
    // Exercise the actual cold-start build, including clean and svelte-package.
    await run(root, "build");
    const server = await createServer({
      root,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      css: { postcss: { plugins: [] } },
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: "127.0.0.1", port: 0, hmr: false },
    });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === "string") throw new Error("Missing Vite address");
      let requests = 0;
      for (let build = 1; build <= 2; build++) {
        const previous = await readFile(cssPath(root), "utf8");
        await writeFile(
          resolve(root, "src/index.css"),
          `@tailwind utilities; .build-${build} { color: red; }`
        );
        let finished = false;
        const rebuilding = run(root, "build").then(
          () => {
            finished = true;
            return undefined;
          },
          (error) => {
            finished = true;
            return error;
          }
        );
        const responses: string[] = [];
        try {
          do {
            const response = await fetch(
              `http://127.0.0.1:${address.port}/app.css?direct&probe=${requests++}`
            );
            expect(response.status).toBe(200);
            responses.push((await response.text()).trim());
            await delay(10);
          } while (!finished);
        } finally {
          const error = await rebuilding;
          if (error) throw error;
        }
        const current = await readFile(cssPath(root), "utf8");
        expect(current).toContain(`.build-${build}`);
        expect(responses.length).toBeGreaterThan(1);
        // Atomic replacement: never missing, empty, truncated, or mixed output.
        for (const css of responses) expect([previous.trim(), current.trim()]).toContain(css);
      }
    } finally {
      await server.close();
    }
  }, 60_000);

  it("retains the last good CSS on compilation failure and skips unchanged output", async () => {
    const root = await fixture();
    await run(root, "build:tailwind");
    const previous = await readFile(cssPath(root), "utf8");
    const previousStat = await stat(cssPath(root));
    await run(root, "build:tailwind");
    expect((await stat(cssPath(root))).mtimeMs).toBe(previousStat.mtimeMs);
    await writeFile(resolve(root, "src/index.css"), ".broken { @apply nonexistent-css-utility; }");
    await expect(run(root, "build:tailwind")).rejects.toThrow();
    expect(await readFile(cssPath(root), "utf8")).toBe(previous);
    expect(await readdir(resolve(root, "styles"))).toEqual(["index.css"]);
  }, 30_000);

  it("watches source/config changes and recovers from CSS errors without restarting", async () => {
    const root = await fixture();
    const child = spawn("pnpm", ["run", "watch"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (data) => {
      logs += data;
    });
    child.stderr.on("data", (data) => {
      logs += data;
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const hasCss = async (text: string) => {
      try {
        return (await readFile(cssPath(root), "utf8")).includes(text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    };
    try {
      await waitFor(
        async () =>
          logs.includes("Watching src/lib for changes") && (await hasCss(".text-red-500")),
        () => logs
      );
      await writeFile(resolve(root, "src/lib/index.js"), 'export const classes = "text-blue-500";');
      await waitFor(
        () => hasCss(".text-blue-500"),
        () => logs
      );
      const previous = await readFile(cssPath(root), "utf8");
      await writeFile(
        resolve(root, "src/index.css"),
        ".broken { @apply nonexistent-css-utility; }"
      );
      await waitFor(
        async () => logs.includes("app crashed"),
        () => logs
      );
      expect(await readFile(cssPath(root), "utf8")).toBe(previous);
      await writeFile(
        resolve(root, "src/index.css"),
        '@tailwind utilities; .watch-probe { color: theme("colors.blue.500"); }'
      );
      await waitFor(
        () => hasCss(".watch-probe"),
        () => logs
      );
      await writeFile(
        resolve(root, "tailwind.config.js"),
        'export default { content: ["./src/**/*.js"], theme: { extend: { colors: { blue: { 500: "#123456" } } } } };'
      );
      await waitFor(
        () => hasCss("#123456"),
        () => logs
      );
      expect(child.exitCode).toBeNull();
    } finally {
      process.kill(-child.pid!, "SIGTERM");
      await exited;
    }
  }, 60_000);
});
