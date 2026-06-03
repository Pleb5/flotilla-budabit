import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";

import {
  buildSelectionHash,
  replaceSelectionHashWithoutScroll,
  selectedLineField,
  setSelectedLineEffect,
} from "../src/lib/components/git/file-view-selection";

function getDecoratedLines(state: EditorState) {
  const lines = new Set<number>();
  const decorations = state.field(selectedLineField);

  decorations.between(0, state.doc.length, (from) => {
    lines.add(state.doc.lineAt(from).number);
  });

  return Array.from(lines).sort((a, b) => a - b);
}

describe("file view line selection helpers", () => {
  it("decorates each selected line in the current range", () => {
    let state = EditorState.create({
      doc: "first\nsecond\nthird\nfourth",
      extensions: [selectedLineField],
    });

    state = state.update({
      effects: setSelectedLineEffect.of({ start: 2, end: 3 }),
    }).state;

    expect(getDecoratedLines(state)).toEqual([2, 3]);
  });

  it("clamps out-of-bounds ranges and clears decorations", () => {
    let state = EditorState.create({
      doc: "first\nsecond\nthird",
      extensions: [selectedLineField],
    });

    state = state.update({
      effects: setSelectedLineEffect.of({ start: -5, end: 99 }),
    }).state;

    expect(getDecoratedLines(state)).toEqual([1, 2, 3]);

    state = state.update({ effects: setSelectedLineEffect.of(null) }).state;

    expect(getDecoratedLines(state)).toEqual([]);
  });

  it("updates the URL hash without firing hashchange", () => {
    window.history.replaceState({}, "", "/c/test/git/repo/code?path=README.md");

    let hashChanges = 0;
    const onHashChange = () => {
      hashChanges += 1;
    };

    window.addEventListener("hashchange", onHashChange);
    replaceSelectionHashWithoutScroll("#L7-L17");
    window.removeEventListener("hashchange", onHashChange);

    expect(window.location.pathname).toBe("/c/test/git/repo/code");
    expect(window.location.search).toBe("?path=README.md");
    expect(window.location.hash).toBe("#L7-L17");
    expect(hashChanges).toBe(0);
  });

  it("builds selection hashes for permalink ranges", () => {
    expect(buildSelectionHash(7, 17)).toBe("#L7-L17");
    expect(buildSelectionHash(null, null)).toBe("");
  });
});
