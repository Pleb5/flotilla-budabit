import {describe, expect, it, vi, beforeEach} from "vitest"
import {createRenderers} from "./markdownRenderers"
import {nip19} from "nostr-tools"

vi.mock("nostr-tools", () => ({
  nip19: {
    decode: vi.fn(),
  },
}))

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn((text: string) => ({
      value: `<span class="hljs">${text}</span>`,
    })),
  },
}))

describe("markdownRenderers", () => {
  beforeEach(() => {
    vi.mocked(nip19.decode).mockReset()
  })
  describe("createRenderers", () => {
    it("returns image renderer that produces img tag", () => {
      const renderers = createRenderers()
      const token = {
        href: "https://example.com/photo.jpg",
        title: "A photo",
        text: "Photo alt",
      }
      const html = renderers.image!(token as any)
      expect(html).toContain('src="https://example.com/photo.jpg"')
      expect(html).toContain('alt="Photo alt"')
      expect(html).toContain("rounded-lg")
    })

    it("uses title as alt when text is empty", () => {
      const renderers = createRenderers()
      const token = {
        href: "https://example.com/img.png",
        title: "Fallback title",
        text: "",
      }
      const html = renderers.image!(token as any)
      expect(html).toContain('alt="Fallback title"')
    })

    it("renders regular URL as link with display text", () => {
      const renderers = createRenderers()
      const token = {
        href: "https://github.com/user/repo",
        text: "View repo",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain('href="https://github.com/user/repo"')
      expect(html).toContain("View repo")
      expect(html).toContain('target="_blank"')
      expect(html).toContain("rel=")
    })

    it("shortens standalone URL display when text matches href", () => {
      const renderers = createRenderers()
      const url = "https://example.com/long/path"
      const token = {href: url, text: url}
      const html = renderers.link!(token as any)
      expect(html).toContain('href="' + url + '"')
      expect(html).toMatch(/example\.com/)
      const displayText = html.replace(/.*>([^<]+)<.*/, "$1")
      expect(displayText.length).toBeLessThan(url.length)
    })

    it("renders media URL as link block placeholder when event provided", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const token = {
        href: "https://example.com/photo.jpg",
        text: "https://example.com/photo.jpg",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain("markdown-link-block-placeholder")
      expect(html).toContain('data-url="https://example.com/photo.jpg"')
      expect(html).toContain('data-event-id="evt123"')
    })

    it("renders npub link as profile placeholder", () => {
      const renderers = createRenderers()
      const pubkey = "a".repeat(64)
      vi.mocked(nip19.decode).mockReturnValue({
        type: "npub",
        data: pubkey,
      } as any)

      const token = {
        href: "npub1acdef0ghjkmnpqrstuvwxyz023456789",
        text: "Profile",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain("nostr-profile-placeholder")
      expect(html).toContain(`data-pubkey="${pubkey}"`)
    })

    it("renders nprofile link as profile placeholder", () => {
      const renderers = createRenderers()
      const pubkey = "b".repeat(64)
      vi.mocked(nip19.decode).mockReturnValue({
        type: "nprofile",
        data: {pubkey},
      } as any)

      const token = {
        href: "nprofile1acdef0ghjkmnpqrstuvwxyz023456",
        text: "Profile",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain("nostr-profile-placeholder")
      expect(html).toContain(`data-pubkey="${pubkey}"`)
    })

    it("renders note as quote placeholder when event provided", () => {
      const mockEvent = {id: "evt1"} as any
      const renderers = createRenderers({event: mockEvent})
      vi.mocked(nip19.decode).mockReturnValue({
        type: "note",
        data: "noteid123",
      } as any)

      const token = {
        href: "note1acdef0ghjkmnpqrstuvwxyz023456",
        text: "Note",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain("markdown-quote-placeholder")
      expect(html).toContain('data-type="note"')
      expect(html).toContain('data-id="noteid123"')
    })

    it("renders code with syntax highlighting", () => {
      const renderers = createRenderers()
      const token = {
        text: "const x = 1",
        lang: "javascript",
      }
      const html = renderers.code!(token as any)
      expect(html).toContain("language-javascript")
      expect(html).toContain("hljs")
      expect(html).toContain("const x = 1")
    })

    it("uses plaintext when lang is empty", () => {
      const renderers = createRenderers()
      const token = {
        text: "raw code",
        lang: "",
      }
      const html = renderers.code!(token as any)
      expect(html).toContain("language-plaintext")
    })

    it("renders ordered list", () => {
      const renderers = createRenderers()
      const token = {
        ordered: true,
        items: [
          {tokens: [{type: "text", raw: "First", text: "First"}]},
          {tokens: [{type: "text", raw: "Second", text: "Second"}]},
        ],
      }
      const parser = {parse: vi.fn((tokens: any[]) => tokens.map((t: any) => t.text).join(""))}
      const html = renderers.list!.call({parser} as any, token as any)
      expect(html).toContain("<ol>")
      expect(html).toContain("</ol>")
      expect(html).toContain("<li>")
      expect(html).toContain("</li>")
    })

    it("renders unordered list", () => {
      const renderers = createRenderers()
      const token = {
        ordered: false,
        items: [{tokens: [{type: "text", raw: "Item", text: "Item"}]}],
      }
      const parser = {parse: vi.fn((tokens: any[]) => tokens.map((t: any) => t.text).join(""))}
      const html = renderers.list!.call({parser} as any, token as any)
      expect(html).toContain("<ul>")
      expect(html).toContain("</ul>")
    })
  })
})
