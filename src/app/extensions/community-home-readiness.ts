export type CommunityHomeCoreReadinessInput = {
  communityPubkey: string
  definitionPubkey: string
  expectedBootstrapKey: string
  expectedPermissionKeyPrefix: string
  bootstrapStatus: {
    key: string
    loading: boolean
    loaded: boolean
    error?: string
  }
  permissionStatus: {
    communityPubkey: string
    key: string
    loading: boolean
    loaded: boolean
    hasCachedEvents: boolean
  }
}

export type CommunityHomeExtensionReadinessInput = CommunityHomeCoreReadinessInput & {
  roomsPresent: boolean
  expectedRoomCatalogKey: string
  firstRoomCatalogKey: string
  firstRoomCatalogTerminal: boolean
}

export type CommunityModeratorEvidenceStatus = "unresolved" | "loading" | "complete"

export const isCommunityHomeCoreReady = ({
  communityPubkey,
  definitionPubkey,
  expectedBootstrapKey,
  expectedPermissionKeyPrefix,
  bootstrapStatus,
  permissionStatus,
}: CommunityHomeCoreReadinessInput) =>
  Boolean(
    communityPubkey &&
    definitionPubkey === communityPubkey &&
    expectedBootstrapKey &&
    bootstrapStatus.key === expectedBootstrapKey &&
    bootstrapStatus.loaded &&
    !bootstrapStatus.loading &&
    !bootstrapStatus.error &&
    expectedPermissionKeyPrefix &&
    permissionStatus.communityPubkey === communityPubkey &&
    permissionStatus.key.startsWith(expectedPermissionKeyPrefix) &&
    (permissionStatus.hasCachedEvents || (permissionStatus.loaded && !permissionStatus.loading)),
  )

export const isCommunityHomeExtensionReady = ({
  roomsPresent,
  expectedRoomCatalogKey,
  firstRoomCatalogKey,
  firstRoomCatalogTerminal,
  ...core
}: CommunityHomeExtensionReadinessInput) =>
  isCommunityHomeCoreReady(core) &&
  (roomsPresent ||
    Boolean(
      expectedRoomCatalogKey &&
      firstRoomCatalogKey === expectedRoomCatalogKey &&
      firstRoomCatalogTerminal,
    ))

export const isCompleteCommunityModeratorEvidence = (
  expectedKey: string,
  state: {key: string; status: CommunityModeratorEvidenceStatus},
) => Boolean(expectedKey && state.key === expectedKey && state.status === "complete")
