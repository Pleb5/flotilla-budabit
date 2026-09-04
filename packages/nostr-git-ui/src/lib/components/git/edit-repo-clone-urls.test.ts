import { describe, expect, it } from "vitest";

import { getEditableRepoCloneUrls, mergePreservedNostrCloneUrls } from "./edit-repo-clone-urls";

describe("edit repository clone URLs", () => {
  it("hides direct Nostr URLs from the editable values case-insensitively", () => {
    expect(
      getEditableRepoCloneUrls([
        "https://github.com/example/repo.git",
        "nostr://npub/repo",
        "NOSTR:naddr1repo",
      ])
    ).toEqual(["https://github.com/example/repo.git"]);
  });

  it("preserves mixed direct Nostr metadata after the editable primary URL", () => {
    expect(
      mergePreservedNostrCloneUrls(
        ["https://gitlab.com/example/repo.git"],
        ["NOSTR://npub/repo", "https://github.com/example/repo.git"]
      )
    ).toEqual(["https://gitlab.com/example/repo.git", "NOSTR://npub/repo"]);
  });

  it("preserves a Nostr-only clone tag during unrelated edits", () => {
    expect(mergePreservedNostrCloneUrls([], ["nostr:naddr1repo"])).toEqual(["nostr:naddr1repo"]);
  });

  it("keeps preserved metadata out of editable retry state", () => {
    const published = mergePreservedNostrCloneUrls(
      ["https://github.com/example/repo.git"],
      ["nostr:naddr1repo"]
    );

    expect(getEditableRepoCloneUrls(published)).toEqual([
      "https://github.com/example/repo.git",
    ]);
  });
});
