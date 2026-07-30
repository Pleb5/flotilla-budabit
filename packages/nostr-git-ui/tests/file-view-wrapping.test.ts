import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  selectedLineField,
  setSelectedLineEffect,
} from "../src/lib/components/git/file-view-selection";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function getDecoratedLines(view: EditorView) {
  const lines = new Set<number>();
  const decorations = view.state.field(selectedLineField);

  decorations.between(0, view.state.doc.length, (from) => {
    lines.add(view.state.doc.lineAt(from).number);
  });

  return Array.from(lines).sort((a, b) => a - b);
}

describe("file view line wrapping", () => {
  it("reconfigures native wrapping without changing logical lines or selection", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const baseExtensions = [selectedLineField];
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "first\nsecond line with long content\nthird\nfourth",
        extensions: baseExtensions,
      }),
    });
    views.push(view);

    const selectionFrom = view.state.doc.line(2).from;
    const selectionTo = view.state.doc.line(3).to;
    view.dispatch({
      selection: EditorSelection.single(selectionFrom, selectionTo),
      effects: setSelectedLineEffect.of({ start: 2, end: 3 }),
    });

    view.dispatch({
      effects: StateEffect.reconfigure.of([...baseExtensions, EditorView.lineWrapping]),
    });

    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    expect(view.state.doc.lines).toBe(4);
    expect(view.state.selection.main.from).toBe(selectionFrom);
    expect(view.state.selection.main.to).toBe(selectionTo);
    expect(getDecoratedLines(view)).toEqual([2, 3]);

    view.dispatch({ effects: StateEffect.reconfigure.of(baseExtensions) });

    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    expect(view.state.doc.lines).toBe(4);
    expect(getDecoratedLines(view)).toEqual([2, 3]);
  });
});
