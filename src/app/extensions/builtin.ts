import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
import {selectDefaultCommunityWidgets} from "@app/extensions/builtin-filter"
import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
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
      const result = await loadCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT)
      setDefaultExtensionWidgets(
        result.status === "community"
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
