import {writable} from "svelte/store"

export type ActiveCommunityRoomLoad = {
  communityPubkey: string
  roomId: string
  pending: boolean
}

const emptyActiveCommunityRoomLoad = (): ActiveCommunityRoomLoad => ({
  communityPubkey: "",
  roomId: "",
  pending: false,
})

export const activeCommunityRoomLoad = writable<ActiveCommunityRoomLoad>(
  emptyActiveCommunityRoomLoad(),
)

export const clearActiveCommunityRoomLoad = (communityPubkey: string, roomId: string) =>
  activeCommunityRoomLoad.update(current =>
    current.communityPubkey === communityPubkey && current.roomId === roomId
      ? emptyActiveCommunityRoomLoad()
      : current,
  )
