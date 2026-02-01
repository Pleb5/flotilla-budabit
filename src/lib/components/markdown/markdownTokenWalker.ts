/**
 * Token walker for enriching tokens with profile data
 */

import type {Token} from "marked"
import {nip19} from "nostr-tools"
import {get} from "svelte/store"
import {profilesByPubkey, loadProfile} from "@welshman/app"
import {resolveNip05} from "./markdownUtils.js"

export interface TokenWalkerOptions {
  defaultRelays: string[]
}

/**
 * Creates a token walker function that enriches tokens with profile data
 */
export function createTokenWalker(options: TokenWalkerOptions) {
  const {defaultRelays} = options

  return async (token: Token) => {
    if (token.type === "nostr") {
      await enrichNostrToken(token, defaultRelays)
    } else if (token.type === "email") {
      await enrichEmailToken(token, defaultRelays)
    }
  }
}

/**
 * Enriches a Nostr token with profile data
 */
async function enrichNostrToken(token: Token, defaultRelays: string[]): Promise<void> {
  const fullId = (token as any).fullId
  if (!fullId) return

  try {
    const result: any = nip19.decode(fullId)
    let pubkey: string | undefined

    if (result.type === "nprofile") {
      pubkey = result.data.pubkey
    } else if (result.type === "npub") {
      pubkey = result.data
    }

    if (!pubkey) return

    ;(token as any).pubkey = pubkey

    // Get or load profile
    const profiles = get(profilesByPubkey)
    let profile = profiles.get(pubkey)
    if (!profile && defaultRelays.length > 0) {
      await loadProfile(pubkey, defaultRelays)
      profile = get(profilesByPubkey).get(pubkey)
    }

    if (profile) {
      ;(token as any).userName = profile.name || profile.display_name || null
    }
  } catch (e) {
    console.error("Failed to decode nostr token:", e, fullId)
  }
}

/**
 * Enriches an email token with NIP-05 profile data if applicable
 */
async function enrichEmailToken(token: Token, defaultRelays: string[]): Promise<void> {
  try {
    const pubkey = await resolveNip05((token as any).text)
    if (pubkey) {
      ;(token as any).isNip05 = true
      ;(token as any).tagType = "npub"
      ;(token as any).content = pubkey
      ;(token as any).pubkey = pubkey

      // Get or load profile
      const profiles = get(profilesByPubkey)
      let profile = profiles.get(pubkey)
      if (!profile && defaultRelays.length > 0) {
        await loadProfile(pubkey, defaultRelays)
        profile = get(profilesByPubkey).get(pubkey)
      }

      if (profile) {
        ;(token as any).userName = profile.name || profile.display_name || (token as any).text
      } else {
        ;(token as any).userName = (token as any).text
      }
    } else {
      ;(token as any).isNip05 = false
    }
  } catch (e) {
    console.error(`Failed to fetch NIP-05 user for ${(token as any).text}:`, e)
    ;(token as any).isNip05 = false
  }
}

