import {describe, expect, it} from "vitest"
import {
  suggestRepoIdentifier,
  validateRepoDisplayName,
  validateRepoIdentifier,
} from "../../src/utils/repo-identifier.js"

describe("new repository identifiers", () => {
  it("suggests a deterministic slug rather than a suffixed identity", () => {
    expect(suggestRepoIdentifier("My Great Repo!")).toBe("my-great-repo")
    expect(suggestRepoIdentifier(" My -- Great Repo! ")).toBe("my-great-repo")
    expect(suggestRepoIdentifier("日本語")).toBe("")
    expect(validateRepoDisplayName("日本語 with spaces 🎉")).toBeUndefined()
  })
  it.each([
    "",
    "../repo",
    "a/b",
    "a\\b",
    "%2e%2e",
    "repo.git",
    "..",
    ".hidden",
    "a..b",
    "a b",
    "a".repeat(101),
  ])("rejects unsafe new identifier %s", value => {
    expect(validateRepoIdentifier(value)).toBeTruthy()
  })
  it.each(["repo", "Repo.Case", "my-repo", "repo_1"])("accepts %s without normalization", value => {
    expect(validateRepoIdentifier(value)).toBeUndefined()
  })
})
