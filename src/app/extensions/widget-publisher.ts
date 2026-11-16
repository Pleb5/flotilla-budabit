import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {isSecureEmbeddableUrl} from "@app/extensions/url-policy"
import type {UploadFileResult} from "@app/core/commands"
import type {WidgetCommunitySlotType} from "@app/extensions/types"
import type {WidgetCommunityOption} from "@app/extensions/widget-targeting"
import type {StampedEvent, SignedEvent} from "@welshman/util"
import {makeBudabitBlossomAuthEvent, makeBudabitBlossomAuthHeader} from "@app/util/blossom-auth"

/** Upload stores bytes; this separate signed operation enables executable delivery. */
export const publishBlossomWidget = async (
  blob: {url: string; sha256: string},
  sign: (template: StampedEvent) => Promise<SignedEvent>,
  fetcher: typeof fetch = fetch,
) => {
  const source = new URL(blob.url)
  const hash = blob.sha256
  if (
    !/^[0-9a-f]{64}$/.test(hash) ||
    !isSecureEmbeddableUrl(blob.url) ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !new RegExp(`^/${hash}(?:\\.[a-z0-9]{1,10})?$`).test(source.pathname)
  ) {
    throw new Error("Widget publication requires a secure, content-addressed Blossom blob URL.")
  }
  const endpoint = new URL(`/widgets/${hash}`, source.origin)
  const auth = await sign(
    makeBudabitBlossomAuthEvent({
      action: "publish-widget",
      server: source.origin,
      hashes: [hash],
    }),
  )
  const response = await fetcher(endpoint, {
    method: "PUT",
    headers: {Authorization: makeBudabitBlossomAuthHeader(auth)},
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(
      `Widget publication at ${source.host} failed (${response.status}). ${response.headers.get("X-Reason") || "The server must support widget publication and authorize your account."}`,
    )
  const result = await response.json()
  const expectedUrl = new URL(`/widgets/${hash}.html`, source.origin).href
  if (result.sha256 !== hash || result.url !== expectedUrl) {
    throw new Error("Widget server returned an unexpected publication URL or hash.")
  }
  return expectedUrl
}

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

export const getWidgetAppUrlsFromUpload = (
  upload: Pick<UploadFileResult, "result" | "mirrors">,
) => {
  const urls = [
    upload.result?.url,
    ...(upload.mirrors || []).filter(mirror => mirror.ok).map(mirror => mirror.url),
  ].filter((url): url is string => Boolean(url))

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
  selectedAddresses: string[],
) => {
  const selected = new Set(selectedAddresses.map(address => address.trim()).filter(Boolean))

  return options.filter(option => selected.has(option.community.address))
}

export {SMART_WIDGET_KIND}
