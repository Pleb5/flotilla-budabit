import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {selectDefaultCommunityWidgets} from "@app/extensions/builtin-filter"
import {loadCachedCommunityCuratedWidgets} from "@app/extensions/community-widget-slots"
import {loadConfiguredDefaultWidgets} from "@app/extensions/configured-defaults"
import {setDefaultExtensionWidgets} from "@app/extensions/settings"
import type {SmartWidgetEvent} from "@app/extensions/types"

let builtinLoadPromise: Promise<void> | undefined

const loadDefaultCommunityWidgets = async (): Promise<SmartWidgetEvent[]> => {
  if (!DEFAULT_COMMUNITY_INPUT) return []

  try {
    await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
      priority: RELAY_REQUEST_PRIORITY.background,
    }).catch(() => undefined)
    // A home slot may have promoted the pending background load. Read the
    // current entry so defaults use the promoted result rather than stale data.
    const result = await loadCachedCommunityCuratedWidgets(DEFAULT_COMMUNITY_INPUT, {
      priority: RELAY_REQUEST_PRIORITY.background,
    })
    return result?.status === "community"
      ? selectDefaultCommunityWidgets(result.widgets, result.community.ownerPubkey)
      : []
  } catch (error) {
    console.warn("[extensions] Failed to load default community extensions", error)
    return []
  }
}

export const installBuiltinExtensions = () => {
  if (builtinLoadPromise) return builtinLoadPromise

  builtinLoadPromise = (async () => {
    const widgets: SmartWidgetEvent[] = []
    const addWidgets = (loaded: SmartWidgetEvent[]) => {
      widgets.push(...loaded)
      setDefaultExtensionWidgets(widgets)
    }

    // Publish each source as it resolves: community discovery or an unavailable
    // explicit address must not hold up the other configured defaults.
    await Promise.all([
      loadDefaultCommunityWidgets().then(addWidgets),
      loadConfiguredDefaultWidgets(import.meta.env.VITE_DEFAULT_WIDGETS || "", widget =>
        addWidgets([widget]),
      ),
    ])
  })()

  return builtinLoadPromise
}
