import type {SmartWidgetEvent} from "./types"

export const isCommunityHomeWidget = (widget: Pick<SmartWidgetEvent, "slot">) =>
  widget.slot?.type === "community-home-before-quicklinks" ||
  widget.slot?.type === "community-home-after-quicklinks"

export const shouldPreloadWidgetRuntime = (widget: SmartWidgetEvent) =>
  !isCommunityHomeWidget(widget)
