import {getPlaintext, setPlaintext, signer} from "@welshman/app"
import {Router} from "@welshman/router"
import {decrypt} from "@welshman/signer"
import {
  getListTags,
  getRelayTagValues,
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import type {List, TrustedEvent} from "@welshman/util"
import {INDEXER_RELAYS, PLATFORM_RELAYS} from "@app/core/state"
export {DM_KIND} from "@lib/budabit/constants"

export const normalizeRelayUrls = (relays: string[]) => {
  const result: string[] = []
  const seen = new Set<string>()

  for (const url of relays || []) {
    let normalized = ""
    try {
      normalized = normalizeRelayUrl(url)
    } catch {
      normalized = ""
    }

    if (!normalized || !isRelayUrl(normalized) || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export const getDmRelayUrls = (list?: List) =>
  normalizeRelayUrls(getRelayTagValues(getListTags(list)))

export const getDmPublishRelays = (selfRelays: string[], recipientRelays: string[]) =>
  normalizeRelayUrls([...recipientRelays, ...selfRelays])

export const hasDmInbox = (list?: List) => getDmRelayUrls(list).length > 0

export const getMessagingRelayHints = () => {
  const hints: string[] = [...INDEXER_RELAYS, ...PLATFORM_RELAYS]

  try {
    const router = Router.get()
    hints.push(...router.FromUser().getUrls())
    hints.push(...router.ForUser().getUrls())
  } catch {
    // ignore
  }

  return normalizeRelayUrls(hints)
}

export const getDmCounterparty = (event: TrustedEvent, selfPubkey: string) => {
  if (event.pubkey === selfPubkey) {
    return getTagValue("p", event.tags)
  }

  return event.pubkey
}

const decryptDmContent = async (
  $signer: ReturnType<typeof signer.get>,
  counterparty: string,
  content: string,
) => {
  if (!$signer) return
  const signerAny = $signer as any

  if (typeof signerAny?.nip44?.decrypt === "function") {
    return signerAny.nip44.decrypt(counterparty, content)
  }

  if (typeof signerAny?.decrypt === "function") {
    return signerAny.decrypt(counterparty, content)
  }

  return decrypt($signer, counterparty, content)
}

export const ensureDmPlaintext = async (event: TrustedEvent, selfPubkey: string) => {
  if (!event.content || getPlaintext(event)) {
    return getPlaintext(event)
  }

  const $signer = signer.get()
  if (!$signer) return

  const counterparty = getDmCounterparty(event, selfPubkey)
  if (!counterparty) return

  let result: string | undefined

  try {
    result = await decryptDmContent($signer, counterparty, event.content)
  } catch (error: any) {
    if (!String(error).match(/invalid base64/)) {
      throw error
    }
  }

  if (result) {
    setPlaintext(event, result)
  }

  return getPlaintext(event)
}
