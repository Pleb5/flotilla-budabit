import { describe, expect, it } from "vitest";

import { prChangeToParseDiffFile, prChangeToReviewParseDiffFile } from "./prDiffUtils";

describe("PR diff conversion", () => {
  it("preserves compact hunk coordinates and precomputed statistics", () => {
    const file = prChangeToParseDiffFile({
      path: "src/example.ts",
      status: "modified",
      stats: { additions: 20, deletions: 10, total: 30 },
      diffHunks: [
        {
          oldStart: 8,
          oldLines: 2,
          newStart: 8,
          newLines: 2,
          patches: [
            { line: "old", type: "-" },
            { line: "new", type: "+" },
            { line: "context", type: " " },
          ],
        },
        {
          oldStart: 80,
          oldLines: 1,
          newStart: 80,
          newLines: 1,
          patches: [
            { line: "later old", type: "-" },
            { line: "later new", type: "+" },
          ],
        },
      ],
    });

    expect(file.chunks.map((chunk) => [chunk.oldStart, chunk.newStart])).toEqual([
      [8, 8],
      [80, 80],
    ]);
    expect(file.additions).toBe(20);
    expect(file.deletions).toBe(10);
  });

  it("preserves the old path for exact renames", () => {
    const file = prChangeToReviewParseDiffFile({
      path: "new-name.txt",
      oldPath: "old-name.txt",
      status: "renamed",
      stats: { additions: 0, deletions: 0, total: 0 },
      diffHunks: [],
    });

    expect(file.from).toBe("old-name.txt");
    expect(file.to).toBe("new-name.txt");
  });
});
