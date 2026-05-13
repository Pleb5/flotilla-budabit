import {describe, expect, it} from "vitest"

import {getDisplayedRepoWebUrls} from "./repo-web-urls"

describe("getDisplayedRepoWebUrls", () => {
  it("returns only web URLs present on the repo announcement data", () => {
    expect(
      getDisplayedRepoWebUrls({
        web: ["https://example.com/owner/repo"],
      }),
    ).toEqual(["https://example.com/owner/repo"])
  })

  it("does not synthesize Budabit or GitWorkshop URLs when the announcement has none", () => {
    const urls = getDisplayedRepoWebUrls({
      web: [],
    })

    expect(urls).toEqual([])
    expect(urls).not.toContain("https://gitworkshop.dev/npub1example/repo")
    expect(urls).not.toContain("https://budabit.club/git/naddr1example")
  })

  it("returns a defensive copy of announcement web URLs", () => {
    const repo = {web: ["https://example.com/repo"]}
    const urls = getDisplayedRepoWebUrls(repo)

    urls.push("https://gitworkshop.dev/npub1example/repo")

    expect(repo.web).toEqual(["https://example.com/repo"])
  })
})
