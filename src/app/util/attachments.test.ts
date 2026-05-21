import {describe, expect, it} from "vitest"
import {
  appendAttachmentUrlsToContent,
  getEventAttachments,
  isPreviewableAttachment,
  makeAttachmentImetaTag,
  stripAttachmentUrlLines,
} from "./attachments"

const hash = "a".repeat(64)
const url = `https://blossom.example/${hash}.pdf`

describe("attachment helpers", () => {
  it("serializes attachments as URL lines and imeta tags", () => {
    const attachment = {
      url,
      sha256: hash,
      name: "NIP-B7.md",
      size: 1234,
      type: "text/markdown",
    }

    expect(appendAttachmentUrlsToContent("See attached", [attachment])).toBe(
      `See attached\n${url}`,
    )
    expect(makeAttachmentImetaTag(attachment)).toEqual([
      "imeta",
      "m text/markdown",
      "name NIP-B7.md",
      `ox ${hash}`,
      "size 1234",
      `url ${url}`,
      `x ${hash}`,
    ])
  })

  it("parses imeta attachments and strips only standalone attachment URL lines", () => {
    const event = {
      tags: [makeAttachmentImetaTag({url, sha256: hash, name: "NIP-B7.md"})],
    } as any
    const attachments = getEventAttachments(event)

    expect(attachments).toEqual([expect.objectContaining({url, sha256: hash, name: "NIP-B7.md"})])
    expect(stripAttachmentUrlLines(`hello\n${url}\ninline ${url}`, attachments)).toBe(
      `hello\ninline ${url}`,
    )
  })

  it("detects previewable image and video attachments", () => {
    expect(isPreviewableAttachment({url: "https://example.com/photo.png"})).toBe(true)
    expect(isPreviewableAttachment({url: "https://example.com/file.pdf"})).toBe(false)
    expect(isPreviewableAttachment({url: "https://example.com/blob", type: "video/mp4"})).toBe(
      true,
    )
  })
})
