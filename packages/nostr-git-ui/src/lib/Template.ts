import Mustache from "mustache";
import type { NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";

export type RawTag = string[];

const DEFAULT_TEMPLATES: Record<number, string> = {
  14: "encrypted message to {{tags.p}}",
  7: "{{pubkey}} reacts to {{tags.e}} by {{tags.p}}{{#content}} with {{content}}{{/content}}",
  10002: "canonical relays list for {{pubkey}}",
  1111: "{{#nevent}}{{tags.E}}{{/nevent}}\n{{content}}",
  30617: "Git repository {{tags.name}} hosted at {{{tags.clone}}} by {{#npub}}{{pubkey}}{{/npub}}",
  30618:
    "## Git repository state {{tags.d}} hosted at {{tags.clone}} by {{#npub}}{{pubkey}}{{/npub}}",
  1621: "Issue: {{tags.subject}}\n{{content}}",
  1623: "{{content}}",
  1630: "Status changed to Open {{#nevent}}{{tags.e}}{{/nevent}}",
  1631: "Status changed to Merged/Resolved {{#nevent}}{{tags.e}}{{/nevent}}",
  1632: "Status changed to Closed {{#nevent}}{{tags.e}}{{/nevent}}",
  1633: "Status changed to Draft {{#nevent}}{{tags.e}}{{/nevent}}",
  31922: "{{tags.title}} happening at {{tags.start}}",
};

function tagsToObj(tags: RawTag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of tags) if (!(k in out) && v) out[k] = v;
  return out;
}

export class Template {
  private event: NostrEvent;
  private templates: Record<number, string>;

  constructor(event: NostrEvent, templates: Record<number, string> = DEFAULT_TEMPLATES) {
    this.event = event;
    this.templates = templates;
  }

  render(): string {
    const tpl = this.templates[this.event.kind] ?? "event kind {{kind}} by {{pubkey}}";
    return Mustache.render(tpl, {
      ...this.event,
      tags: tagsToObj(this.event.tags),
      nevent: () => (txt: string, render: (s: string) => string) => {
        const hex = render(txt).trim().toLowerCase();
        return "nostr:" + nip19.neventEncode({ id: hex, relays: [] });
      },
      npub: () => (txt: string, render: (s: string) => string) => {
        const hex = render(txt).trim().toLowerCase();
        return "nostr:" + nip19.npubEncode(hex);
      },
    });
  }
}

export function getDefaultTemplates(): Record<number, string> {
  return DEFAULT_TEMPLATES;
}
