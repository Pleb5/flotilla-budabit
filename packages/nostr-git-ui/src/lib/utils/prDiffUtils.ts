import parseDiff from "parse-diff";

/** Worker/getDiffBetween output format */
export interface PrChangeInput {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  diffHunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    patches: Array<{ line: string; type: "+" | "-" | " " }>;
  }>;
}

export interface PrReviewDiffOptions {
  contextLines?: number;
  includeLines?: number[];
}

type PrDiffHunk = PrChangeInput["diffHunks"][number];
type PrPatch = PrDiffHunk["patches"][number];
type PatchEntry = {
  patch: PrPatch;
  oldCursor: number;
  newCursor: number;
  oldLine: number | null;
  newLine: number | null;
};

function countStats(hunks: PrChangeInput["diffHunks"]) {
  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks || []) {
    for (const patch of hunk.patches || []) {
      if (patch.type === "+") additions++;
      if (patch.type === "-") deletions++;
    }
  }

  return { additions, deletions };
}

function buildPatchEntries(hunk: PrDiffHunk): PatchEntry[] {
  const entries: PatchEntry[] = [];
  let oldCursor = hunk.oldStart;
  let newCursor = hunk.newStart;

  for (const patch of hunk.patches || []) {
    const entry: PatchEntry = {
      patch,
      oldCursor,
      newCursor,
      oldLine: null,
      newLine: null,
    };

    if (patch.type === "+") {
      entry.newLine = newCursor;
      newCursor++;
    } else if (patch.type === "-") {
      entry.oldLine = oldCursor;
      oldCursor++;
    } else {
      entry.oldLine = oldCursor;
      entry.newLine = newCursor;
      oldCursor++;
      newCursor++;
    }

    entries.push(entry);
  }

  return entries;
}

function getVisibleLine(entry: PatchEntry) {
  return entry.newLine ?? entry.oldLine;
}

function buildChunkContent(oldStart: number, oldLines: number, newStart: number, newLines: number) {
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

function entryToParseDiffChange(entry: PatchEntry): parseDiff.Change {
  const content = entry.patch.line || "";

  if (entry.patch.type === "+") {
    return { type: "add", add: true, ln: entry.newLine ?? entry.newCursor, content };
  }

  if (entry.patch.type === "-") {
    return { type: "del", del: true, ln: entry.oldLine ?? entry.oldCursor, content };
  }

  return {
    type: "normal",
    normal: true,
    ln1: entry.oldLine ?? entry.oldCursor,
    ln2: entry.newLine ?? entry.newCursor,
    content,
  };
}

function hunkToParseDiffChunk(hunk: PrDiffHunk): parseDiff.Chunk {
  const entries = buildPatchEntries(hunk);

  return {
    content: buildChunkContent(hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines),
    changes: entries.map(entryToParseDiffChange),
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
  };
}

function sliceEntriesToChunk(
  entries: PatchEntry[],
  start: number,
  end: number
): parseDiff.Chunk | null {
  const slice = entries.slice(start, end + 1);
  if (slice.length === 0) return null;

  let oldLines = 0;
  let newLines = 0;

  for (const entry of slice) {
    if (entry.patch.type !== "+") oldLines++;
    if (entry.patch.type !== "-") newLines++;
  }

  const oldStart = slice[0].oldCursor;
  const newStart = slice[0].newCursor;

  return {
    content: buildChunkContent(oldStart, oldLines, newStart, newLines),
    changes: slice.map(entryToParseDiffChange),
    oldStart,
    oldLines,
    newStart,
    newLines,
  };
}

function compactHunk(
  hunk: PrDiffHunk,
  { contextLines, includeLines }: Required<PrReviewDiffOptions>
): parseDiff.Chunk[] {
  const entries = buildPatchEntries(hunk);
  if (entries.length === 0) return [];

  const includeLineSet = new Set(includeLines);
  const ranges: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const visibleLine = getVisibleLine(entry);
    const isChange = entry.patch.type !== " ";
    const isIncludedLine = visibleLine !== null && includeLineSet.has(visibleLine);

    if (!isChange && !isIncludedLine) continue;

    ranges.push({
      start: Math.max(0, index - contextLines),
      end: Math.min(entries.length - 1, index + contextLines),
    });
  }

  if (ranges.length === 0) return [];

  const mergedRanges: Array<{ start: number; end: number }> = [ranges[0]];

  for (const range of ranges.slice(1)) {
    const current = mergedRanges[mergedRanges.length - 1];
    if (range.start <= current.end + 1) {
      current.end = Math.max(current.end, range.end);
      continue;
    }

    mergedRanges.push({ ...range });
  }

  return mergedRanges
    .map((range) => sliceEntriesToChunk(entries, range.start, range.end))
    .filter((chunk): chunk is parseDiff.Chunk => chunk !== null);
}

function createParseDiffFile(change: PrChangeInput, chunks: parseDiff.Chunk[]): parseDiff.File {
  const path = change.path;
  const from = change.status === "added" ? "/dev/null" : path;
  const to = change.status === "deleted" ? "/dev/null" : path;
  const { additions, deletions } = countStats(change.diffHunks);

  return { from, to, chunks, additions, deletions };
}

/** Convert PrChange (worker diffHunks format) to parse-diff File for DiffViewer */
export function prChangeToParseDiffFile(change: PrChangeInput): parseDiff.File {
  return createParseDiffFile(change, (change.diffHunks || []).map(hunkToParseDiffChunk));
}

export function prChangeToReviewParseDiffFile(
  change: PrChangeInput,
  options: PrReviewDiffOptions = {}
): parseDiff.File {
  const normalizedOptions: Required<PrReviewDiffOptions> = {
    contextLines: Math.max(0, Math.floor(options.contextLines ?? 3)),
    includeLines: Array.from(
      new Set((options.includeLines || []).filter((line) => Number.isFinite(line) && line > 0))
    ).sort((a, b) => a - b),
  };

  const chunks = (change.diffHunks || []).flatMap((hunk) => compactHunk(hunk, normalizedOptions));

  if (chunks.length === 0 && (change.diffHunks || []).length > 0) {
    return prChangeToParseDiffFile(change);
  }

  return createParseDiffFile(change, chunks);
}
