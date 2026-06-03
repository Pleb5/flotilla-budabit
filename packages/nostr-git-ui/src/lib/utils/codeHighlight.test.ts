import { describe, expect, it } from "vitest";

import {
  getHighlightLanguageForPath,
  highlightCodeLines,
  highlightCodeSnippet,
  loadCodeMirrorLanguageExtensions,
} from "./codeHighlight";

describe("code highlighting helpers", () => {
  it("keeps svelte file paths mapped to the svelte grammar", () => {
    expect(getHighlightLanguageForPath("src/App.svelte")).toBe("svelte");
  });

  it("highlights svelte directives and markup", () => {
    expect(highlightCodeSnippet("{#if contentPreview}", "svelte")).toContain("hljs-keyword");
    expect(highlightCodeSnippet('<IconComponent class="x" />', "svelte")).toContain("hljs-tag");
  });

  it("falls back to script highlighting for script-only svelte snippets", () => {
    const highlighted = highlightCodeSnippet("const count = $state(0)", "svelte");

    expect(highlighted).toContain("hljs-keyword");
    expect(highlighted).toContain("hljs-number");
  });

  it("tokenizes whole svelte snippets before splitting them into lines", () => {
    const highlighted = highlightCodeLines(
      ['<script lang="ts">', 'import {writable} from "svelte/store"', "</script>"],
      "svelte"
    );

    expect(highlighted).toHaveLength(3);
    expect(highlighted[0]).toContain("hljs-tag");
    expect(highlighted[1]).toContain("hljs-keyword");
    expect(highlighted[1]).toContain("hljs-string");
  });

  it("detects multiline svelte script fragments even when the first line is partial", () => {
    const highlighted = highlightCodeLines(
      [
        '} from "@lucide/svelte"',
        'import {page} from "$app/stores"',
        'import PageContent from "@src/lib/components/PageContent.svelte"',
      ],
      "svelte"
    );

    expect(highlighted[1]).toContain("hljs-keyword");
    expect(highlighted[1]).toContain("hljs-string");
  });

  it("loads CodeMirror support for svelte files", async () => {
    await expect(loadCodeMirrorLanguageExtensions("src/App.svelte", null)).resolves.toHaveLength(1);
  });
});
