import {Address, type TrustedEvent} from "@welshman/util"
import {
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
    return makeRepoEventNaddr(event, options) || Address.fromEvent(event).toNaddr()
  } catch {
    return ""
  }
}

export const makeRepoHrefFromEvent = (event: TrustedEvent, options: RepoLinkOptions = {}) => {
  const naddr = makeRepoNaddrFromEvent(event, {
    ...options,
    fallbackRelays: normalizeRelayHints(options.url, options.fallbackRelays),
  })

  return naddr ? makeGitPath(options.url, naddr) : ""
}
