import {naddrEncode} from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {normalizeRelayHints} from "./event-links"
import {entityLink} from "./nostr-links"

const labels: Record<number, string> = {
  30402: "Classified listing",
  32765: "Service",
  32766: "Order",
  32767: "Job",
  32768: "Proposal",
}

export const isTradeEventKind = (kind: number) => Object.hasOwn(labels, kind)
export const tradeEventLabel = (kind: number) => labels[kind] || "Listing"

const imageUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
      return url.href
  } catch {
    // Optional media must not prevent the listing from being readable.
  }
  return ""
}

export const getTradeEventDetails = (
  event: TrustedEvent,
  relays: string[] = [],
  now = Math.floor(Date.now() / 1000),
) => {
  const tag = (name: string) => event.tags.find(tag => tag[0] === name)?.[1]?.trim() || ""
  const integer = (name: string) => {
    const values = event.tags.filter(tag => tag[0] === name)
    const value = values[0]?.[1] || ""
    return values.length === 1 &&
      /^(0|[1-9]\d*)$/.test(value) &&
      Number.isSafeInteger(Number(value))
      ? Number(value)
      : undefined
  }
  const classified = event.kind === 30402
  const state = integer("s")
  let status = ""
  let price = ""

  if (classified) {
    const prices = event.tags.filter(tag => tag[0] === "price")
    const [, amount = "", currency = "", frequency = ""] = prices[0] || []
    const validPrice =
      prices.length === 1 &&
      /^(0|[1-9]\d{0,14})(\.\d{1,8})?$/.test(amount) &&
      /^[a-zA-Z]{3,5}$/.test(currency)
    const free = validPrice && /^0(\.0+)?$/.test(amount)
    price = free
      ? "Free"
      : validPrice
        ? `${amount} ${currency.toUpperCase()}${frequency ? ` / ${frequency}` : ""}`
        : prices.length
          ? "Price unavailable"
          : "Ask for price"
    const expiration = integer("expiration")
    status =
      tag("status") === "sold"
        ? free
          ? "Given away"
          : "Sold"
        : ["hidden", "private", "pre-order"].includes(tag("visibility")) ||
            tag("stock") === "0" ||
            tag("quantity") === "0" ||
            (expiration !== undefined && expiration <= now)
          ? "Unavailable"
          : free
            ? "Giveaway"
            : "Available"
  } else {
    const amount = integer("amount")
    const pricing = integer("pricing")
    price =
      amount !== undefined && amount > 0 && (pricing === 0 || pricing === 1)
        ? `${amount.toLocaleString()} sats${pricing === 1 ? " / hour" : " · Fixed price"}`
        : event.kind === 32767 && !tag("amount")
          ? "Price set by proposals"
          : "Price unavailable"
    if (event.kind === 32767)
      status = ["Open", "In progress", "Resolved", "Failed"][state ?? -1] || "Status unavailable"
    if (event.kind === 32765)
      status = ["Inactive", "Available"][state ?? -1] || "Status unavailable"
    // Acceptance lives on the parent service/job, not on the shared offer itself.
    if (event.kind === 32766)
      status = ["Open", "Fulfilled", "Failed"][state ?? -1] || "Status unavailable"
  }

  const parentKind = event.kind === 32768 ? 32767 : event.kind === 32766 ? 32765 : undefined
  let parent: {href: string; label: string} | undefined
  if (parentKind) {
    const refs = event.tags.filter(
      tag => tag[0] === "a" && tag.length <= 3 && tag[1]?.startsWith(`${parentKind}:`),
    )
    if (refs.length === 1) {
      const [, pubkey, ...parts] = refs[0][1].split(":")
      const identifier = parts.join(":")
      if (/^[0-9a-f]{64}$/i.test(pubkey) && identifier) {
        parent = {
          href: entityLink(
            naddrEncode({
              kind: parentKind,
              pubkey,
              identifier,
              relays: normalizeRelayHints(relays),
            }),
          ),
          label: parentKind === 32767 ? "View job" : "View service",
        }
      }
    }
  }

  const images = event.tags
    .filter(tag => tag[0] === "image")
    .map((tag, index) => ({
      url: imageUrl(tag[1] || ""),
      order: /^\d+$/.test(tag[3] || "") ? Number(tag[3]) : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map(image => image.url)
    .filter(Boolean)

  return {
    label: tradeEventLabel(event.kind),
    title:
      tag("title") ||
      (event.kind === 32768
        ? "Job proposal"
        : event.kind === 32766
          ? "Service order"
          : `Untitled ${tradeEventLabel(event.kind).toLowerCase()}`),
    description: event.content.trim() || tag("summary"),
    price,
    status,
    images: [...new Set(images)].slice(0, 8),
    location: tag("location"),
    categories: [
      ...new Set(
        event.tags.filter(tag => tag[0] === "t" && tag[1]?.trim()).map(tag => tag[1].trim()),
      ),
    ].slice(0, 12),
    parent,
  }
}
