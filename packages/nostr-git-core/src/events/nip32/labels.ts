// Core: labels resolver using shared-types nip32 helpers
import type { NostrEvent } from "nostr-tools";
import { extractSelfLabels, extractLabelEvents, mergeEffectiveLabels } from "./nip32.js";

export function effectiveLabelsFor(target: { self: NostrEvent; external: NostrEvent[] }): {
  normalized: string[];
} {
  const self = extractSelfLabels(target.self);
  const external = extractLabelEvents(target.external);
  const t = target.self.tags.filter((t: string[]) => t[0] === "t").map((t: string[]) => t[1]);
  const merged = mergeEffectiveLabels({ self, external, t });
  return { normalized: [...merged.flat] };
}