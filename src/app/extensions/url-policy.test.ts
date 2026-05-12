import {describe, expect, it} from "vitest"
import {isSecureEmbeddableUrl} from "./url-policy"

describe("extension URL policy", () => {
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
