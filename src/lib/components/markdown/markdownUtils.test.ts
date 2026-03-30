import {describe, expect, it} from "vitest"
import {
  shortenUrl,
  shortenNostrUri,
  isMediaUrl,
  isStandaloneUrl,
  resolveNip05,
} from "./markdownUtils"

describe("markdownUtils", () => {
  describe("shortenUrl", () => {
    it("returns custom text when text differs from URL", () => {
      expect(shortenUrl("https://example.com/long/path", "Click here")).toBe("Click here")
    })

    it("returns domain only for root URLs", () => {
      expect(shortenUrl("https://example.com")).toBe("example.com")
      expect(shortenUrl("https://www.example.com")).toBe("example.com")
    })

    it("strips www from hostname", () => {
      expect(shortenUrl("https://www.github.com/user/repo")).toContain("github.com")
    })

    it("includes first path segment when path exists", () => {
      const result = shortenUrl("https://github.com/user/repo")
      expect(result).toMatch(/github\.com\/user/)
    })

    it("adds ellipsis when multiple path segments", () => {
      const result = shortenUrl("https://github.com/user/repo/branch")
      expect(result).toContain("/...")
    })

    it("truncates long path segments", () => {
      const longPath = "a".repeat(25)
      const result = shortenUrl(`https://example.com/${longPath}`)
      expect(result).toContain("...")
      expect(result.length).toBeLessThan(50)
    })

    it("handles invalid URLs by truncating long strings", () => {
      const longInvalid = "not-a-valid-url-" + "x".repeat(50)
      const result = shortenUrl(longInvalid)
      expect(result).toContain("...")
      expect(result.length).toBeLessThan(longInvalid.length)
    })

    it("returns short invalid URLs as-is", () => {
      const shortInvalid = "not-a-url"
      expect(shortenUrl(shortInvalid)).toBe(shortInvalid)
    })
  })

  describe("shortenNostrUri", () => {
    it("formats as first 8 and last 8 chars of tagType+content", () => {
      const content = "npub1acdef0ghjkmnpqrstuvwxyz023456789"
      const result = shortenNostrUri("", content)
      expect(result).toBe("npub1acd:23456789")
    })

    it("prepends tagType to content before slicing", () => {
      const result = shortenNostrUri("npub", "1acdef0gh")
      expect(result).toMatch(/^.{8}:.{8}$/)
    })
  })

  describe("isMediaUrl", () => {
    it("returns true for image extensions", () => {
      expect(isMediaUrl("https://example.com/photo.jpg")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.jpeg")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.png")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.gif")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.webp")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.svg")).toBe(true)
    })

    it("returns true for video extensions", () => {
      expect(isMediaUrl("https://example.com/video.mp4")).toBe(true)
      expect(isMediaUrl("https://example.com/video.webm")).toBe(true)
      expect(isMediaUrl("https://example.com/video.mov")).toBe(true)
    })

    it("handles URLs with query strings", () => {
      expect(isMediaUrl("https://example.com/photo.jpg?size=large")).toBe(true)
    })

    it("returns false for non-media URLs", () => {
      expect(isMediaUrl("https://example.com/page.html")).toBe(false)
      expect(isMediaUrl("https://example.com/doc.pdf")).toBe(false)
      expect(isMediaUrl("https://example.com/")).toBe(false)
    })

    it("is case insensitive", () => {
      expect(isMediaUrl("https://example.com/photo.JPG")).toBe(true)
      expect(isMediaUrl("https://example.com/photo.PNG")).toBe(true)
    })
  })

  describe("isStandaloneUrl", () => {
    it("returns true when text is undefined", () => {
      expect(isStandaloneUrl(undefined, "https://example.com")).toBe(true)
    })

    it("returns true when text equals href", () => {
      expect(isStandaloneUrl("https://example.com", "https://example.com")).toBe(true)
    })

    it("returns true when trimmed text equals trimmed href", () => {
      expect(isStandaloneUrl("  https://example.com  ", "https://example.com")).toBe(true)
    })

    it("returns false when text differs from href", () => {
      expect(isStandaloneUrl("Click here", "https://example.com")).toBe(false)
    })
  })

  describe("resolveNip05", () => {
    it("returns null for identifiers without @", async () => {
      expect(await resolveNip05("npub123")).toBe(null)
      expect(await resolveNip05("")).toBe(null)
    })
  })
})
