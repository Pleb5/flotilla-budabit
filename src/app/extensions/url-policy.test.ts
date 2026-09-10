import {describe, expect, it} from "vitest"
import {isAllowedExtensionOrigin, isSecureEmbeddableUrl, REPO_TAB_SANDBOX} from "./url-policy"

describe("extension URL policy", () => {
  it("allows only explicit redirect origins and keeps popup sandbox restrictions", () => {
    expect(isAllowedExtensionOrigin("https://blossom.primal.net", "https://r2a.primal.net")).toBe(
      true,
    )
    for (const origin of [
      "https://primal.net.evil.example",
      "https://evil-primal.net",
      "http://r2a.primal.net",
      "https://r2a.primal.net:444",
      "null",
    ]) {
      expect(isAllowedExtensionOrigin("https://blossom.primal.net", origin)).toBe(false)
    }
    expect(isAllowedExtensionOrigin("https://other.example", "https://r2a.primal.net")).toBe(false)
    expect(REPO_TAB_SANDBOX).toContain("allow-popups")
    expect(REPO_TAB_SANDBOX).toContain("allow-downloads")
    expect(REPO_TAB_SANDBOX).not.toContain("allow-popups-to-escape-sandbox")
    expect(REPO_TAB_SANDBOX).not.toContain("allow-top-navigation")
  })
  it("allows HTTPS URLs", () => {
    expect(isSecureEmbeddableUrl("https://example.com/widget")).toBe(true)
  })

  it("allows localhost HTTP URLs for development", () => {
    expect(isSecureEmbeddableUrl("http://localhost:5173/widget")).toBe(true)
    expect(isSecureEmbeddableUrl("http://127.0.0.1:5173/widget")).toBe(true)
  })

  it("blocks remote HTTP URLs", () => {
    expect(isSecureEmbeddableUrl("http://example.com/widget")).toBe(false)
  })

  it("blocks invalid or non-web URLs", () => {
    expect(isSecureEmbeddableUrl("not a url")).toBe(false)
    expect(isSecureEmbeddableUrl("javascript:alert(1)")).toBe(false)
  })
})
