import {writable} from "svelte/store"

export const notificationBackgroundEnabled = writable(false)

export const setNotificationBackgroundEnabled = (enabled: boolean) =>
  notificationBackgroundEnabled.set(enabled)

type AdmissionWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
  cancelIdleCallback?: (handle: number) => void
}

export const scheduleNotificationBackgroundAdmission = (
  start: () => void,
  {
    target = window as AdmissionWindow,
    idleTimeoutMs = 4_000,
  }: {target?: AdmissionWindow; idleTimeoutMs?: number} = {},
) => {
  let cancelled = false
  let firstFrame = 0
  let secondFrame = 0
  let idleHandle = 0
  let fallbackTimer = 0
  let deadlineTimer = 0

  const cancel = () => {
    cancelled = true
    if (firstFrame) target.cancelAnimationFrame(firstFrame)
    if (secondFrame) target.cancelAnimationFrame(secondFrame)
    if (idleHandle) target.cancelIdleCallback?.(idleHandle)
    if (fallbackTimer) target.clearTimeout(fallbackTimer)
    if (deadlineTimer) target.clearTimeout(deadlineTimer)
  }
  const admit = () => {
    if (cancelled) return
    cancel()
    start()
  }
  firstFrame = target.requestAnimationFrame(() => {
    if (cancelled) return
    secondFrame = target.requestAnimationFrame(() => {
      if (cancelled) return
      if (target.requestIdleCallback) {
        idleHandle = target.requestIdleCallback(admit, {timeout: idleTimeoutMs})
      } else {
        fallbackTimer = target.setTimeout(admit, 0)
      }
    })
  })
  // Background tabs can suspend animation frames altogether. Rendering is a
  // preferred admission opportunity, not a prerequisite for unread tracking.
  deadlineTimer = target.setTimeout(admit, idleTimeoutMs)

  return cancel
}

export const scheduleNotificationBackgroundStages = (
  stages: Array<() => void>,
  {
    target = window as AdmissionWindow,
    stageDelayMs = 2_000,
    idleTimeoutMs = 4_000,
  }: {target?: AdmissionWindow; stageDelayMs?: number; idleTimeoutMs?: number} = {},
) => {
  let cancelled = false
  let index = 0
  let delayTimer = 0
  let deadlineTimer = 0
  let idleHandle = 0
  let pendingGeneration = 0

  const clearPending = () => {
    pendingGeneration += 1
    if (delayTimer) target.clearTimeout(delayTimer)
    if (idleHandle) target.cancelIdleCallback?.(idleHandle)
    delayTimer = 0
    idleHandle = 0
  }
  const runNext = () => {
    clearPending()
    if (deadlineTimer) target.clearTimeout(deadlineTimer)
    deadlineTimer = 0
    if (cancelled || index >= stages.length) return
    stages[index++]()
    if (index < stages.length) scheduleNext()
  }
  const requestIdle = () => {
    delayTimer = 0
    if (cancelled) return
    const generation = pendingGeneration
    const runCurrent = () => {
      if (generation === pendingGeneration) runNext()
    }
    if (target.requestIdleCallback) {
      idleHandle = target.requestIdleCallback(runCurrent, {timeout: idleTimeoutMs})
    } else {
      delayTimer = target.setTimeout(runCurrent, 0)
    }
  }
  const scheduleNext = () => {
    clearPending()
    delayTimer = target.setTimeout(requestIdle, stageDelayMs)
    // Yield to input, but never postpone unread tracking indefinitely while the
    // user is typing. The deadline belongs to the stage, not the latest input.
    if (!deadlineTimer) {
      deadlineTimer = target.setTimeout(runNext, stageDelayMs + idleTimeoutMs)
    }
  }
  const deferForInput = () => {
    if (!cancelled && index < stages.length) scheduleNext()
  }

  target.addEventListener("pointerdown", deferForInput, {passive: true})
  target.addEventListener("keydown", deferForInput, {passive: true})
  runNext()

  return () => {
    cancelled = true
    clearPending()
    if (deadlineTimer) target.clearTimeout(deadlineTimer)
    target.removeEventListener("pointerdown", deferForInput)
    target.removeEventListener("keydown", deferForInput)
  }
}
