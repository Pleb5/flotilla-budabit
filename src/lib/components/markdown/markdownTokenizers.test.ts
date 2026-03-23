import {describe, expect, it, vi, beforeEach} from "vitest"
import {createEmailTokenizer, createNostrTokenizer} from "./markdownTokenizers"
import {nip19} from "nostr-tools"

vi.mock("nostr-tools", () => ({
  nip19: {
    decode: vi.fn(),
  },
}))

interface InlineTokenizerExtension {
  name: string
  level: "inline"
  start: (src: string) => number
  tokenizer: (src: string) => unknown
  renderer: (token: unknown) => string
}

describe("markdownTokenizers", () => {
  describe("createEmailTokenizer", () => {
    const emailTokenizer = createEmailTokenizer() as InlineTokenizerExtension

    it("has correct extension metadata", () => {
      expect(emailTokenizer.name).toBe("email")
      expect(emailTokenizer.level).toBe("inline")
    })

    it("finds email start index when email at start of src", () => {
      expect(emailTokenizer.start("user@example.com at start")).toBe(0)
      expect(emailTokenizer.start("no-email-here")).toBe(-1)
    })

    it("tokenizes valid email addresses", () => {
      const token = emailTokenizer.tokenizer("contact@domain.org")
      expect(token).toMatchObject({
        type: "email",
        raw: "contact@domain.org",
        text: "contact@domain.org",
        href: "mailto:contact@domain.org",
        isNip05: false,
      })
    })

    it("renders email as mailto link when not NIP-05", () => {
      const token = {
        type: "email",
        text: "user@example.com",
        href: "mailto:user@example.com",
        isNip05: false,
      }
      const html = emailTokenizer.renderer(token as any)
      expect(html).toContain('href="mailto:user@example.com"')
      expect(html).toContain("user@example.com")
      expect(html).toContain('class="link"')
    })

    it("renders NIP-05 as profile placeholder when pubkey present", () => {
      const token = {
        type: "email",
        text: "user@example.com",
        href: "mailto:user@example.com",
        isNip05: true,
        pubkey: "a".repeat(64),
      }
      const html = emailTokenizer.renderer(token as any)
      expect(html).toContain("nostr-profile-placeholder")
      expect(html).toContain('data-pubkey="' + "a".repeat(64) + '"')
    })
  })

  describe("createNostrTokenizer", () => {
    const getTokenizer = () => createNostrTokenizer() as InlineTokenizerExtension

    beforeEach(() => {
      vi.mocked(nip19.decode).mockReset()
    })

    it("has correct extension metadata", () => {
      const tokenizer = getTokenizer()
      expect(tokenizer.name).toBe("nostr")
      expect(tokenizer.level).toBe("inline")
    })

    it("finds nostr URI start index", () => {
      const tokenizer = getTokenizer()
      expect(tokenizer.start("check out nostr:note1abc123")).toBeGreaterThanOrEqual(0)
      expect(tokenizer.start("plain text")).toBe(-1)
    })

    it("tokenizes npub URIs", () => {
      const tokenizer = getTokenizer()
      const npub = "npub1acdef0ghjkmnpqrstuvwxyz023456789"
      const token = tokenizer.tokenizer(npub)
      expect(token).toBeDefined()
      expect(token).toMatchObject({type: "nostr"})
      expect((token as any).fullId).toMatch(/^npub1[ac-hj-np-z02-9]+$/)
    })

    it("tokenizes note1 URIs", () => {
      const tokenizer = getTokenizer()
      const noteId = "note1acdef0ghjkmnpqrstuvwxyz023456"
      const token = tokenizer.tokenizer(noteId)
      expect(token).toBeDefined()
      expect(token).toMatchObject({type: "nostr"})
      expect((token as any).fullId).toMatch(/^note1[ac-hj-np-z02-9]+$/)
    })

    it("tokenizes nostr: prefixed URIs", () => {
      const tokenizer = getTokenizer()
      const src = "nostr:npub1acdef0ghjkmnpqrstuvwxyz023456789"
      const token = tokenizer.tokenizer(src)
      expect(token).toBeDefined()
      expect((token as any).fullId).toContain("npub1")
    })

    it("renders npub as profile placeholder when pubkey in token", () => {
      const tokenizer = getTokenizer()
      vi.mocked(nip19.decode).mockReturnValue({
        type: "npub",
        data: "b".repeat(64),
      } as any)

      const token = {
        type: "nostr",
        fullId: "npub1abc123",
        userName: null,
        pubkey: "b".repeat(64),
      }
      const html = tokenizer.renderer(token as any)
      expect(html).toContain("nostr-profile-placeholder")
      expect(html).toContain('data-pubkey="' + "b".repeat(64) + '"')
    })

    it("renders note as quote placeholder when event provided", () => {
      const mockEvent = {id: "evt123"} as any
      const tokenizer = createNostrTokenizer({event: mockEvent}) as InlineTokenizerExtension
      vi.mocked(nip19.decode).mockReturnValue({
        type: "note",
        data: "noteid456",
      } as any)

      const token = {
        type: "nostr",
        fullId: "note1abc123",
        userName: null,
      }
      const html = tokenizer.renderer(token as any)
      expect(html).toContain("markdown-quote-placeholder")
      expect(html).toContain('data-type="note"')
      expect(html).toContain('data-id="noteid456"')
      expect(html).toContain('data-event-id="evt123"')
    })

    it("passes minimalQuote and depth to quote placeholder", () => {
      const mockEvent = {id: "evt1"} as any
      const tokenizer: InlineTokenizerExtension = createNostrTokenizer({
        event: mockEvent,
        minimalQuote: true,
        depth: 2,
        hideMediaAtDepth: 3,
      }) as InlineTokenizerExtension
      vi.mocked(nip19.decode).mockReturnValue({
        type: "note",
        data: "noteid",
      } as any)

      const token = {type: "nostr", fullId: "note1abc", userName: null}
      const html = tokenizer.renderer(token as any)
      expect(html).toContain('data-minimal="true"')
      expect(html).toContain('data-depth="2"')
      expect(html).toContain('data-hide-media="3"')
    })
  })
})
