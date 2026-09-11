import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {getArticleDetails, getArticlePreview, isArticleKind} from "./articles"

const event = (overrides: Partial<TrustedEvent> = {}) =>
  ({
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    sig: "c".repeat(128),
    kind: 30023,
    created_at: 1705320000,
    tags: [],
    content: "## A heading\n\nSome **formatted** content.",
    ...overrides,
  }) as TrustedEvent

describe("long-form articles", () => {
  it("recognizes published articles and drafts, not arbitrary unknown events", () => {
    expect(isArticleKind(30023)).toBe(true)
    expect(isArticleKind(30024)).toBe(true)
    expect(isArticleKind(30123)).toBe(false)
  })

  it("reads article metadata and the original publication date", () => {
    expect(
      getArticleDetails(
        event({
          tags: [
            ["title", "An article"],
            ["summary", "A summary"],
            ["image", "https://example.com/cover.png"],
            ["published_at", "1705233600"],
          ],
        }),
      ),
    ).toMatchObject({
      title: "An article",
      summary: "A summary",
      preview: "A summary",
      image: "https://example.com/cover.png",
      publishedAt: 1705233600,
      draft: false,
    })
  })

  it("uses useful defaults and draft save time", () => {
    expect(getArticleDetails(event())).toMatchObject({
      title: "Untitled article",
      publishedAt: 1705320000,
      image: "",
    })
    expect(getArticleDetails(event({kind: 30024, tags: [["published_at", "1"]]}))).toMatchObject({
      title: "Untitled draft",
      draft: true,
      publishedAt: 1705320000,
    })
  })

  it.each(["", "yesterday", "1705233600junk", "-1", "Infinity", "8640000000001"])(
    "ignores invalid published_at %s",
    value => {
      expect(getArticleDetails(event({tags: [["published_at", value]]})).publishedAt).toBe(
        1705320000,
      )
    },
  )

  it.each([
    "",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//example.com/a.png",
    "https://user:password@example.com/image",
  ])("does not use unsafe or missing cover URL %s", value => {
    expect(getArticleDetails(event({tags: [["image", value]]})).image).toBe("")
  })

  it("creates compact plain-text previews without mounting nested content", () => {
    expect(
      getArticlePreview(
        "# Title\n\nSome **bold** and [linked](https://example.com) text.\n\n- One\n- Two\n\n```js\nconst n = 1\n```",
      ),
    ).toBe("Title Some bold and linked text. One Two const n = 1")
    expect(getArticlePreview("<script>alert(1)</script>\n\nReadable text")).toBe("Readable text")
    expect(getArticlePreview("long ".repeat(500))).toHaveLength(300)
    expect(getArticleDetails(event({tags: [["summary", "s".repeat(500)]]})).preview).toHaveLength(
      301,
    )
  })
})
