<script lang="ts">
  import markdownit from "markdown-it";
  import { nip19 } from "nostr-tools";

  interface Props {
    content: string;
    prose?: boolean;
    // When provided, NIP-19 codes are replaced with this URL template string.
    // Supported placeholders: {raw}, {type}, {id}, {pubkey}, {identifier}, {kind}
    linkTemplate?: string;
  }

  const { content, prose = true, linkTemplate }: Props = $props();

  const md = markdownit({ html: true, linkify: true, typographer: true });

  // Extract NIP-19 entities from text
  const NIP19_REGEX = /\b(nprofile1\w+|npub1\w+|nevent1\w+|note1\w+|naddr1\w+)\b/g;

  type Pointer =
    | { raw: string; type: "nevent" | "note"; value: { id: string; relays?: string[] } }
    | {
        raw: string;
        type: "naddr";
        value: { identifier: string; pubkey?: string; kind?: number; relays?: string[] };
      }
    | { raw: string; type: "nprofile" | "npub"; value: any };

  let pointers = $state<Pointer[]>([]);

  function decodePointers(text: string): Pointer[] {
    const out: Pointer[] = [];
    for (const m of text.matchAll(NIP19_REGEX)) {
      const raw = m[0];
      try {
        const decoded = nip19.decode(raw);
        switch (decoded.type) {
          case "nevent":
            out.push({ raw, type: "nevent", value: decoded.data as any });
            break;
          case "note":
            out.push({ raw, type: "note", value: { id: decoded.data as any } });
            break;
          case "naddr":
            out.push({ raw, type: "naddr", value: decoded.data as any });
            break;
          case "nprofile":
            out.push({ raw, type: "nprofile", value: decoded.data });
            break;
          case "npub":
            out.push({ raw, type: "npub", value: decoded.data });
            break;
          default:
            break;
        }
      } catch (e) {
        // ignore invalid
      }
    }
    // de-dup by raw
    const seen = new Set<string>();
    return out.filter((p) => (seen.has(p.raw) ? false : (seen.add(p.raw), true)));
  }

  $effect(() => {
    const next = decodePointers(content || "");
    pointers = next;
  });

  function templateUrl(p: Pointer): string {
    const base: Record<string, string | number | undefined> = {
      raw: p.raw,
      type: p.type,
      id: (p as any).value?.id,
      pubkey: (p as any).value?.pubkey,
      identifier: (p as any).value?.identifier,
      kind: (p as any).value?.kind,
    };
    return (linkTemplate || "{raw}").replace(/\{(raw|type|id|pubkey|identifier|kind)\}/g, (_, k) =>
      String(base[k] ?? "")
    );
  }

  const processed = $derived.by(() => {
    if (!linkTemplate) return content || "";
    // Replace NIP-19 codes with URL text; rely on markdown-it linkify to make them clickable
    let out = content || "";
    for (const p of pointers) {
      const url = templateUrl(p);
      const escaped = p.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), url);
    }
    return out;
  });
  </script>

<div class={prose ? "prose prose-sm dark:prose-invert max-w-none" : ""}>
  {@html md.render(processed)}
</div>
