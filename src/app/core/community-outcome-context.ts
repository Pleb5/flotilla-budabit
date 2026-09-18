import {get} from "svelte/store"
import {synced} from "@welshman/store"
import type {Filter} from "@welshman/util"
import {kv} from "@app/core/storage"
import {
  FORM_RESPONSE_KIND,
  normalizePubkey,
  normalizeRelays,
  parseCommunityDefinitionAddress,
  type CommunityDefinition,
} from "@app/core/community"
import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"

export type CommunityOutcomeContext = {address: string; relays: string[]}
export type CommunityOutcomeContexts = Record<string, CommunityOutcomeContext[]>

// Discovery hints only: reload the exact definition before querying its workflow.
// Keep these after rejection, submission deletion, or loss of membership.
export const communityOutcomeContexts = synced<CommunityOutcomeContexts>({
  key: "community.applicationOutcomeContexts",
  defaultValue: {},
  storage: kv,
})

export const mergeCommunityOutcomeContexts = (
  previous: CommunityOutcomeContext[],
  additions: CommunityOutcomeContext[],
) => {
  const byAddress = new Map<string, CommunityOutcomeContext>()
  for (const context of [...previous, ...additions]) {
    const community = parseCommunityDefinitionAddress(context.address)
    if (!community) continue
    const relays = normalizeRelays([
      ...(byAddress.get(community.address)?.relays || []),
      ...context.relays,
    ])
    if (relays.length) byAddress.set(community.address, {address: community.address, relays})
  }
  return Array.from(byAddress.values())
}

export const rememberCommunityOutcomeContexts = async (
  account: string,
  contexts: CommunityOutcomeContext[],
) => {
  const key = normalizePubkey(account)
  if (!key || contexts.length === 0) return
  await communityOutcomeContexts.ready
  const state = get(communityOutcomeContexts)
  const next = mergeCommunityOutcomeContexts(state[key] || [], contexts)
  if (JSON.stringify(next) === JSON.stringify(state[key] || [])) return
  communityOutcomeContexts.set({...state, [key]: next})
  // Await persistence before an application is sent (including ambiguous ACKs).
  await kv.set("community.applicationOutcomeContexts", get(communityOutcomeContexts))
}

export const makeCommunityOutcomeSources = ({
  account,
  definitions,
  since,
  limit,
}: {
  account: string | undefined
  definitions: CommunityDefinition[]
  since: number
  limit: number
}) =>
  account
    ? definitions.map(definition => ({
        communityAddress: definition.pointer.address,
        relays: normalizeRelays(definition.relays),
        filters: [
          {
            kinds: [COMMUNITY_FORM_REVIEW_KIND],
            "#p": [account],
            "#h": [definition.communityId],
            "#k": [String(FORM_RESPONSE_KIND)],
            since,
            limit,
          } satisfies Filter,
        ],
      }))
    : []
