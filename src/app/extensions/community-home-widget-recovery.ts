import type {Writable} from "svelte/store"
import type {CommunitySharedConfigDescriptorAuthority} from "./community-shared-config"
import type {SmartWidgetEvent} from "./types"
import type {WidgetCommunitySlotType} from "./types"

export type CommunityHomeWidgetRecoveryState = {
  communityAddress: string
  curatedWidgets: SmartWidgetEvent[]
  sharedConfigEvents: any[]
  authorizedPubkeys: Set<string>
  descriptorAuthorities: CommunitySharedConfigDescriptorAuthority[]
  curatedFirstAttemptTerminal: boolean
  curatedFirstAttemptComplete: boolean
  sharedConfigFirstAttemptTerminal: boolean
  sharedConfigFirstAttemptComplete: boolean
}

export type CommunityHomeWidgetSlotInitialState = {
  slotType: WidgetCommunitySlotType
  frameCount: number
  loadedCount: number
  resolvedCount: number
  terminal: boolean
}

export type CommunityHomeWidgetRecoveryStore = Writable<CommunityHomeWidgetRecoveryState>

export const emptyCommunityHomeWidgetRecoveryState = (): CommunityHomeWidgetRecoveryState => ({
  communityAddress: "",
  curatedWidgets: [],
  sharedConfigEvents: [],
  authorizedPubkeys: new Set(),
  descriptorAuthorities: [],
  curatedFirstAttemptTerminal: false,
  curatedFirstAttemptComplete: false,
  sharedConfigFirstAttemptTerminal: false,
  sharedConfigFirstAttemptComplete: false,
})
