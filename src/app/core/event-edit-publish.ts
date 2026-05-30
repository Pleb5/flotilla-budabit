import {publishThunk} from "@welshman/app"
import {COMMENT, MESSAGE, makeEvent, type TrustedEvent} from "@welshman/util"
import {publishSocialDelete} from "@app/core/commands"
import {
  makeEditedMessageTemplate,
  makeEditedReplyTemplate,
  suppressEventAfterEdit,
} from "@app/core/event-edits"

export const publishEditedMessage = ({
  event,
  content,
  tags = [],
  relays,
  url,
  delay,
}: {
  event: TrustedEvent
  content: string
  tags?: string[][]
  relays: string[]
  url?: string
  delay?: number
}) => {
  suppressEventAfterEdit(event)
  publishSocialDelete({url, relays, event})

  return publishThunk({
    relays,
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
}: {
  event: TrustedEvent
  content: string
  tags?: string[][]
  relays: string[]
  url?: string
}) => {
  suppressEventAfterEdit(event)
  publishSocialDelete({url, relays, event})

  return publishThunk({
    relays,
    event: makeEvent(COMMENT, makeEditedReplyTemplate(event, {content, tags})),
  })
}
