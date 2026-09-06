import { describe, expect, it } from "vitest";
import { getImportProvenance } from "./import-provenance";

describe("imported attribution display", () => {
  const event = (url: string) => ({
    tags: [
      ["imported", ""],
      ["proxy", url, "github"],
      ["source-author", "alice", "javascript:ignored"],
      ["original_date", "1704067200"],
    ],
  });
  it("shows source attribution separately from Nostr signatures", () => {
    expect(getImportProvenance(event("https://github.com/a/b/issues/1#issuecomment-2"))).toEqual({
      url: "https://github.com/a/b/issues/1#issuecomment-2",
      author: "alice",
      date: "2024-01-01",
    });
    expect(getImportProvenance({ tags: [] })).toBeUndefined();
  });
  it("does not turn forged provenance into unsafe outbound links", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://github.com.evil/a/b/issues/1",
      "https://github.com/a/b/issues/1?token=secret",
      "https://user:secret@github.com/a/b/issues/1",
    ]) {
      expect(getImportProvenance(event(url))).toBeUndefined();
    }
  });
});
