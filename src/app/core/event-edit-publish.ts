import {publishThunk} from "@welshman/app"
import {COMMENT, MESSAGE, makeEvent, type TrustedEvent} from "@welshman/util"
import {publishSocialDelete} from "@app/core/commands"
import {
  makeEditedMessageTemplate,
  makeEditedReplyTemplate,
  suppressEventAfterEdit,
} from "@app/core/event-edits"
import {requireRepoPublicationScope} from "@app/core/repo-publication"

export const publishEditedMessage = ({
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
}) => {
  const publishRelays = repoAddress
    ? requireRepoPublicationScope({event, relays, repoAddress})
    : relays
  suppressEventAfterEdit(event)
  publishSocialDelete({url, relays: publishRelays, event, repoAddress})

  return publishThunk({
    relays: publishRelays,
    event: makeEvent(MESSAGE, makeEditedMessageTemplate(event, {content, tags})),
    delay,
  })
}

export const publishEditedReply = ({
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
}) => {
  const publishRelays = repoAddress
    ? requireRepoPublicationScope({event, relays, repoAddress})
    : relays
  suppressEventAfterEdit(event)
  publishSocialDelete({url, relays: publishRelays, event, repoAddress})

  return publishThunk({
    relays: publishRelays,
    event: makeEvent(COMMENT, makeEditedReplyTemplate(event, {content, tags})),
  })
}
