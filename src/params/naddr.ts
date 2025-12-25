/** @type {import('@sveltejs/kit').ParamMatcher} */

import { nip19 } from "nostr-tools";

export function match(param:string) {
  if (!param.startsWith("naddr1")) return false;

  try {
    // Decode using bech32
    const { type, data } = nip19.decode(param);

    // Ensure prefix is 'naddr'
    if (type !== "naddr") return false;

    // Ensure there is valid Bech32 content
    if (data.kind < 0) return false
    if (data.pubkey.length !== 64) return false
    if (data.identifier.length === 0) return false
    
    return true;
  } catch (err) {
    return false;
  }
}
