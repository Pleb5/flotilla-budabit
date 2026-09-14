import {netContext} from "@welshman/net"
import {repository} from "@welshman/app"
import {
  assertCommunityTransportPublication,
  assertPrivateReadDestinations,
  isPrivateEvent,
  isPrivateRelay,
  PrivatePublicationError,
} from "./private-community-policy"
import {
  rememberPrivateDefinition,
  resolvePrivateCommunityScope,
  restorePrivateCommunityScopes,
} from "./private-community-scope"

export const installPrivateCommunityBoundary = () => {
  restorePrivateCommunityScopes()
  if (typeof location !== "undefined") resolvePrivateCommunityScope(new URL(location.href))
  const oldPublish = netContext.beforePublish,
    oldRead = netContext.beforeRequest,
    oldAccept = repository.acceptEvent
  netContext.beforePublish = (event, relays) => {
    assertCommunityTransportPublication(event, relays)
    oldPublish?.(event, relays)
  }
  netContext.beforeRequest = (filters, relays, isolated) => {
    if (!isolated && relays.some(isPrivateRelay)) return false
    try {
      assertPrivateReadDestinations(filters, relays)
    } catch (error) {
      if (error instanceof PrivatePublicationError) return false
      throw error
    }
    return oldRead?.(filters, relays, isolated)
  }
  // Evaluated at final insertion, including previously scheduled delayed batches.
  repository.acceptEvent = event => {
    rememberPrivateDefinition(event)
    return !isPrivateEvent(event) && oldAccept(event)
  }
  return () => {
    netContext.beforePublish = oldPublish
    netContext.beforeRequest = oldRead
    repository.acceptEvent = oldAccept
  }
}
