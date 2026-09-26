import {afterEach, describe, expect, it, vi} from 'vitest'
import type {WidgetBridge} from 'budabit-sdk'
import {observeContentHeight} from './content-height'

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks()})

function harness() {
  let onResize!: () => void
  let onMutation!: () => void
  let init!: (payload: unknown) => void
  let pending: FrameRequestCallback | undefined
  let contentHeight = 240
  const root = document.createElement('div')
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({height: contentHeight} as DOMRect))
  Object.defineProperty(root, 'scrollHeight', {get: () => contentHeight})
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) {onResize = callback}
    observe() {}
    disconnect = disconnect
  })
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) {onMutation = callback}
    observe() {}
    disconnect = disconnect
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {pending = callback; return 1}))
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => {pending = undefined}))
  const offInit = vi.fn()
  const request = vi.fn().mockResolvedValue({status: 'ok'})
  const bridge = {
    request,
    onEvent: vi.fn((_action, callback) => {init = callback; return offInit}),
  } as unknown as WidgetBridge
  const dispose = observeContentHeight(bridge, root)
  return {
    request, dispose, offInit, disconnect,
    init: (resize: boolean, limit = 1_000_000) => init({capabilities: {surface: {resize}, limits: {widgetResizeHeight: limit}}}),
    height: (height: number) => {contentHeight = height; onResize()},
    mutation: () => onMutation(),
    flush: () => {const callback = pending; pending = undefined; callback?.(0)},
  }
}

describe('content-sized workflow iframe', () => {
  it('grows beyond card limits and shrinks after logs collapse without a viewport-height feedback loop', () => {
    const h = harness()
    h.init(true)
    h.flush()
    expect(h.request).toHaveBeenLastCalledWith('ui:resize', {height: 240})
    h.height(12_500)
    h.flush()
    expect(h.request).toHaveBeenLastCalledWith('ui:resize', {height: 12_500})
    vi.stubGlobal('innerHeight', 12_500)
    h.height(240)
    h.flush()
    expect(h.request).toHaveBeenLastCalledWith('ui:resize', {height: 240})
    h.dispose()
  })

  it('coalesces DOM changes, respects host limits, and stops observing on unmount', () => {
    const h = harness()
    h.init(true, 2400)
    h.height(9000)
    h.mutation()
    h.flush()
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(h.request).toHaveBeenLastCalledWith('ui:resize', {height: 2400})
    h.mutation()
    h.flush()
    expect(h.request).toHaveBeenCalledTimes(1)
    h.height(800)
    h.dispose()
    h.flush()
    h.height(500)
    h.mutation()
    h.flush()
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(h.disconnect).toHaveBeenCalledTimes(2)
    expect(h.offInit).toHaveBeenCalledOnce()
  })

  it('keeps ordinary iframe scrolling available on hosts without resize support', () => {
    const h = harness()
    h.init(false)
    h.height(9000)
    h.flush()
    expect(h.request).not.toHaveBeenCalled()
    h.init(true)
    h.flush()
    expect(h.request).toHaveBeenLastCalledWith('ui:resize', {height: 9000})
    h.dispose()
  })
})
