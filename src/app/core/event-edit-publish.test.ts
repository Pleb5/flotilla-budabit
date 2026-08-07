import {beforeEach, describe, expect, it, vi} from "vitest"
import {COMMENT, type TrustedEvent} from "@welshman/util"

const mocks = vi.hoisted(() => ({
  actions: [] as string[],
  publishThunk: vi.fn(),
  retryThunk: vi.fn(),
  waitForAnyRelayAck: vi.fn(),
  repositoryPublish: vi.fn(),
  publishSocialDelete: vi.fn(),
  suppressEventAfterEdit: vi.fn(),
  requireRepoPublicationScope: vi.fn(),
  signEventForPublication: vi.fn(),
}))

vi.mock("@welshman/app", () => ({
  pubkey: {get: () => "a".repeat(64)},
  publishThunk: mocks.publishThunk,
  retryThunk: mocks.retryThunk,
  waitForAnyRelayAck: mocks.waitForAnyRelayAck,
  repository: {publish: mocks.repositoryPublish},
}))

vi.mock("@app/core/commands", () => ({
  publishSocialDelete: mocks.publishSocialDelete,
}))

vi.mock("@app/core/event-edits", () => ({
  makeEditedMessageTemplate: (_event: TrustedEvent, edit: {content: string; tags: string[][]}) =>
    edit,
  makeEditedReplyTemplate: (_event: TrustedEvent, edit: {content: string; tags: string[][]}) =>
    edit,
  suppressEventAfterEdit: mocks.suppressEventAfterEdit,
}))

vi.mock("@app/core/repo-publication", () => ({
  requireRepoPublicationScope: mocks.requireRepoPublicationScope,
}))

vi.mock("@app/core/publication", () => ({
  signEventForPublication: mocks.signEventForPublication,
}))

type TestThunk = {
  phase: "replacement" | "delete"
  pubkey: string
  event: TrustedEvent
  options: {relays: string[]; optimistic: boolean}
}

const relayOne = "wss://relay-one.example/"
const relayTwo = "wss://relay-two.example/"
const pubkey = "a".repeat(64)

const makeOriginal = (id: string): TrustedEvent =>
  ({
    id,
    pubkey,
    created_at: 1,
    kind: COMMENT,
    tags: [["e", "root"]],
    content: "before",
    sig: "sig",
  }) as TrustedEvent

const makeParams = (
  event: TrustedEvent,
  content = "after",
  tags: string[][] = [["t", "edit"]],
) => ({event, content, tags, relays: [relayOne, relayTwo]})

describe("replacement-first event edit publication", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.actions.length = 0
    mocks.publishThunk.mockReset()
    mocks.retryThunk.mockReset()
    mocks.waitForAnyRelayAck.mockReset()
    mocks.repositoryPublish.mockReset()
    mocks.publishSocialDelete.mockReset()
    mocks.suppressEventAfterEdit.mockReset()
    mocks.requireRepoPublicationScope.mockReset()
    mocks.signEventForPublication.mockReset()

    mocks.signEventForPublication.mockImplementation(async event => ({
      ...event,
      id: "signed-replacement-id",
      pubkey,
      sig: "signed-replacement-sig",
    }))

    mocks.publishThunk.mockImplementation(
      (options: TestThunk["options"] & {event: TrustedEvent}) => {
        const thunk: TestThunk = {
          phase: "replacement",
          pubkey,
          event: {...options.event, id: "replacement-id", pubkey, sig: "replacement-sig"},
          options,
        }
        mocks.actions.push("publish:replacement")
        return thunk
      },
    )
    mocks.publishSocialDelete.mockImplementation(
      (options: {relays: string[]; optimistic: boolean}) => {
        const thunk: TestThunk = {
          phase: "delete",
          pubkey,
          event: {
            id: "delete-id",
            pubkey,
            created_at: 2,
            kind: 5,
            tags: [],
            content: "",
            sig: "delete-sig",
          } as TrustedEvent,
          options,
        }
        mocks.actions.push("publish:delete")
        return thunk
      },
    )
    mocks.retryThunk.mockImplementation((thunk: TestThunk) => {
      mocks.actions.push(`retry:${thunk.phase}`)
      return {...thunk, event: thunk.event}
    })
    mocks.repositoryPublish.mockImplementation((event: TrustedEvent) => {
      mocks.actions.push(`repository:${event.id}`)
      return true
    })
    mocks.suppressEventAfterEdit.mockImplementation(() => {
      mocks.actions.push("suppress")
    })
    mocks.requireRepoPublicationScope.mockImplementation(({relays}: {relays: string[]}) => relays)
  })

  it("publishes and acknowledges the replacement before creating the delete", async () => {
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      mocks.actions.push(`ack:${thunk.phase}`)
      return {relay: relayOne}
    })
    const {publishEditedReply} = await import("./event-edit-publish")

    await publishEditedReply(makeParams(makeOriginal("replacement-first")))

    expect(mocks.publishThunk).toHaveBeenCalledWith(
      expect.objectContaining({optimistic: false, relays: [relayOne, relayTwo]}),
    )
    expect(mocks.publishSocialDelete).toHaveBeenCalledWith(
      expect.objectContaining({optimistic: false}),
    )
    expect(mocks.actions.indexOf("ack:replacement")).toBeLessThan(
      mocks.actions.indexOf("publish:delete"),
    )
  })

  it("restricts deletion to the relay that acknowledged the replacement", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue({relay: relayTwo})
    const {publishEditedReply} = await import("./event-edit-publish")

    await publishEditedReply(makeParams(makeOriginal("same-relay")))

    expect(mocks.publishSocialDelete).toHaveBeenCalledWith(
      expect.objectContaining({relays: [relayTwo]}),
    )
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({phase: "delete"}),
      [relayTwo],
    )
  })

  it("does not delete, publish locally, or suppress when replacement publication fails", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValueOnce(new Error("relay rejected"))
    const {publishEditedReply} = await import("./event-edit-publish")

    await expect(
      publishEditedReply(makeParams(makeOriginal("replacement-failure"))),
    ).rejects.toThrow("Replacement was not acknowledged")

    expect(mocks.publishSocialDelete).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(mocks.suppressEventAfterEdit).not.toHaveBeenCalled()
  })

  it("validates repository authority before publication side effects", async () => {
    mocks.requireRepoPublicationScope.mockImplementation(() => {
      throw new Error("invalid repository authority")
    })
    const {publishEditedReply} = await import("./event-edit-publish")

    await expect(
      publishEditedReply({
        ...makeParams(makeOriginal("repo-authority")),
        repoAddress: `30617:${pubkey}:repo`,
      }),
    ).rejects.toThrow("invalid repository authority")

    expect(mocks.publishThunk).not.toHaveBeenCalled()
    expect(mocks.publishSocialDelete).not.toHaveBeenCalled()
    expect(mocks.repositoryPublish).not.toHaveBeenCalled()
    expect(mocks.suppressEventAfterEdit).not.toHaveBeenCalled()
  })

  it("retries the retained exact replacement on a later matching attempt", async () => {
    let replacementAttempt = 0
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      if (thunk.phase === "delete") return {relay: relayOne}
      replacementAttempt += 1
      if (replacementAttempt === 1) throw new Error("replacement rejected")
      return {relay: relayOne}
    })
    const {publishEditedReply} = await import("./event-edit-publish")
    const params = makeParams(makeOriginal("replacement-retry"))

    await expect(publishEditedReply(params)).rejects.toThrow("Replacement was not acknowledged")
    const exactReplacement = (mocks.publishThunk.mock.results[0]?.value as TestThunk).event

    await publishEditedReply(params)

    expect(mocks.publishThunk).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledWith(
      expect.objectContaining({phase: "replacement", event: exactReplacement}),
    )
    expect((mocks.retryThunk.mock.results[0]?.value as TestThunk).event).toBe(exactReplacement)
  })

  it("retries only the retained exact delete after delete publication fails", async () => {
    let deleteAttempt = 0
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      if (thunk.phase === "replacement") return {relay: relayOne}
      deleteAttempt += 1
      if (deleteAttempt === 1) throw new Error("delete rejected")
      return {relay: relayOne}
    })
    const {publishEditedReply} = await import("./event-edit-publish")
    const params = makeParams(makeOriginal("delete-retry"))

    await expect(publishEditedReply(params)).rejects.toThrow("deletion was not acknowledged")
    const exactDelete = (mocks.publishSocialDelete.mock.results[0]?.value as TestThunk).event

    await publishEditedReply(params)

    expect(mocks.publishThunk).toHaveBeenCalledTimes(1)
    expect(mocks.publishSocialDelete).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledWith(
      expect.objectContaining({phase: "delete", event: exactDelete}),
    )
    expect((mocks.retryThunk.mock.results[0]?.value as TestThunk).event).toBe(exactDelete)
  })

  it("publishes the acknowledged delete locally before suppressing the original", async () => {
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      mocks.actions.push(`ack:${thunk.phase}`)
      return {relay: relayOne}
    })
    const {publishEditedReply} = await import("./event-edit-publish")

    await publishEditedReply(makeParams(makeOriginal("suppression-order")))

    expect(mocks.actions).toEqual([
      "publish:replacement",
      "ack:replacement",
      "repository:replacement-id",
      "publish:delete",
      "ack:delete",
      "repository:delete-id",
      "suppress",
    ])
  })

  it("rejects changed content while an unfinished exact edit is retained", async () => {
    mocks.waitForAnyRelayAck.mockRejectedValueOnce(new Error("relay rejected"))
    const {publishEditedReply} = await import("./event-edit-publish")
    const event = makeOriginal("changed-edit")

    await expect(publishEditedReply(makeParams(event, "first edit"))).rejects.toThrow(
      "Replacement was not acknowledged",
    )
    await expect(publishEditedReply(makeParams(event, "different edit"))).rejects.toThrow(
      "different content or tags",
    )

    expect(mocks.publishThunk).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).not.toHaveBeenCalled()
  })

  it("shares an in-flight matching attempt instead of publishing concurrently", async () => {
    let acknowledgeReplacement: ((value: {relay: string}) => void) | undefined
    mocks.waitForAnyRelayAck.mockImplementation((thunk: TestThunk) => {
      if (thunk.phase === "delete") return Promise.resolve({relay: relayOne})
      return new Promise(resolve => {
        acknowledgeReplacement = resolve
      })
    })
    const {publishEditedReply} = await import("./event-edit-publish")
    const params = makeParams(makeOriginal("concurrent"))

    const first = publishEditedReply(params)
    const second = publishEditedReply(params)

    await vi.waitFor(() => expect(mocks.publishThunk).toHaveBeenCalledTimes(1))
    expect(mocks.publishThunk).toHaveBeenCalledTimes(1)
    expect(mocks.waitForAnyRelayAck).toHaveBeenCalledTimes(1)
    acknowledgeReplacement?.({relay: relayOne})
    await Promise.all([first, second])

    expect(mocks.retryThunk).not.toHaveBeenCalled()
    expect(mocks.publishSocialDelete).toHaveBeenCalledTimes(1)
  })
})
