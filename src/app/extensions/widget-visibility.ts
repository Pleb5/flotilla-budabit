import type {CommunityWidgetContext, SmartWidgetEvent, WidgetVisibilityRequest} from "./types"

export const isInlineWidgetSlot = (slot?: string) =>
  slot === "community-home-before-quicklinks" || slot === "community-home-after-quicklinks"

// Read signed tags as well as the parsed field: older installed snapshots may
// contain the declaration without a field added by the current parser.
export const hasWidgetControlledVisibility = (widget: SmartWidgetEvent) =>
  (widget.visibility || widget.tags.find(tag => tag[0] === "visibility")?.[1]) === "widget"

export const getWidgetVisibilityContextKey = (context?: CommunityWidgetContext) =>
  context
    ? JSON.stringify([
        context.definitionAddress,
        context.viewer.pubkey || "",
        context.contextSessionId,
        context.contextVersion,
      ])
    : ""

export const validateWidgetVisibilityRequest = (
  payload: unknown,
  context?: CommunityWidgetContext,
): WidgetVisibilityRequest => {
  const request = payload as Partial<WidgetVisibilityRequest> | undefined
  if (!request || !["pending", "visible", "hidden"].includes(request.visibility || "")) {
    throw new Error("Invalid widget visibility")
  }
  if (
    !context ||
    request.contextSessionId !== context.contextSessionId ||
    request.contextVersion !== context.contextVersion
  ) {
    throw Object.assign(new Error("Widget visibility context is stale or unavailable"), {
      code: "STALE_WIDGET_CONTEXT",
    })
  }
  return request as WidgetVisibilityRequest
}
