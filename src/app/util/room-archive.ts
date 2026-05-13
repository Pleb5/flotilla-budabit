import type {TrustedEvent} from "@welshman/util"
import {getTagValue} from "@welshman/util"

type RoomLike = {
  isArchived?: boolean
}

type ChannelLike = {
  archived?: boolean
}

type ArchivableItem = {
  isArchived?: boolean
  archived?: boolean
}

const makeChannelReferenceId = (url: string, room: string) => {
  if (room.startsWith("naddr1")) {
    return "naddr1"
  }

  return `${url}'${room}`
}

const makeRoomReferenceId = (url: string, room: string) => `${url}'${room}`

export const partitionArchivedItems = <T extends ArchivableItem>(items: T[]) => {
  const active: T[] = []
  const archived: T[] = []

  for (const item of items) {
    if (item.isArchived || item.archived) {
      archived.push(item)
    } else {
      active.push(item)
    }
  }

  return {active, archived}
}

export const isArchivedRoomReference = ({
  url,
  h,
  roomsById,
  channelsById,
}: {
  url: string
  h?: string | null
  roomsById: Map<string, RoomLike>
  channelsById: Map<string, ChannelLike>
}) => {
  if (!h) {
    return false
  }

  return Boolean(
    roomsById.get(makeRoomReferenceId(url, h))?.isArchived ||
    channelsById.get(makeChannelReferenceId(url, h))?.archived,
  )
}

export const filterArchivedRoomMessages = ({
  url,
  messages,
  roomsById,
  channelsById,
}: {
  url: string
  messages: TrustedEvent[]
  roomsById: Map<string, RoomLike>
  channelsById: Map<string, ChannelLike>
}) =>
  messages.filter(
    event =>
      !isArchivedRoomReference({
        url,
        h: getTagValue("h", event.tags),
        roomsById,
        channelsById,
      }),
  )

export const getRoomInteractionState = ({isArchivedRoom}: {isArchivedRoom: boolean}) => ({
  isReadOnly: isArchivedRoom,
  showArchivedBanner: isArchivedRoom,
  allowMessageActions: !isArchivedRoom,
  showCompose: !isArchivedRoom,
})
