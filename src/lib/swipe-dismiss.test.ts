// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {swipeDismiss} from "./swipe-dismiss"

describe("touch-only swipe dismissal", () => {
  let panel: HTMLElement
  let handle: HTMLElement
  let action: ReturnType<typeof swipeDismiss>
  const onDrag = vi.fn()
  const onDismiss = vi.fn<() => boolean | void>()

  const pointer = (
    type: string,
    target: Element = panel,
    properties: Partial<PointerEvent> = {},
  ) => {
    const event = new Event(type, {bubbles: true, cancelable: true})
    Object.assign(event, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
      ...properties,
    })
    target.dispatchEvent(event)
    return event
  }

  const drag = (dy: number, target = handle, properties: Partial<PointerEvent> = {}) => {
    pointer("pointerdown", target, properties)
    pointer("pointermove", panel, {clientY: 100 + dy, ...properties})
    pointer("pointerup", panel, {clientY: 100 + dy, ...properties})
  }

  beforeEach(() => {
    onDrag.mockReset()
    onDismiss.mockReset()
    panel = document.createElement("div")
    panel.innerHTML = `
      <header data-swipe-dismiss-handle>
        <h1>Notifications</h1>
        <button><span>Settings</span></button>
      </header>
      <div data-list>Notification content</div>
    `
    document.body.appendChild(panel)
    handle = panel.querySelector("header")!
    let capturedPointer: number | undefined
    panel.setPointerCapture = vi.fn(id => (capturedPointer = id))
    panel.hasPointerCapture = vi.fn(id => capturedPointer === id)
    panel.releasePointerCapture = vi.fn(() => (capturedPointer = undefined))
    Object.defineProperty(panel, "clientHeight", {value: 600})
    action = swipeDismiss(panel, {enabled: true, onDrag, onDismiss})
  })

  afterEach(() => {
    action.destroy()
    panel.remove()
  })

  it("follows a downward touch and dismisses after a deliberate pull", () => {
    drag(130, panel.querySelector("h1")!)
    expect(onDrag).toHaveBeenLastCalledWith(130, true)
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(panel.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it("snaps a short pull back without dismissing", () => {
    drag(40)
    expect(onDrag).toHaveBeenCalledWith(40, true)
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("snaps back if closing is blocked during navigation", () => {
    onDismiss.mockReturnValue(false)
    drag(130)
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
  })

  it.each(["mouse", "pen"])("ignores %s drags", pointerType => {
    drag(180, handle, {pointerType})
    expect(onDrag).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(panel.setPointerCapture).not.toHaveBeenCalled()
  })

  it.each(["button span", "[data-list]"])("does not drag from %s", selector => {
    drag(180, panel.querySelector<HTMLElement>(selector)!)
    expect(onDrag).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it.each([
    {clientX: 260, clientY: 150},
    {clientX: 100, clientY: 20},
  ])("ignores horizontal and upward gestures: %o", properties => {
    pointer("pointerdown", handle)
    pointer("pointermove", panel, properties)
    pointer("pointerup", panel, properties)
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it.each(["pointercancel", "lostpointercapture"])("snaps back on %s", eventType => {
    pointer("pointerdown", handle)
    pointer("pointermove", panel, {clientY: 240})
    pointer(eventType)
    pointer("pointerup", panel, {clientY: 240})
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("cancels when a second finger starts a multi-touch gesture", () => {
    pointer("pointerdown", handle)
    pointer("pointermove", panel, {clientY: 240})
    pointer("pointerdown", handle, {pointerId: 2, isPrimary: false})
    pointer("pointerup", panel, {clientY: 240})
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("ignores unrelated pointers and does not dismiss after a reversed pull", () => {
    pointer("pointerdown", handle)
    pointer("pointermove", panel, {pointerId: 2, clientY: 300})
    expect(onDrag).not.toHaveBeenCalled()
    pointer("pointermove", panel, {clientY: 240})
    pointer("pointermove", panel, {clientY: 110})
    pointer("pointerup", panel, {clientY: 110})
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("suppresses a drag's synthetic click, but not the next deliberate tap", () => {
    drag(40)
    const syntheticClick = new MouseEvent("click", {bubbles: true, cancelable: true})
    expect(handle.dispatchEvent(syntheticClick)).toBe(false)
    pointer("pointerdown", handle)
    pointer("pointerup")
    expect(handle.dispatchEvent(new MouseEvent("click", {cancelable: true}))).toBe(true)
  })

  it("is opt-in and cancels an active drag when disabled", () => {
    pointer("pointerdown", handle)
    pointer("pointermove", panel, {clientY: 240})
    action.update({enabled: false, onDrag, onDismiss})
    expect(onDrag).toHaveBeenLastCalledWith(0, false)
    onDrag.mockClear()
    drag(180)
    expect(onDrag).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("removes listeners and releases capture when destroyed", () => {
    pointer("pointerdown", handle)
    action.destroy()
    expect(panel.releasePointerCapture).toHaveBeenCalledWith(1)
    drag(180)
    expect(onDrag).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
