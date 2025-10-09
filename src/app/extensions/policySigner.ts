import {makeEvent, verifyEvent, type TrustedEvent} from "@welshman/util"
import {signer} from "@welshman/app"

export const EXTENSION_POLICY_KIND = 31993

export const signManifestPolicy = async (manifestId: string, granted: boolean) => {
  const event = makeEvent(EXTENSION_POLICY_KIND, {
    tags: [
      ["manifest", manifestId],
      ["granted", String(granted)],
    ],
  })
  return signer.get().sign(event)
}

export const verifyManifestPolicy = (event: TrustedEvent) => verifyEvent(event)
