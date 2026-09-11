import {describe, expect, it, vi, beforeEach} from "vitest"
import {createRenderers} from "./markdownRenderers"
import {nip19} from "nostr-tools"
import {naddrEncode} from "nostr-tools/nip19"
import {Marked} from "marked"
import {getEncodedToken} from "@cashu/cashu-ts"

vi.mock("nostr-tools", () => ({
  nip19: {
    decode: vi.fn(),
  },
}))

vi.mock("@nostr-git/ui", () => ({
  normalizeHighlightLanguage: vi.fn((lang?: string | null) => lang || "plaintext"),
  highlightCodeSnippet: vi.fn((text: string) => `<span class="hljs">${text}</span>`),
}))

describe("markdownRenderers", () => {
  const makeCashuToken = () =>
    getEncodedToken({
      mint: "https://mint.example",
      proofs: [
        {
          id: "009a1f293253e41e",
          amount: 2,
          secret: "test-secret",
          C: `02${"a".repeat(64)}`,
        },
      ],
    })

  beforeEach(() => {
    vi.mocked(nip19.decode).mockReset()
  })
  describe("createRenderers", () => {
    it("does not render images or media previews when media is disabled", async () => {
      const renderers = createRenderers({showMedia: false, event: {id: "event-id"} as any})
      expect(renderers.image!({href: "https://example.com/image.png", text: "Image"} as any)).toBe(
        "",
      )
      const parser = new Marked({renderer: renderers})
      const html = await parser.parse("https://example.com/image.png")
      expect(html).toContain('<a href="https://example.com/image.png"')
      expect(html).not.toContain("markdown-link-block-placeholder")
    })

    it.each(["note", "nevent", "naddr"])(
      "keeps %s links without quote context inside Budabit",
      type => {
        vi.mocked(nip19.decode).mockReturnValue({type, data: {kind: 30023}} as any)
        const fullId = `${type}1qqqqqq`
        const html = createRenderers().link!({href: `nostr:${fullId}`, text: "Event"} as any)
        expect(html).toContain(`href="/${fullId}"`)
        expect(html).not.toContain("coracle.social")
        expect(html).not.toContain('target="_blank"')
      },
    )

    const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    const communityNaddr = naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
      relays: ["wss://relay.example"],
    })

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
      expect(html).toContain("data-markdown-image")
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

    it("renders Cashu links as token placeholders", () => {
      const renderers = createRenderers()
      const token = makeCashuToken()

      const html = renderers.link!({href: token, text: "Redeem"} as any)

      expect(html).toContain("markdown-cashu-placeholder")
      expect(html).toContain(`data-token="${encodeURIComponent(token)}"`)
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

    it("keeps media URL inline in normal link rendering", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const token = {
        href: "https://example.com/photo.jpg",
        text: "https://example.com/photo.jpg",
      }
      const html = renderers.link!(token as any)
      expect(html).not.toContain("markdown-link-block-placeholder")
      expect(html).toContain('href="https://example.com/photo.jpg"')
    })

    it("renders standalone URL paragraphs as link block placeholders", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const token = {
        tokens: [
          {
            type: "link",
            href: "https://example.com/photo.jpg",
            text: "https://example.com/photo.jpg",
          },
        ],
      }

      const html = renderers.paragraph!.call({parser: {parseInline: vi.fn()}} as any, token as any)

      expect(html).toContain("markdown-link-block-placeholder")
      expect(html).toContain('data-url="https://example.com/photo.jpg"')
      expect(html).toContain('data-event-id="evt123"')
      expect(html).not.toContain("<p>")
    })

    it("renders final line URL as text plus compact link preview", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const parser = {parseInline: vi.fn(() => "Hivetalk event:")}
      const token = {
        tokens: [
          {type: "text", text: "Hivetalk event:", raw: "Hivetalk event:"},
          {type: "br", raw: "\n"},
          {
            type: "link",
            href: "https://honey.hivetalk.org/dashboard/abc",
            text: "https://honey.hivetalk.org/dashboard/abc",
          },
        ],
      }

      const html = renderers.paragraph!.call({parser} as any, token as any)

      expect(parser.parseInline).toHaveBeenCalledWith([token.tokens[0]])
      expect(html).toContain("<p>Hivetalk event:</p>")
      expect(html).toContain("markdown-link-block-placeholder")
      expect(html).toContain('data-url="https://honey.hivetalk.org/dashboard/abc"')
    })

    it("renders standalone middle-line media URLs as link block placeholders", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const parser = {
        parseInline: vi.fn(tokens => tokens.map((token: any) => token.text).join("")),
      }
      const token = {
        tokens: [
          {type: "text", text: "before", raw: "before"},
          {type: "br", raw: "\n"},
          {
            type: "link",
            href: "https://example.com/photo.png",
            text: "https://example.com/photo.png",
          },
          {type: "br", raw: "\n"},
          {type: "text", text: "after", raw: "after"},
        ],
      }

      const html = renderers.paragraph!.call({parser} as any, token as any)

      expect(html).toContain("<p>before</p>")
      expect(html).toContain('data-url="https://example.com/photo.png"')
      expect(html).toContain("<p>after</p>")
      expect(html).toContain("markdown-link-block-placeholder")
    })

    it("keeps inline URL paragraphs as prose", () => {
      const mockEvent = {id: "evt123"} as any
      const renderers = createRenderers({event: mockEvent})
      const parser = {
        parseInline: vi.fn(() => 'Go to <a href="https://budabit.club">budabit.club</a> and apply'),
      }
      const token = {
        tokens: [
          {type: "text", text: "Go to ", raw: "Go to "},
          {type: "link", href: "https://budabit.club", text: "https://budabit.club"},
          {type: "text", text: " and apply", raw: " and apply"},
        ],
      }

      const html = renderers.paragraph!.call({parser} as any, token as any)

      expect(html).toBe('<p>Go to <a href="https://budabit.club">budabit.club</a> and apply</p>')
      expect(html).not.toContain("markdown-link-block-placeholder")
    })

    it("integrates with marked for prose links and final-line previews", async () => {
      const mockEvent = {id: "evt123"} as any
      const marked = new Marked({breaks: true, renderer: createRenderers({event: mockEvent})})

      const prose = await marked.parse("Go to https://budabit.club and apply")
      const preview = await marked.parse(
        "Hivetalk event:\nhttps://honey.hivetalk.org/dashboard/abc",
      )

      expect(prose).toContain("budabit.club")
      expect(prose).not.toContain("markdown-link-block-placeholder")
      expect(preview).toContain("<p>Hivetalk event:</p>")
      expect(preview).toContain("markdown-link-block-placeholder")
      expect(preview).toContain('data-url="https://honey.hivetalk.org/dashboard/abc"')
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

    it("renders a community naddr link as an exact pointer placeholder", () => {
      const renderers = createRenderers()
      const html = renderers.link!({href: communityNaddr, text: "Community"} as any)

      expect(html).toContain("markdown-community-placeholder")
      expect(html).toContain(`data-naddr="${communityNaddr}"`)
      expect(html).not.toContain("data-pubkey")
    })

    it("renders nprofile link as profile placeholder", () => {
      const renderers = createRenderers()
      const pubkey = "b".repeat(64)
      const relays = ["wss://profile.example.com"]
      vi.mocked(nip19.decode).mockReturnValue({
        type: "nprofile",
        data: {pubkey, relays},
      } as any)

      const token = {
        href: "nprofile1acdef0ghjkmnpqrstuvwxyz023456",
        text: "Profile",
      }
      const html = renderers.link!(token as any)
      expect(html).toContain("nostr-profile-placeholder")
      expect(html).toContain(`data-pubkey="${pubkey}"`)
      expect(html).toContain(`data-relays="${encodeURIComponent(JSON.stringify(relays))}"`)
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
