import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");

describe("CSS artifact", () => {
  it("keeps generated CSS out of tracked source paths", () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));

    expect(packageJson.exports["./index.css"]).toBe("./dist/index.css");
    expect(packageJson.files).not.toContain("index.css");
    expect(packageJson.scripts["build:tailwind"]).toContain("-o ./dist/index.css");
    expect(packageJson.scripts["watch:tailwind"]).toContain("-o ./dist/index.css");
    expect(packageJson.scripts["watch:lib"]).toContain("--preserve-output");
    expect(existsSync(resolve(packageRoot, "index.css"))).toBe(false);
  });
});
