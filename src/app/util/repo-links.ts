import {Address, type TrustedEvent} from "@welshman/util"
import {
  getUserRelayHints,
  makeRepoEventNaddr,
  normalizeRelayHints,
  type EventShareEntityOptions,
} from "@app/util/event-links"
import {makeGitPath} from "@app/util/routes"

export type RepoLinkOptions = EventShareEntityOptions & {
  url?: string
}

export const makeRepoNaddrFromEvent = (
  event: TrustedEvent,
  options: EventShareEntityOptions = {},
) => {
  try {
    return (
      makeRepoEventNaddr(event, {
        ...options,
        userOutboxRelays: normalizeRelayHints(getUserRelayHints(), options.userOutboxRelays),
      }) || Address.fromEvent(event).toNaddr()
    )
  } catch {
    return ""
  }
}

export const makeRepoHrefFromEvent = (event: TrustedEvent, options: RepoLinkOptions = {}) => {
  const naddr = makeRepoNaddrFromEvent(event, options)

  return naddr ? makeGitPath(options.url, naddr) : ""
}
