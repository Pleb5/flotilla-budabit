import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "@app/extensions/types"

const curatedWidgetLoads = new Map<
  string,
  ReturnType<typeof loadCommunityCuratedWidgets>
>()

export const loadCachedCommunityCuratedWidgets = (input: string) => {
  const key = input.trim()
  if (!key) return Promise.resolve(undefined)

  const existing = curatedWidgetLoads.get(key)
  if (existing) return existing

  const pending = loadCommunityCuratedWidgets(key).catch(error => {
    curatedWidgetLoads.delete(key)
    throw error
  })
  curatedWidgetLoads.set(key, pending)

  return pending
}

export const clearCommunityWidgetSlotCache = () => {
  curatedWidgetLoads.clear()
}

export const getEnabledCommunitySlotWidgets = ({
  curatedWidgets,
  installedWidgets,
  enabledIds,
  slotType,
}: {
  curatedWidgets: SmartWidgetEvent[]
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const selected: SmartWidgetEvent[] = []

  for (const widget of curatedWidgets) {
    if (widget.slot?.type !== slotType || !enabledIds.has(widget.identifier)) continue

    const installedWidget = installedWidgets[widget.identifier]
    if (installedWidget) selected.push({...installedWidget, slot: widget.slot || installedWidget.slot})
  }

  return selected
}
