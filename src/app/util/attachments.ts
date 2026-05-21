import {getTagValue, getTags, tagsFromIMeta, type TrustedEvent} from "@welshman/util"
import type {UploadFileBlobResult} from "@app/core/commands"

export type DraftAttachment = {
  id: string
  file: File
  name: string
  size: number
  type: string
  previewUrl?: string
  status: "pending" | "uploading" | "uploaded" | "failed"
  error?: string
  result?: UploadFileBlobResult
  uploadId?: string
}

export type PublishedAttachment = {
  url: string
  sha256?: string
  name?: string
  size?: number
  type?: string
}

export const isPreviewableAttachment = ({type = "", url = ""}: Pick<PublishedAttachment, "type" | "url">) =>
  /^(image|video)\//.test(type) || /\.(jpe?g|png|gif|webp|svg|bmp|ico|mov|webm|mp4)(\?.*)?$/i.test(url)

export const formatAttachmentSize = (size?: number) => {
  if (!size || !Number.isFinite(size)) return "Unknown size"

  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export const getAttachmentExtension = (attachment: Pick<PublishedAttachment, "name" | "type">) => {
  const extension = attachment.name?.split(".").filter(Boolean).at(-1)
  if (extension) return extension.slice(0, 6).toUpperCase()

  return attachment.type?.split("/").at(-1)?.slice(0, 6).toUpperCase() || "FILE"
}

export const makeDraftAttachment = (file: File): DraftAttachment => {
  const previewUrl = file.type.startsWith("image/") || file.type.startsWith("video/")
    ? URL.createObjectURL(file)
    : undefined

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name || "attachment",
    size: file.size,
    type: file.type || "application/octet-stream",
    previewUrl,
    status: "pending",
  }
}

export const revokeDraftAttachment = (attachment: DraftAttachment) => {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
}

export const makeAttachmentImetaTag = (attachment: PublishedAttachment) => {
  const meta: Record<string, string> = {url: attachment.url}

  if (attachment.sha256) {
    meta.x = attachment.sha256
    meta.ox = attachment.sha256
  }
  if (attachment.type) meta.m = attachment.type
  if (attachment.size) meta.size = String(attachment.size)
  if (attachment.name) meta.name = attachment.name

  return ["imeta", ...Object.entries(meta).map(([key, value]) => `${key} ${value}`).sort()]
}

export const makePublishedAttachment = ({
  name,
  result,
}: {
  name: string
  result: UploadFileBlobResult
}): PublishedAttachment => ({
  url: result.url,
  sha256: result.sha256,
  name,
  size: result.size,
  type: result.type,
})

export const appendAttachmentUrlsToContent = (content: string, attachments: PublishedAttachment[]) =>
  [content.trim(), ...attachments.map(attachment => attachment.url)].filter(Boolean).join("\n")

export const getEventAttachments = (event?: Pick<TrustedEvent, "tags">): PublishedAttachment[] => {
  const seen = new Set<string>()

  return getTags("imeta", event?.tags || []).flatMap(tag => {
    const meta = tagsFromIMeta(tag)
    const url = getTagValue("url", meta)
    if (!url || seen.has(url)) return []

    seen.add(url)

    const size = Number(getTagValue("size", meta))

    return [
      {
        url,
        sha256: getTagValue("x", meta) || undefined,
        name: getTagValue("name", meta) || undefined,
        size: Number.isFinite(size) ? size : undefined,
        type: getTagValue("m", meta) || undefined,
      },
    ]
  })
}

export const stripAttachmentUrlLines = (content: string, attachments: PublishedAttachment[]) => {
  if (attachments.length === 0) return content

  const attachmentUrls = new Set(attachments.map(attachment => attachment.url))

  return content
    .split(/\r?\n/)
    .filter(line => !attachmentUrls.has(line.trim()))
    .join("\n")
    .trim()
}
