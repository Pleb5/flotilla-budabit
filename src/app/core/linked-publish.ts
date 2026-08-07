import {
  abortThunk,
  publishThunk,
  pubkey,
  repository,
  retryThunk,
  waitForAnyRelayAck,
} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"

export type LinkedPublishThunk = ReturnType<typeof publishThunk>

type OriginalFactory = () => LinkedPublishThunk
type TargetFactory = (originalAckRelay: string) => LinkedPublishThunk

export type LinkedPublishOperation = {
  semanticInput?: string
  requiredRelays?: string[]
  originalFactory?: OriginalFactory
  targetFactory?: TargetFactory
  originalThunk?: LinkedPublishThunk
  originalAttempted?: boolean
  originalAckRelay?: string
  originalCommitted?: boolean
  targetThunk?: LinkedPublishThunk
  targetAttempted?: boolean
  targetAcked?: boolean
  targetCommitted?: boolean
  inFlight?: Promise<void>
}

type PublishLinkedOperationParams = {
  operation: LinkedPublishOperation
  semanticInput: string
  requiredRelays?: string[]
  originalFactory?: OriginalFactory
  targetFactory?: TargetFactory
}

const runLinkedPublishOperation = async (operation: LinkedPublishOperation) => {
  const requiredRelays = operation.requiredRelays || []

  if (!operation.originalThunk) {
    operation.originalThunk = operation.originalFactory!()
  }

  if (pubkey.get() !== operation.originalThunk.pubkey) {
    throw new Error("The active publishing account changed. Restore the original account to retry.")
  }

  if (!operation.originalAckRelay) {
    if (operation.originalAttempted) abortThunk(operation.originalThunk)
    const thunk = operation.originalAttempted
      ? (retryThunk(operation.originalThunk) as LinkedPublishThunk)
      : operation.originalThunk
    operation.originalAttempted = true
    operation.originalThunk = thunk

    try {
      const acknowledgement = await waitForAnyRelayAck(thunk, requiredRelays)
      operation.originalAckRelay = acknowledgement.relay
    } catch {
      throw new Error("Original publication was not acknowledged by a required relay. Retry.")
    }
  }

  if (!operation.originalCommitted) {
    repository.publish(operation.originalThunk.event as TrustedEvent)
    operation.originalCommitted = true
  }

  if (!operation.targetThunk) {
    if (pubkey.get() !== operation.originalThunk.pubkey) {
      throw new Error("Restore the account that published the original before linking it.")
    }

    operation.targetThunk = operation.targetFactory!(operation.originalAckRelay)
    if (operation.targetThunk.pubkey !== operation.originalThunk.pubkey) {
      throw new Error("Linked publication stages must use the same publishing account.")
    }
  }

  if (!operation.targetAcked) {
    if (operation.targetAttempted) abortThunk(operation.targetThunk)
    const thunk = operation.targetAttempted
      ? (retryThunk(operation.targetThunk) as LinkedPublishThunk)
      : operation.targetThunk
    operation.targetAttempted = true
    operation.targetThunk = thunk

    try {
      await waitForAnyRelayAck(thunk, [operation.originalAckRelay])
      operation.targetAcked = true
    } catch {
      throw new Error("Target publication was not acknowledged by a required relay. Retry.")
    }
  }

  if (!operation.targetCommitted) {
    repository.publish(operation.targetThunk.event as TrustedEvent)
    operation.targetCommitted = true
  }
}

export const publishLinkedOperation = ({
  operation,
  semanticInput,
  requiredRelays,
  originalFactory,
  targetFactory,
}: PublishLinkedOperationParams) => {
  if (operation.semanticInput !== undefined && operation.semanticInput !== semanticInput) {
    return Promise.reject(
      new Error(
        "Publication input changed while the operation is unfinished. Restore the original values to retry.",
      ),
    )
  }

  if (operation.semanticInput === undefined) {
    if (!requiredRelays?.length || !originalFactory || !targetFactory) {
      return Promise.reject(
        new Error("Linked publication requires relays and both event factories."),
      )
    }

    operation.semanticInput = semanticInput
    operation.requiredRelays = [...requiredRelays]
    operation.originalFactory = originalFactory
    operation.targetFactory = targetFactory
  }

  if (operation.targetCommitted) return Promise.resolve()
  if (operation.inFlight) return operation.inFlight

  const inFlight = runLinkedPublishOperation(operation).finally(() => {
    if (operation.inFlight === inFlight) operation.inFlight = undefined
  })
  operation.inFlight = inFlight

  return inFlight
}
