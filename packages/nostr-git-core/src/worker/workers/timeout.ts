import {createTimeoutError} from "../../errors/factory.js"
import type {GitErrorContext} from "../../errors/types.js"

export interface TimeoutConfig {
  timeoutMs: number
  label: string
  context?: GitErrorContext
}

export async function withTimeout<T>(promise: Promise<T>, config: TimeoutConfig): Promise<T> {
  const {timeoutMs, label, context} = config
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = createTimeoutError({
        ...context,
        operation: context?.operation || label,
      })
      error.message = `Timeout: ${label} exceeded ${Math.round(timeoutMs / 1000)}s`
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
