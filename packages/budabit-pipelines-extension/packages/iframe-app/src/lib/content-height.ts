import type {WidgetBridge} from 'budabit-sdk'

/** Size the iframe to its contents so the repository page is the scroll owner. */
export function observeContentHeight(bridge: WidgetBridge, root: HTMLElement): () => void {
  let enabled = false
  let disposed = false
  let frame = 0
  let lastHeight = 0
  let maxHeight = Number.POSITIVE_INFINITY

  const measure = () => {
    frame = 0
    if (!enabled || disposed) return
    // Measure the content root, never the viewport/documentElement: viewport
    // height feeds back into itself and prevents shrinking after collapsing logs.
    const contentHeight = Math.max(root.getBoundingClientRect().height, root.scrollHeight)
    const height = Math.min(maxHeight, Math.max(1, Math.ceil(contentHeight)))
    if (height === lastHeight) return
    lastHeight = height
    void bridge.request('ui:resize', {height}).catch(() => {
      if (!disposed && lastHeight === height) lastHeight = 0
    })
  }
  const schedule = () => {
    if (enabled && !disposed && !frame) frame = requestAnimationFrame(measure)
  }
  const offInit = bridge.onEvent('widget:init', (payload: any) => {
    enabled = payload?.capabilities?.surface?.resize === true
    const limit = payload?.capabilities?.limits?.widgetResizeHeight
    maxHeight = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? limit
      : Number.POSITIVE_INFINITY
    lastHeight = 0
    schedule()
  })
  const resize = new ResizeObserver(schedule)
  resize.observe(root)
  // Out-of-flow menus can change scrollHeight without changing the root's box.
  const mutations = new MutationObserver(schedule)
  mutations.observe(root, {childList: true, subtree: true, attributes: true})
  window.addEventListener('resize', schedule)

  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    offInit()
    resize.disconnect()
    mutations.disconnect()
    window.removeEventListener('resize', schedule)
  }
}
