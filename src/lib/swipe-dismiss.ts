import {getInteractiveCardTarget} from "./html"

type SwipeDismissOptions = {
  enabled: boolean
  onDrag: (distance: number, dragging: boolean) => void
  onDismiss: () => boolean | void
}

const DRAG_SLOP = 8
const FLICK_MIN_DISTANCE = 48
const FLICK_MIN_VELOCITY = 0.6 // CSS pixels per millisecond
const VELOCITY_WINDOW_MS = 100

/** Only designated, non-interactive header areas can start a touch dismissal. */
export const swipeDismiss = (node: HTMLElement, initialOptions: SwipeDismissOptions) => {
  let options = initialOptions
  let pointerId: number | undefined
  let startX = 0
  let startY = 0
  let distance = 0
  let dragging = false
  let suppressClick = false
  let frame: number | undefined
  let samples: {y: number; time: number}[] = []

  const cancelFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  const renderDrag = () => {
    frame = undefined
    options.onDrag(distance, true)
  }

  const sample = (event: PointerEvent) => {
    // A reversal must not inherit the earlier downward flick's velocity.
    if (samples.length && event.clientY < samples[samples.length - 1].y) samples = []
    samples.push({y: event.clientY, time: event.timeStamp})
    while (samples.length > 2 && samples[0].time < event.timeStamp - VELOCITY_WINDOW_MS) {
      samples.shift()
    }
  }

  const releasePointer = () => {
    const id = pointerId
    pointerId = undefined
    if (id !== undefined && node.hasPointerCapture(id)) node.releasePointerCapture(id)
  }

  const reset = () => {
    cancelFrame()
    releasePointer()
    distance = 0
    dragging = false
    samples = []
    options.onDrag(0, false)
  }

  const onPointerDown = (event: PointerEvent) => {
    suppressClick = false
    if (pointerId !== undefined) {
      // A second finger belongs to a multi-touch gesture, not a dismissal.
      reset()
      return
    }
    if (!options.enabled || event.pointerType !== "touch" || !event.isPrimary) return
    if (node.closest("[inert]")) return

    const target = event.target instanceof Element ? event.target : null
    const handle = target?.closest("[data-swipe-dismiss-handle]")
    if (!handle || !node.contains(handle) || getInteractiveCardTarget(event.target)) return

    pointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    distance = 0
    dragging = false
    samples = []
    sample(event)
    node.setPointerCapture(pointerId)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return

    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
      if (dy <= 0 || Math.abs(dx) >= dy) {
        reset()
        return
      }
      dragging = true
      suppressClick = true
    }

    distance = Math.max(0, dy)
    sample(event)
    // Coalesce high-frequency input into one paint, without reactive component updates.
    if (frame === undefined) frame = requestAnimationFrame(renderDrag)
    event.preventDefault()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return

    // The release can be ahead of the last pointermove, especially for a quick flick.
    onPointerMove(event)
    if (event.pointerId !== pointerId) return
    const first = samples[0]
    const elapsed = first ? event.timeStamp - first.time : 0
    const velocity = elapsed > 0 ? (event.clientY - first.y) / elapsed : 0
    const threshold = Math.min(120, Math.max(72, node.clientHeight * 0.2))
    const dismiss =
      dragging &&
      (distance >= threshold || (distance >= FLICK_MIN_DISTANCE && velocity >= FLICK_MIN_VELOCITY))
    cancelFrame()
    releasePointer()
    if (dismiss) {
      // Flush the release position before the dialog starts its outro.
      renderDrag()
      if (options.onDismiss() !== false) return
    }
    reset()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) reset()
  }

  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  node.addEventListener("pointerdown", onPointerDown)
  node.addEventListener("pointermove", onPointerMove)
  node.addEventListener("pointerup", onPointerUp)
  node.addEventListener("pointercancel", onPointerCancel)
  node.addEventListener("lostpointercapture", onPointerCancel)
  node.addEventListener("click", onClick, true)

  return {
    update(nextOptions: SwipeDismissOptions) {
      options = nextOptions
      if (!options.enabled) reset()
    },
    destroy() {
      cancelFrame()
      releasePointer()
      node.removeEventListener("pointerdown", onPointerDown)
      node.removeEventListener("pointermove", onPointerMove)
      node.removeEventListener("pointerup", onPointerUp)
      node.removeEventListener("pointercancel", onPointerCancel)
      node.removeEventListener("lostpointercapture", onPointerCancel)
      node.removeEventListener("click", onClick, true)
    },
  }
}
