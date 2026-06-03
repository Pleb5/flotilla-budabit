import { describe, expect, it } from "vitest";
import {
  getGitRefMismatch,
  isDisplayableGitRef,
  isPeeledTagName,
  normalizeGitRefName,
} from "./branch-ref";

describe("normalizeGitRefName", () => {
  it("preserves slash-containing branch names", () => {
    expect(normalizeGitRefName("fix/ipk-builds")).toBe("fix/ipk-builds");
    expect(normalizeGitRefName("ci/nostr-release")).toBe("ci/nostr-release");
  });

  it("normalizes known git ref prefixes", () => {
    expect(normalizeGitRefName("refs/heads/fix/ipk-builds")).toBe("fix/ipk-builds");
    expect(normalizeGitRefName("refs/remotes/origin/ci/nostr-release")).toBe("ci/nostr-release");
    expect(normalizeGitRefName("origin/fix/ipk-builds")).toBe("fix/ipk-builds");
  });

  it("supports HEAD-style symbolic ref values", () => {
    expect(normalizeGitRefName("ref: refs/heads/main")).toBe("main");
    expect(normalizeGitRefName("ref: refs/heads/feature/x")).toBe("feature/x");
  });

  it("recognizes peeled tag names", () => {
    expect(isPeeledTagName("v0.2.0^{}")).toBe(true);
    expect(isPeeledTagName("refs/tags/v0.2.0^{}")).toBe(true);
    expect(isPeeledTagName("v0.2.0")).toBe(false);
  });

  it("hides peeled tags from displayable refs", () => {
    expect(isDisplayableGitRef({ name: "v0.2.0^{}", type: "tags" })).toBe(false);
    expect(isDisplayableGitRef({ name: "v0.2.0", type: "tags" })).toBe(true);
    expect(isDisplayableGitRef({ name: "fix/ipk-builds", type: "heads" })).toBe(true);
  });

  it("detects mismatched normalized refs", () => {
    expect(getGitRefMismatch("refs/heads/feature/x", "origin/feature/x")).toBeNull();
    expect(getGitRefMismatch("feature/x", "refs/heads/main")).toEqual({
      requested: "feature/x",
      actual: "main",
    });
    expect(getGitRefMismatch("feature/x", "")).toBeNull();
  });
});
