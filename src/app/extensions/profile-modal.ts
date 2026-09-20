import {get} from "svelte/store"
import ProfileDetail from "@app/components/ProfileDetail.svelte"
import {modalStack, pushModal} from "@app/util/modal"

/** Use the host's normal modal stack; the underlying iframe remains mounted. */
export const openWidgetProfile = (pubkey: string, relays: string[]) => {
  const top = get(modalStack).at(-1)
  if (
    top?.component === ProfileDetail &&
    top.props.pubkey === pubkey &&
    top.props.fullProfileInNewTab
  )
    return

  const id = pushModal(
    ProfileDetail,
    {pubkey, relays, fullProfileInNewTab: true},
    {ariaLabel: "Profile", trapFocus: true},
  )
  if (!id) throw new Error("Unable to open profile right now")
}
