import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {isSecureEmbeddableUrl} from "@app/extensions/url-policy"
import type {UploadFileResult} from "@app/core/commands"
import type {WidgetCommunitySlotType} from "@app/extensions/types"
import type {WidgetCommunityOption} from "@app/extensions/widget-targeting"

export type WidgetPublisherDraft = {
  identifier: string
  name: string
  appUrls: string[]
  iconUrl?: string
  description?: string
  slot?: WidgetCommunitySlotType | ""
  version?: string
  changelog?: string
}

export const getWidgetAppUrlsFromUpload = (upload: Pick<UploadFileResult, "result" | "mirrors">) => {
  const urls = [upload.result?.url, ...(upload.mirrors || []).map(mirror => mirror.url)].filter(
    (url): url is string => Boolean(url),
  )

  return Array.from(new Set(urls.filter(isSecureEmbeddableUrl)))
}

export const buildCommunityWidgetEventTags = (draft: WidgetPublisherDraft): string[][] => {
  const identifier = draft.identifier.trim()
  const name = draft.name.trim()
  const appUrls = Array.from(new Set(draft.appUrls.map(url => url.trim()).filter(Boolean)))
  const [primaryAppUrl, ...fallbackAppUrls] = appUrls

  if (!identifier) throw new Error("Widget identifier is required.")
  if (!name) throw new Error("Widget name is required.")
  if (!primaryAppUrl) throw new Error("Widget app URL is required.")
  if (!appUrls.every(isSecureEmbeddableUrl)) throw new Error("Widget app URLs must be secure.")

  return [
    ["d", identifier],
    ["title", name],
    ["l", "basic"],
    ...(draft.slot ? [["slot", draft.slot, name]] : []),
    ["button", "Open", "app", primaryAppUrl],
    ...fallbackAppUrls.map(url => ["app-url", url]),
    ...(draft.iconUrl?.trim() ? [["icon", draft.iconUrl.trim()]] : []),
    ...(draft.description?.trim() ? [["description", draft.description.trim()]] : []),
    ...(draft.version?.trim() ? [["version", draft.version.trim()]] : []),
    ...(draft.changelog?.trim() ? [["changelog", draft.changelog.trim()]] : []),
  ]
}

export const filterSelectedWidgetCommunityOptions = (
  options: WidgetCommunityOption[],
  selectedPubkeys: string[],
) => {
  const selected = new Set(selectedPubkeys.map(pubkey => pubkey.trim().toLowerCase()).filter(Boolean))

  return options.filter(option => selected.has(option.pubkey.trim().toLowerCase()))
}

export {SMART_WIDGET_KIND}
