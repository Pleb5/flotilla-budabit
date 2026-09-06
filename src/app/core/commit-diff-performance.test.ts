import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte", import.meta.url),
  "utf8",
)

describe("commit diff performance contracts", () => {
  it("defers offscreen file rows and bounds permalink anchor hashing", () => {
    expect(source).toContain("content-visibility: auto")
    expect(source.match(/class="commit-diff-row/g)).toHaveLength(2)
    expect(source).toContain("const DIFF_ANCHOR_CONCURRENCY = 16")
    expect(source).toContain("Math.min(DIFF_ANCHOR_CONCURRENCY, paths.length)")
    expect(source).not.toContain("Promise.all(paths.map")
  })

  it("uses precomputed file and aggregate statistics in the render path", () => {
    expect(source).toContain("stats: getChangeStats(change)")
    expect(source).toContain("const totalStats = $derived.by")
    expect(source).not.toContain("getFileStats(change.diffHunks)")
    expect(source).not.toContain("totalStats()")
  })

  it("preserves trailing padding when file headers overflow horizontally", () => {
    expect(source.match(/class="min-h-\[44px\] w-full min-w-max/g)).toHaveLength(2)
  })
})
