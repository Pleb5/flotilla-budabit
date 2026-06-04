import {describe, expect, it} from "vitest"

import {buildProviderUrl} from "../../src/git/provider-config.js"

describe("buildProviderUrl", () => {
  it("returns null when the base URL is missing", () => {
    expect(buildProviderUrl(undefined, "/settings")).toBeNull()
    expect(buildProviderUrl(null, "/settings")).toBeNull()
    expect(buildProviderUrl("", "/settings")).toBeNull()
  })

  it("builds a provider settings URL when both parts exist", () => {
    expect(buildProviderUrl("https://github.com/octo/repo/", "/settings")).toBe(
      "https://github.com/octo/repo/settings",
    )
  })
})
