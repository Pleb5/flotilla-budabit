/** Local UI fixtures. No signing, relay publication, or GitHub writes. */
import {tokens} from "@nostr-git/ui"
import {repository} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import ProfileDetail from "../../../src/app/components/ProfileDetail.svelte"
import {clearModals, pushModal} from "../../../src/app/util/modal"

export function addFixtureGithubToken() {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  tokens.push({host: "github.com", token: "profile-fixture-token-not-a-real-credential"})
}

export function openFixtureProfileModal(pubkey: string, event?: TrustedEvent) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  if (event) repository.publish(event)
  clearModals()
  return pushModal(ProfileDetail, {pubkey})
}

export function admitFixtureProfileEvent(event: TrustedEvent) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  repository.publish(event)
}
