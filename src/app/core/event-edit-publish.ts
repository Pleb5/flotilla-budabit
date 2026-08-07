import {pubkey, publishThunk, repository, retryThunk, waitForAnyRelayAck} from "@welshman/app"
import {COMMENT, MESSAGE, makeEvent, type TrustedEvent} from "@welshman/util"
import {publishSocialDelete} from "@app/core/commands"
import {
  makeEditedMessageTemplate,
  makeEditedReplyTemplate,
  suppressEventAfterEdit,
} from "@app/core/event-edits"
import {requireRepoPublicationScope} from "@app/core/repo-publication"
import {signEventForPublication} from "@app/core/publication"

type EditKind = typeof COMMENT | typeof MESSAGE
type EditThunk = ReturnType<typeof publishThunk>

type EditOperation = {
  semanticEdit: string
  event: TrustedEvent
  url?: string
  repoAddress?: string
  replacementThunk: EditThunk
  replacementAttempted: boolean
  replacementAckRelay?: string
  replacementPublished: boolean
  deleteThunk?: EditThunk
  deleteAttempted: boolean
  deleteAcked: boolean
  deletePublished: boolean
  suppressed: boolean
  inFlight?: Promise<void>
}

const editOperations = new Map<string, EditOperation>()
const editPreparations = new Map<string, {semanticEdit: string; promise: Promise<void>}>()

const getSemanticEdit = ({
  kind,
  content,
  tags,
  relays,
  url,
  repoAddress,
}: {
  kind: EditKind
  content: string
  tags: string[][]
  relays: string[]
  url?: string
  repoAddress?: string
}) => JSON.stringify([kind, content, tags, relays, url, repoAddress])

const runEditOperation = async (operation: EditOperation) => {
  if (!operation.replacementAckRelay) {
    const thunk = operation.replacementAttempted
      ? (retryThunk(operation.replacementThunk) as EditThunk)
      : operation.replacementThunk
    operation.replacementAttempted = true
    operation.replacementThunk = thunk

    try {
      const acknowledgement = await waitForAnyRelayAck(thunk, thunk.options.relays)
      operation.replacementAckRelay = acknowledgement.relay
    } catch {
      throw new Error("Replacement was not acknowledged. Retry to continue the edit.")
    }
  }

  if (!operation.replacementPublished) {
    repository.publish(operation.replacementThunk.event as TrustedEvent)
    operation.replacementPublished = true
  }

  if (!operation.deleteThunk) {
    if (pubkey.get() !== operation.replacementThunk.pubkey) {
      throw new Error("Restore the account that started this edit before deleting the original.")
    }

    operation.deleteThunk = publishSocialDelete({
      url: operation.url,
      relays: [operation.replacementAckRelay],
      event: operation.event,
      repoAddress: operation.repoAddress,
      optimistic: false,
    })
  }

  if (!operation.deleteAcked) {
    const thunk = operation.deleteAttempted
      ? (retryThunk(operation.deleteThunk) as EditThunk)
      : operation.deleteThunk
    operation.deleteAttempted = true
    operation.deleteThunk = thunk

    try {
      await waitForAnyRelayAck(thunk, [operation.replacementAckRelay])
      operation.deleteAcked = true
    } catch {
      throw new Error("Replacement published, but deletion was not acknowledged. Retry the edit.")
    }
  }

  if (!operation.deletePublished) {
    repository.publish(operation.deleteThunk.event as TrustedEvent)
    operation.deletePublished = true
  }

  if (!operation.suppressed) {
    suppressEventAfterEdit(operation.event)
    operation.suppressed = true
  }

  editOperations.delete(operation.event.id)
}

const publishEdit = async ({
  kind,
  event,
  content,
  tags,
  relays,
  url,
  repoAddress,
  delay,
}: {
  kind: EditKind
  event: TrustedEvent
  content: string
  tags: string[][]
  relays: string[]
  url?: string
  repoAddress?: string
  delay?: number
}) => {
  if (pubkey.get() !== event.pubkey) {
    throw new Error("Restore the account that authored this event before editing it.")
  }

  const semanticEdit = getSemanticEdit({kind, content, tags, relays, url, repoAddress})
  const existing = editOperations.get(event.id)

  if (existing) {
    if (existing.semanticEdit !== semanticEdit) {
      throw new Error(
        "This event already has a retained edit with different content or tags. Retry the original edit.",
      )
    }
    if (existing.suppressed) return Promise.resolve()
    if (existing.inFlight) return existing.inFlight
    if (pubkey.get() !== existing.replacementThunk.pubkey) {
      throw new Error("Restore the account that started this edit before retrying it.")
    }
  }

  if (existing) {
    const inFlight = runEditOperation(existing).finally(() => {
      existing.inFlight = undefined
    })
    existing.inFlight = inFlight
    return inFlight
  }

  const preparing = editPreparations.get(event.id)
  if (preparing) {
    if (preparing.semanticEdit !== semanticEdit) {
      throw new Error("This event already has a different edit being prepared.")
    }
    return preparing.promise
  }

  const preparation = (async () => {
    const template =
      kind === MESSAGE
        ? makeEditedMessageTemplate(event, {content, tags})
        : makeEditedReplyTemplate(event, {content, tags})
    const replacementEvent = makeEvent(kind, template)
    const publishRelays = repoAddress
      ? requireRepoPublicationScope({event: replacementEvent, relays, repoAddress})
      : relays
    const signedReplacement = await signEventForPublication(replacementEvent)
    if (repoAddress) {
      requireRepoPublicationScope({event: signedReplacement, relays: publishRelays, repoAddress})
    }
    const operation: EditOperation = {
      semanticEdit,
      event,
      url,
      repoAddress,
      replacementThunk: publishThunk({
        relays: publishRelays,
        event: signedReplacement,
        optimistic: false,
        delay,
      }),
      replacementAttempted: false,
      replacementPublished: false,
      deleteAttempted: false,
      deleteAcked: false,
      deletePublished: false,
      suppressed: false,
    }

    editOperations.set(event.id, operation)
    const inFlight = runEditOperation(operation).finally(() => {
      operation.inFlight = undefined
    })
    operation.inFlight = inFlight
    return inFlight
  })().finally(() => {
    editPreparations.delete(event.id)
  })

  editPreparations.set(event.id, {semanticEdit, promise: preparation})
  return preparation
}

export const publishEditedMessage = async ({
  event,
  content,
  tags = [],
  relays,
  url,
  repoAddress,
  delay,
}: {
  event: TrustedEvent
  content: string
  tags?: string[][]
  relays: string[]
  url?: string
  repoAddress?: string
  delay?: number
}) =>
  publishEdit({
    kind: MESSAGE,
    event,
    content,
    tags,
    relays,
    url,
    repoAddress,
    delay,
  })

export const publishEditedReply = async ({
  event,
  content,
  tags = [],
  relays,
  url,
  repoAddress,
}: {
  event: TrustedEvent
  content: string
  tags?: string[][]
  relays: string[]
  url?: string
  repoAddress?: string
}) =>
  publishEdit({
    kind: COMMENT,
    event,
    content,
    tags,
    relays,
    url,
    repoAddress,
  })
