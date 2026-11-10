import type {TrustedEvent} from "@welshman/util"

// Freedom Builders code 104: native kind-4444 IDs, never quoted plaintext in tags.
export const dmReplyId = (event: TrustedEvent) => {
  const tags = event.tags.filter(tag => tag[0] === "e" && tag[3] === "reply")
  const id = tags.length === 1 ? tags[0][1] : undefined
  return id && /^[0-9a-f]{64}$/.test(id) && id !== event.id ? id : undefined
}

export const isDmReplyTarget = (event: TrustedEvent, account: string, peer: string) => {
  const recipients = event.tags.filter(tag => tag[0] === "p")
  return (
    event.kind === 4444 &&
    recipients.length === 1 &&
    ((event.pubkey === account && recipients[0][1] === peer) ||
      (event.pubkey === peer && recipients[0][1] === account))
  )
}
