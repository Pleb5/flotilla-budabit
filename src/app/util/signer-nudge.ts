import {sign as appSign, signer, signerLog, SignerLogEntryStatus} from "@welshman/app"
import type {StampedEvent, SignedEvent} from "@welshman/util"
import {pushToast, popToast, toast} from "@app/util/toast"

// Soft threshold: after this long a nudge toast tells the user we're waiting.
// Set well above typical bunker roundtrip latency so healthy signers never
// trigger a nudge - the toast should only appear when something is actually
// wrong.
const SIGNER_SIGN_SOFT_TIMEOUT_MS = 12_000
// Hard threshold: sign() is rejected so downstream `withTimeout` wrappers can
// wake up and move on. The signer will still deliver a late response into
// the log; we just no longer block callers.
const SIGNER_SIGN_HARD_TIMEOUT_MS = 45_000
// After a nudge toast has been shown, wait this long before showing another
// one so slow signers don't spam the UI.
const SIGNER_NUDGE_COOLDOWN_MS = 45_000

let lastNudgeAt = 0
let currentNudgeToastId = ""

const clearNudgeToast = () => {
  if (!currentNudgeToastId) return

  popToast(currentNudgeToastId)
  currentNudgeToastId = ""
}

const showNudgeToast = () => {
  const now = Date.now()
  if (now - lastNudgeAt < SIGNER_NUDGE_COOLDOWN_MS) return

  lastNudgeAt = now
  clearNudgeToast()
  currentNudgeToastId = pushToast({
    theme: "warning",
    timeout: 10_000,
    message: "Waiting on your signer\u2026",
  })
}

/**
 * Wrap a sign call with a soft nudge toast and a hard timeout so that a
 * slow or unreachable bunker cannot stall the caller indefinitely.
 *
 * The underlying signer promise is not cancelled - `@welshman/signer` does
 * not expose a cancel primitive - but downstream callers get a rejection
 * they can recover from, which is what matters for UI responsiveness.
 */
export const signWithNudge = async (event: StampedEvent): Promise<SignedEvent> => {
  const activeSigner = signer.get()
  if (!activeSigner) throw new Error("No active signer")

  let softTimer: ReturnType<typeof setTimeout> | undefined
  let hardTimer: ReturnType<typeof setTimeout> | undefined

  const softPromise = new Promise<void>(resolve => {
    softTimer = setTimeout(() => {
      showNudgeToast()
      resolve()
    }, SIGNER_SIGN_SOFT_TIMEOUT_MS)
  })

  const hardPromise = new Promise<never>((_resolve, reject) => {
    hardTimer = setTimeout(() => {
      reject(new Error("Signer sign timed out"))
    }, SIGNER_SIGN_HARD_TIMEOUT_MS)
  })

  try {
    const signed = await Promise.race([activeSigner.sign(event), hardPromise])
    return signed
  } finally {
    if (softTimer) clearTimeout(softTimer)
    if (hardTimer) clearTimeout(hardTimer)
    // Consume the soft promise so it doesn't leak an unhandled rejection.
    void softPromise
    clearNudgeToast()
  }
}

/**
 * Drop-in replacement for `sign` from `@welshman/app` that adds a hard
 * timeout without the toast side-effect. Use at boundaries that need a
 * bounded promise (e.g. relay auth). Callers that also want the nudge UI
 * should prefer `signWithNudge`.
 */
export const signWithTimeout: typeof appSign = event => {
  return new Promise<SignedEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Signer sign timed out"))
    }, SIGNER_SIGN_HARD_TIMEOUT_MS)

    Promise.resolve(appSign(event))
      .then(value => {
        clearTimeout(timer)
        if (value === undefined) {
          reject(new Error("No active signer"))
          return
        }
        resolve(value)
      })
      .catch(error => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/**
 * Passive watcher: subscribe to `signerLog` and if any single entry has been
 * `Pending` for the soft threshold, surface a nudge toast. This catches
 * sign calls that bypass `signWithNudge`.
 *
 * Returns an unsubscribe function.
 */
export const setupSignerNudgeWatcher = () => {
  let checkTimer: ReturnType<typeof setInterval> | undefined
  const started: Record<string, number> = {}

  const unsubscribe = signerLog.subscribe(entries => {
    const now = Date.now()
    const pending = entries.filter(entry => entry.status === SignerLogEntryStatus.Pending)

    // Track first-seen time so we know how long each has been pending.
    for (const entry of pending) {
      if (!started[entry.id]) started[entry.id] = now
    }

    // Prune ids that are no longer pending.
    for (const id of Object.keys(started)) {
      if (!pending.some(entry => entry.id === id)) delete started[id]
    }

    if (pending.length === 0) {
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = undefined
      }
      return
    }

    // Start a low-frequency check while at least one op is pending.
    if (!checkTimer) {
      checkTimer = setInterval(() => {
        const nowInner = Date.now()
        const oldest = Math.min(...Object.values(started))
        if (!Number.isFinite(oldest)) return
        if (nowInner - oldest >= SIGNER_SIGN_SOFT_TIMEOUT_MS) {
          if (!isToastVisible()) showNudgeToast()
        }
      }, 1_000)
    }
  })

  return () => {
    unsubscribe()
    if (checkTimer) {
      clearInterval(checkTimer)
      checkTimer = undefined
    }
    clearNudgeToast()
  }
}

const isToastVisible = () => {
  let visible = false
  const unsubscribe = toast.subscribe(list => {
    visible = list.length > 0
  })
  unsubscribe()
  return visible
}
