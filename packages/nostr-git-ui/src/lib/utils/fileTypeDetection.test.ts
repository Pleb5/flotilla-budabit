import { describe, expect, it } from "vitest";

import { detectFileType } from "./fileTypeDetection";

describe("file type detection", () => {
  it("prefers the file extension for svelte files", () => {
    const detected = detectFileType(
      "Dialog.svelte",
      '<script lang="ts">\nimport cx from "classnames"\n</script>\n\n<div>{foo}</div>'
    );

    expect(detected.category).toBe("text");
    expect(detected.language).toBe("svelte");
    expect(detected.icon).toBe("FileCode");
  });
});
