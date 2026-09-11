import * as nip19 from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {entityLink} from "./nostr-links"

const labels: Record<number, string> = {
  0: "Profile",
  1: "Note",
  3: "Follow list",
  4: "Encrypted message",
  5: "Deletion request",
  6: "Repost",
  7: "Reaction",
  9: "Message",
  11: "Thread",
  13: "Sealed message",
  14: "Private message",
  16: "Repost",
  1059: "Wrapped message",
  1111: "Comment",
  1617: "Patch",
  1618: "Pull request",
  1619: "Pull request update",
  1621: "Issue",
  1623: "Code reference",
  1630: "Open status",
  1631: "Applied status",
  1632: "Closed status",
  1633: "Draft status",
  9041: "Zap goal",
  9735: "Zap receipt",
  10002: "Relay list",
  30023: "Article",
  30024: "Article draft",
  30033: "Smart widget",
  30617: "Repository",
  30618: "Repository state",
  31922: "Calendar event",
  31923: "Calendar event",
  32222: "Community",
}

export const getEventFallback = (event: TrustedEvent) => {
  const tagValue = (key: string) => event.tags.find(tag => tag[0] === key)?.[1]?.trim() || ""
  const label = labels[event.kind] || "Nostr event"
  const title = tagValue("title") || tagValue("subject") || tagValue("name") || label
  const summary = tagValue("summary")
  const encrypted = [4, 13, 1059].includes(event.kind)
  let body = event.content.trim()
  let format: "text" | "json" | "encrypted" = encrypted ? "encrypted" : "text"

  if (encrypted) {
    body = "This event contains encrypted content. It cannot be read in this basic view."
  } else if (event.kind === 7) {
    body = `Reacted with ${body || "+"}`
  } else if (event.kind === 10002) {
    const count = event.tags.filter(tag => tag[0] === "r" && tag[1]).length
    body = `${count} relay${count === 1 ? "" : "s"} listed by this author.`
  } else if (/^[\[{]/.test(body)) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
      format = "json"
    } catch {
      // Malformed JSON is still useful as escaped text.
    }
  }

  const metadata = event.tags
    .filter(tag => !["title", "subject", "name", "summary", "content-warning"].includes(tag[0]))
    .slice(0, 6)
    .map(tag => ({name: tag[0], value: tag.slice(1).join(" · ").slice(0, 200)}))

  const related = new Map<string, {href: string; label: string}>()
  for (const [key, value, relay] of event.tags) {
    if (!["e", "E", "a", "A", "q"].includes(key) || !value || related.has(value)) continue
    try {
      const relays = /^wss?:\/\//.test(relay || "") ? [relay] : []
      let entity: string
      if (/^[0-9a-f]{64}$/i.test(value) && !["a", "A"].includes(key)) {
        entity = nip19.neventEncode({id: value, relays})
      } else {
        const [kind, pubkey, ...identifier] = value.split(":")
        if (!/^\d+$/.test(kind) || !/^[0-9a-f]{64}$/i.test(pubkey) || identifier.length === 0)
          continue
        entity = nip19.naddrEncode({
          kind: Number(kind),
          pubkey,
          identifier: identifier.join(":"),
          relays,
        })
      }
      related.set(value, {href: entityLink(entity), label: `Related event ${related.size + 1}`})
      if (related.size === 4) break
    } catch {
      // Ignore malformed references rather than creating broken links.
    }
  }

  return {label, title, summary, body, format, metadata, related: [...related.values()]}
}
