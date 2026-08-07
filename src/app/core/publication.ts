import {pubkey, signer} from "@welshman/app"
import {isSignedEvent, prep, type EventTemplate, type SignedEvent} from "@welshman/util"

export const signEventForPublication = async (
  event: EventTemplate | SignedEvent,
): Promise<SignedEvent> => {
  if (isSignedEvent(event as SignedEvent)) return event as SignedEvent

  const activePubkey = pubkey.get()
  const activeSigner = signer.get()

  if (!activePubkey || !activeSigner) {
    throw new Error("Log in with an active signer before publishing.")
  }

  return activeSigner.sign(prep(event, activePubkey), {
    signal: AbortSignal.timeout(30_000),
  })
}
