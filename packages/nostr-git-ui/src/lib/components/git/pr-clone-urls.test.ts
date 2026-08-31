import { describe, expect, it } from "vitest";
import { validateForkCloneUrls } from "./pr-clone-urls";

describe("validateForkCloneUrls", () => {
  it("normalizes valid browser clone URLs", () => {
    expect(
      validateForkCloneUrls([
        " https://github.com/alice/repo.git ",
        "http://localhost:3000/alice/repo.git",
      ])
    ).toEqual({
      urls: ["https://github.com/alice/repo.git", "http://localhost:3000/alice/repo.git"],
      errors: ["", ""],
      success: true,
    });
  });

  it("rejects empty, unsupported, malformed, and duplicate URLs", () => {
    const result = validateForkCloneUrls([
      "",
      "git@github.com:alice/repo.git",
      "not a URL",
      "https://github.com/alice/repo.git",
      "https://github.com/alice/repo.git",
    ]);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      "Clone URL is required",
      "Enter a valid clone URL",
      "Enter a valid clone URL",
      "",
      "Duplicate clone URL",
    ]);
  });
});
