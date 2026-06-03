import { describe, expect, it } from "vitest";

import {
  getHighlightJs,
  getHighlightLanguageForPath,
  highlightCodeSnippet,
  loadCodeMirrorLanguageExtensions,
} from "../src/lib/utils/codeHighlight";

describe("code highlighting helpers", () => {
  it("resolves common language aliases from file paths", () => {
    expect(getHighlightLanguageForPath("app/main.kt")).toBe("kotlin");
    expect(getHighlightLanguageForPath("app/main.dart")).toBe("dart");
    expect(getHighlightLanguageForPath("infra/Dockerfile")).toBe("dockerfile");
    expect(getHighlightLanguageForPath("Cargo.toml")).toBe("toml");
    expect(getHighlightLanguageForPath("scripts/profile.ps1")).toBe("powershell");
    expect(getHighlightLanguageForPath("queries/schema.graphql")).toBe("graphql");
    expect(getHighlightLanguageForPath("gradle.properties")).toBe("ini");
    expect(getHighlightLanguageForPath("nix/flake.nix")).toBe("nix");
    expect(getHighlightLanguageForPath("nix/module.nix")).toBe("nix");
    expect(getHighlightLanguageForPath("Cargo.lock")).toBe("toml");
    expect(getHighlightLanguageForPath("infra/nginx.conf")).toBe("nginx");
    expect(getHighlightLanguageForPath("puppet/site.pp")).toBe("puppet");
    expect(getHighlightLanguageForPath(".env.production")).toBe("ini");
    expect(getHighlightLanguageForPath("src/App.svelte")).toBe("svelte");
  });

  it("registers shared highlight.js languages once", () => {
    const highlighter = getHighlightJs();

    expect(highlighter.getLanguage("kotlin")).toBeTruthy();
    expect(highlighter.getLanguage("dart")).toBeTruthy();
    expect(highlighter.getLanguage("dockerfile")).toBeTruthy();
    expect(highlighter.getLanguage("toml")).toBeTruthy();
    expect(highlighter.getLanguage("powershell")).toBeTruthy();
    expect(highlighter.getLanguage("graphql")).toBeTruthy();
    expect(highlighter.getLanguage("nix")).toBeTruthy();
    expect(highlighter.getLanguage("nginx")).toBeTruthy();
    expect(highlighter.getLanguage("apache")).toBeTruthy();
    expect(highlighter.getLanguage("puppet")).toBeTruthy();
  });

  it("highlights newly supported snippet languages", () => {
    const highlighted = highlightCodeSnippet(
      "{pkgs, ...}: { services.nginx.enable = true; }",
      "nix"
    );

    expect(highlighted).toContain("hljs");
  });

  it("detects script-style Svelte snippets as code instead of plain markup", () => {
    const highlighted = highlightCodeSnippet('import {writable} from "svelte/store"', "svelte");

    expect(highlighted).toContain("hljs-keyword");
    expect(highlighted).toContain("hljs-string");
  });

  it("loads CodeMirror support for newly added file-view languages", async () => {
    await expect(loadCodeMirrorLanguageExtensions("src/main.kt", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("src/main.dart", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("Dockerfile", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("Cargo.toml", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("scripts/setup.ps1", null)).resolves.toHaveLength(
      1
    );
    await expect(loadCodeMirrorLanguageExtensions("src/index.php", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("nix/flake.nix", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("Cargo.lock", null)).resolves.toHaveLength(1);
    await expect(loadCodeMirrorLanguageExtensions("infra/nginx.conf", null)).resolves.toHaveLength(
      1
    );
    await expect(loadCodeMirrorLanguageExtensions("puppet/site.pp", null)).resolves.toHaveLength(1);
  });
});
