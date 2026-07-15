const COMMUNITY_WIDGET_DEBUG_KEY = "budabit:debug:community-widgets"

export const isCommunityWidgetDebugEnabled = () => {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(COMMUNITY_WIDGET_DEBUG_KEY) === "1"
    )
  } catch {
    return false
  }
}

export const logCommunityWidgetDebug = (message: string, data?: unknown) => {
  if (!isCommunityWidgetDebugEnabled()) return

  if (data === undefined) {
    console.debug(`[community-widgets] ${message}`)
  } else {
    console.debug(`[community-widgets] ${message}`, data)
  }
}
