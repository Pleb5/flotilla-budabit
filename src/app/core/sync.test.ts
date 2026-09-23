import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const store = <T>(initial: T) => {
    let value = initial
    const listeners = new Set<(value: T) => void>()
    return {
      set(next: T) {
        value = next
        listeners.forEach(fn => fn(value))
      },
      get: () => value,
      subscribe(fn: (value: T) => void) {
        listeners.add(fn)
        fn(value)
        return () => {
          listeners.delete(fn)
        }
      },
    }
  }
  return {
    pubkey: store<string | undefined>(undefined),
    signer: store<object | undefined>(undefined),
    userRelayList: store<any>(null),
    startDmSync: vi.fn(() => vi.fn()),
    loadProfile: vi.fn(),
    loadSettings: vi.fn(),
    loadUserBlossomServerList: vi.fn(),
    loadUserFollowList: vi.fn(),
    loadUserMuteList: vi.fn(),
    hydrateEmailDigestSettings: vi.fn().mockResolvedValue(undefined),
    hydrateCommunityAlertSettings: vi.fn().mockResolvedValue(undefined),
    loadRepoWatch: vi.fn(),
    loadGraspServers: vi.fn(),
    loadTokens: vi.fn(),
    loadExtensionSettings: vi.fn(),
    setupGraspServersSync: vi.fn(() => vi.fn()),
    setupTokensSync: vi.fn(() => vi.fn()),
    setupExtensionSettingsSync: vi.fn(() => vi.fn()),
    clearSyncedGitAuthTokens: vi.fn(),
    applyRemoteExtensionSettings: vi.fn(),
    gitRelays: [] as string[],
    routerUrls: [] as string[],
  }
})
vi.mock("@welshman/app", () => ({
  pubkey: mocks.pubkey,
  signer: mocks.signer,
  userRelayList: mocks.userRelayList,
  loadRelay: vi.fn(),
  loadUserBlossomServerList: mocks.loadUserBlossomServerList,
  loadUserFollowList: mocks.loadUserFollowList,
  loadUserMuteList: mocks.loadUserMuteList,
}))
vi.mock("@welshman/router", () => ({
  Router: {get: () => ({FromUser: () => ({getUrls: () => mocks.routerUrls})})},
}))
vi.mock("@app/core/state", () => ({INDEXER_RELAYS: [], loadSettings: mocks.loadSettings}))
vi.mock("@app/core/profile-resolver", () => ({loadBudabitProfile: mocks.loadProfile}))
vi.mock("@app/core/dm-sync", () => ({
  startDmSync: mocks.startDmSync,
  isChatPath: (path: string) => path === "/chat" || path.startsWith("/chat/"),
}))
vi.mock("@app/core/git-state", () => ({GIT_RELAYS: mocks.gitRelays}))
vi.mock("@app/core/git-requests", () => ({
  loadGraspServers: mocks.loadGraspServers,
  loadTokens: mocks.loadTokens,
  loadExtensionSettings: mocks.loadExtensionSettings,
  setupGraspServersSync: mocks.setupGraspServersSync,
  setupTokensSync: mocks.setupTokensSync,
  setupExtensionSettingsSync: mocks.setupExtensionSettingsSync,
  clearSyncedGitAuthTokens: mocks.clearSyncedGitAuthTokens,
}))
vi.mock("@app/extensions/settings", () => ({
  applyRemoteExtensionSettings: mocks.applyRemoteExtensionSettings,
}))
vi.mock("@app/core/repo-watch", () => ({loadRepoWatch: mocks.loadRepoWatch}))
vi.mock("@app/core/email-digest-state", () => ({
  hydrateEmailDigestSettings: mocks.hydrateEmailDigestSettings,
}))
vi.mock("@app/core/community-alerts-state", () => ({
  hydrateCommunityAlertSettings: mocks.hydrateCommunityAlertSettings,
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe("syncApplicationData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pubkey.set(undefined)
    mocks.signer.set(undefined)
    mocks.userRelayList.set(null)
    mocks.gitRelays.splice(0)
    mocks.routerUrls.splice(0)
  })

  it("owns and cleans up one shared DM synchronization lifecycle", async () => {
    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    expect(mocks.startDmSync).toHaveBeenCalledTimes(1)
    cleanup()
    expect(mocks.startDmSync.mock.results[0].value).toHaveBeenCalledTimes(1)
  })

  it("lets Git sync setup own the initial fallback loads", async () => {
    mocks.gitRelays.push("wss://two.example.com", "wss://one.example.com")
    mocks.routerUrls.push("wss://one.example.com", "wss://two.example.com")
    mocks.pubkey.set("a".repeat(64))
    const {syncGitData} = await import("./sync")
    const cleanup = syncGitData()
    await flush()
    expect(mocks.setupGraspServersSync).toHaveBeenCalledTimes(1)
    expect(mocks.setupTokensSync).toHaveBeenCalledTimes(1)
    expect(mocks.setupExtensionSettingsSync).toHaveBeenCalledTimes(1)
    expect(mocks.loadGraspServers).not.toHaveBeenCalled()
    expect(mocks.loadTokens).not.toHaveBeenCalled()
    expect(mocks.loadExtensionSettings).not.toHaveBeenCalled()
    cleanup()
  })

  it("loads current-user metadata when the user relay list is available", async () => {
    const self = "b".repeat(64)
    mocks.signer.set({})
    mocks.userRelayList.set({event: {pubkey: self}})
    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    expect(mocks.loadSettings).toHaveBeenCalledWith(self)
    expect(mocks.loadRepoWatch).toHaveBeenCalledWith(self)
    expect(mocks.hydrateEmailDigestSettings).toHaveBeenCalledWith(self)
    expect(mocks.hydrateCommunityAlertSettings).toHaveBeenCalledWith(self)
    expect(mocks.loadUserBlossomServerList).toHaveBeenCalledWith()
    expect(mocks.loadUserFollowList).toHaveBeenCalledWith()
    expect(mocks.loadUserMuteList).toHaveBeenCalledWith()
    expect(mocks.loadProfile).toHaveBeenCalledWith(self)
    cleanup()
  })

  it("hydrates community alert settings when the signer becomes available", async () => {
    const self = "b".repeat(64)
    mocks.userRelayList.set({event: {pubkey: self}})
    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    expect(mocks.hydrateCommunityAlertSettings).not.toHaveBeenCalled()
    mocks.signer.set({})
    expect(mocks.hydrateCommunityAlertSettings).toHaveBeenCalledWith(self)
    cleanup()
  })

  it("does not preload metadata without a current-user relay list", async () => {
    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()
    expect(mocks.loadProfile).not.toHaveBeenCalled()
    expect(mocks.loadUserFollowList).not.toHaveBeenCalled()
    expect(mocks.loadUserMuteList).not.toHaveBeenCalled()
    cleanup()
  })

  it("does not start additional fallback loads from global Git sync", async () => {
    mocks.pubkey.set("d".repeat(64))
    const {syncGitData} = await import("./sync")
    const cleanup = syncGitData()
    await flush()
    expect(mocks.loadGraspServers).not.toHaveBeenCalled()
    expect(mocks.loadTokens).not.toHaveBeenCalled()
    expect(mocks.loadExtensionSettings).not.toHaveBeenCalled()
    cleanup()
  })
})
