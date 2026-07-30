import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {selectDefaultCommunityWidgets} from "@app/extensions/builtin-filter"
import {loadCachedCommunityCuratedWidgets} from "@app/extensions/community-widget-slots"
import {setDefaultExtensionWidgets} from "@app/extensions/settings"

let builtinLoadPromise: Promise<void> | undefined

export const installBuiltinExtensions = () => {
  if (builtinLoadPromise) return builtinLoadPromise

  builtinLoadPromise = (async () => {
    if (!DEFAULT_COMMUNITY_INPUT) {
      setDefaultExtensionWidgets([])
      return
    }

    try {
      await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
        priority: RELAY_REQUEST_PRIORITY.background,
      }).catch(() => undefined)
      // A home slot may have promoted the pending background load. Read the
      // current entry so defaults use the promoted result rather than stale data.
      const result = await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
        priority: RELAY_REQUEST_PRIORITY.background,
      })
      setDefaultExtensionWidgets(
        result?.status === "community"
          ? selectDefaultCommunityWidgets(result.widgets, result.communityPubkey)
          : [],
      )
    } catch (error) {
      console.warn("[extensions] Failed to load default community extensions", error)
      setDefaultExtensionWidgets([])
    }
  })()

  return builtinLoadPromise
}
