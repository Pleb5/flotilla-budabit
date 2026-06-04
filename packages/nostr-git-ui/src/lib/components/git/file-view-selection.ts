import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface FileLineSelection {
  start: number;
  end: number;
}

export const setSelectedLineEffect = StateEffect.define<FileLineSelection | null>();

const selectedLineDecoration = Decoration.line({ class: "cm-selected-line" });
const selectedTextDecoration = Decoration.mark({ class: "cm-selected-line-text" });

function clampLine(lineNumber: number, maxLine: number) {
  return Math.max(1, Math.min(lineNumber, maxLine));
}

export const selectedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, tr) => {
    const mappedDecorations = decorations.map(tr.changes);

    for (const effect of tr.effects) {
      if (!effect.is(setSelectedLineEffect)) continue;

      const selection = effect.value;
      if (!selection) return Decoration.none;

      const maxLine = tr.state.doc.lines;
      const start = clampLine(selection.start, maxLine);
      const end = clampLine(selection.end, maxLine);
      const builder = new RangeSetBuilder<Decoration>();

      for (
        let lineNumber = Math.min(start, end);
        lineNumber <= Math.max(start, end);
        lineNumber += 1
      ) {
        const line = tr.state.doc.line(lineNumber);
        builder.add(line.from, line.from, selectedLineDecoration);
        builder.add(line.from, line.to, selectedTextDecoration);
      }

      return builder.finish();
    }

    return mappedDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function buildSelectionHash(start: number | null, end: number | null) {
  if (!start) return "";
  return `#L${start}${end ? `-L${end}` : ""}`;
}

export function replaceSelectionHashWithoutScroll(hash: string, win: Window = window) {
  const url = new URL(win.location.href);
  url.hash = hash;
  win.history.replaceState(win.history.state, "", url);
  return url.hash;
}
