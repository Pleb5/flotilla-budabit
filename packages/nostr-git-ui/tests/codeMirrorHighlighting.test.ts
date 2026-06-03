import { EditorState } from "@codemirror/state";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { loadCodeMirrorLanguageExtensions } from "../src/lib/utils/codeHighlight";

const renderHighlightedMarkup = async (filename: string, content: string) => {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const extensions = await loadCodeMirrorLanguageExtensions(filename, null);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      extensions: [...extensions, syntaxHighlighting(defaultHighlightStyle, { fallback: true })],
    }),
  });

  const markup = parent.innerHTML;

  view.destroy();
  parent.remove();

  return markup;
};

describe("CodeMirror language rendering", () => {
  it("renders highlighted spans for Cargo.lock content", async () => {
    const markup = await renderHighlightedMarkup(
      "Cargo.lock",
      `version = 4\n\n[[package]]\nname = "budabit"\nversion = "1.0.0"\n`
    );

    expect(markup).toContain("<span");
  });

  it("renders highlighted spans for nix content", async () => {
    const markup = await renderHighlightedMarkup(
      "flake.nix",
      `{\n  description = "Budabit";\n  outputs = {self, nixpkgs}: {};\n}\n`
    );

    expect(markup).toContain("<span");
  });
});
