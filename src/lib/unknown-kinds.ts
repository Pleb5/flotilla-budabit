import Mustache from "mustache"
import * as nip19 from "nostr-tools/nip19"

type RawTag = string[]

const DEFAULT_TEMPLATES: Record<number, string> = {
  14: "encrypted message to {{tags.p}}",
  7: "{{pubkey}} reacts to {{tags.e}} by {{tags.p}}{{#content}} with {{content}}{{/content}}",
  10002: "canonical relays list for {{pubkey}}",

  1111: "{{content}}",
  30617: "git repository {{tags.name}} hosted at {{tags.h}} by {{pubkey}}",
  30618: "git repository state {{tags.d}} hosted at {{tags.h[0]}} by {{pubkey}}",
  1617: "```\n{{{content}}}\n```",
  1621: "{{#tags.subject}}Subject{{tags.subject}}\n{{/tags.subject}}{{content}} {{#npub}}{{tags.p}}{{/npub}}",
  1623: "```\n{{{content}}}\n```",
  1630: "Status: Open {{#nevent}}{{tags.e}}{{/nevent}}",
  1631: "Patch Applied",
  1632: "Closed",
  1633: "Draft",

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
        const hex = render(txt).trim().toLowerCase();
        return "nostr:" + nip19.neventEncode({id: hex, relays: []});
      },
	  npub: () => (txt: string, render: (s: string) => string) => {
        const hex = render(txt).trim().toLowerCase()
        return "nostr:" + nip19.npubEncode(hex);
      },

    }),
    tags: params.tags,
  }
}
