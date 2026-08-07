import {afterEach, describe, expect, it, vi} from "vitest"
import {
  createNostrGitProvider,
  createNostrGitProviderFromEnv,
  createNostrGitProviderFromGitConfig,
  selectProvider,
} from "../../src/api/providers/nostr-git-factory.js"

const eventIO = {
  fetchEvents: vi.fn(),
  publishEvent: vi.fn(),
} as any

const originalEnvPublish = process.env.NOSTR_PUBLISH_REPO_STATE
const originalGitPublish = process.env.GIT_CONFIG_NOSTR_PUBLISH_STATE

afterEach(() => {
  if (originalEnvPublish === undefined) delete process.env.NOSTR_PUBLISH_REPO_STATE
  else process.env.NOSTR_PUBLISH_REPO_STATE = originalEnvPublish

  if (originalGitPublish === undefined) delete process.env.GIT_CONFIG_NOSTR_PUBLISH_STATE
  else process.env.GIT_CONFIG_NOSTR_PUBLISH_STATE = originalGitPublish
})

describe("NostrGitProvider factory state publication defaults", () => {
  it("disables automatic state publication by default", () => {
    const provider = createNostrGitProvider({eventIO})

    expect((provider as any).nostrConfig.publishRepoState).toBe(false)
  })

  it("requires an explicit true environment opt-in", async () => {
    delete process.env.NOSTR_PUBLISH_REPO_STATE
    let provider = await createNostrGitProviderFromEnv({eventIO})
    expect((provider as any).nostrConfig.publishRepoState).toBe(false)

    process.env.NOSTR_PUBLISH_REPO_STATE = "true"
    provider = await createNostrGitProviderFromEnv({eventIO})
    expect((provider as any).nostrConfig.publishRepoState).toBe(true)
  })

  it("defaults git-config construction to no automatic publication", async () => {
    delete process.env.GIT_CONFIG_NOSTR_PUBLISH_STATE

    const provider = await createNostrGitProviderFromGitConfig({eventIO})

    expect((provider as any).nostrConfig.publishRepoState).toBe(false)
  })

  it("recognizes Nostr URL schemes case-insensitively", () => {
    expect(selectProvider("NOSTR://repository")).toBe("nostr")
  })
})
