import Mustache from "mustache"
import * as nip19 from "nostr-tools/nip19"

type RawTag = string[]

const DEFAULT_TEMPLATES: Record<number, string> = {
  14: "encrypted message to {{tags.p}}",
  7: "{{pubkey}} reacts to {{tags.e}} by {{tags.p}}{{#content}} with {{content}}{{/content}}",
  10002: "canonical relays list for {{pubkey}}",

  1111: "{{#nevent}}{{tags.E}}{{/nevent}}\n{{content}}",
  30617: "Git repository {{tags.name}} hosted at {{{tags.clone}}} by {{#npub}}{{pubkey}}{{/npub}}",
  30618:
    "## Git repository state {{tags.d}} hosted at {{tags.clone}} by {{#npub}}{{pubkey}}{{/npub}}",
  1617: "Patch",
  1621: "Issue: {{tags.subject}}\n{{content}}",
  1623: "```\n{{content}}\n```",
  1630: "Status changed to Open {{#nevent}}{{tags.e}}{{/nevent}}",
  1631: "Patch applied: {{#nevent}}{{tags.e}}{{/nevent}}",
  1632: "Status changed to Closed {{#nevent}}{{tags.e}}{{/nevent}}",
  1633: "Status changed to Draft {{#nevent}}{{tags.e}}{{/nevent}}",

  31922: "{{tags.title}} happening at {{tags.start}}",
}

function tagsToObj(tags: RawTag[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of tags) if (!(k in out) && v) out[k] = v
  return out
}

export function isKnownUnknown(kind: number): boolean {
  return DEFAULT_TEMPLATES[kind] !== undefined
}

export function unknownKindFallback(
  params: {
    kind: number
    created_at: number
    pubkey: string
    content: string
    tags: RawTag[]
  },
  templates: Record<number, string> = DEFAULT_TEMPLATES,
): {
  content: string
  tags: RawTag[]
} {
  const tpl = templates[params.kind] ?? "event kind {{kind}} by {{pubkey}}"

  return {
    content: Mustache.render(tpl, {
      ...params,
      tags: tagsToObj(params.tags),
      nevent: () => (txt: string, render: (s: string) => string) => {
        const hex = render(txt).trim().toLowerCase()
        return "nostr:" + nip19.neventEncode({id: hex, relays: []})
      },
      npub: () => (txt: string, render: (s: string) => string) => {
        const hex = render(txt).trim().toLowerCase()
        return "nostr:" + nip19.npubEncode(hex)
      },
    }),
    tags: params.tags,
  }
}
