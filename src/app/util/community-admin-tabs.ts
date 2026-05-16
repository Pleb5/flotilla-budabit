import {localStorageProvider, synced} from "@welshman/store"

export type CommunityAdminTab = "settings" | "requests" | "moderators"

export const COMMUNITY_ADMIN_TAB_STORAGE_KEY = "community-admin:selected-tab"

export const communityAdminSelectedTab = synced<CommunityAdminTab>({
  key: COMMUNITY_ADMIN_TAB_STORAGE_KEY,
  defaultValue: "settings",
  storage: localStorageProvider,
})
