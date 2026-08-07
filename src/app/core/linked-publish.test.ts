import {beforeEach, describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  publishLinkedOperation,
  type LinkedPublishOperation,
  type LinkedPublishThunk,
} from "./linked-publish"

const mocks = vi.hoisted(() => ({
  actions: [] as string[],
  abortThunk: vi.fn(),
  retryThunk: vi.fn(),
  waitForAnyRelayAck: vi.fn(),
  repositoryPublish: vi.fn(),
}))

vi.mock("@welshman/app", () => ({
  abortThunk: mocks.abortThunk,
  pubkey: {get: () => "a".repeat(64)},
  publishThunk: vi.fn(),
  retryThunk: mocks.retryThunk,
  waitForAnyRelayAck: mocks.waitForAnyRelayAck,
  repository: {publish: mocks.repositoryPublish},
}))

type TestThunk = {
  stage: "original" | "target"
  pubkey: string
  event: TrustedEvent
  options: {relays: string[]; optimistic: boolean}
}

const outboxRelay = "wss://outbox.example/"
const communityRelayOne = "wss://community-one.example/"
const communityRelayTwo = "wss://community-two.example/"
const communityRelays = [communityRelayOne, communityRelayTwo]

const makeThunk = (stage: TestThunk["stage"], relays: string[]) =>
  ({
    stage,
    pubkey: "a".repeat(64),
    event: {
      id: `${stage}-id`,
      pubkey: "a".repeat(64),
      created_at: 1,
      kind: stage === "original" ? 1 : 1111,
      tags: [],
      content: stage,
      sig: `${stage}-sig`,
    } as TrustedEvent,
    options: {relays, optimistic: false},
  }) as unknown as LinkedPublishThunk

const makeParams = (operation: LinkedPublishOperation = {}) => {
  const originalThunk = makeThunk("original", [outboxRelay, ...communityRelays])
  const targetThunk = makeThunk("target", communityRelays)
  const originalFactory = vi.fn(() => {
    mocks.actions.push("publish:original")
    return originalThunk
  })
  const targetFactory = vi.fn((_relay: string) => {
    mocks.actions.push("publish:target")
    return targetThunk
  })

  return {
    operation,
    semanticInput: "same input",
    requiredRelays: communityRelays,
    originalFactory,
    targetFactory,
    originalThunk,
    targetThunk,
  }
}

describe("resumable linked publication", () => {
  beforeEach(() => {
    mocks.actions.length = 0
    mocks.abortThunk.mockReset()
    mocks.retryThunk.mockReset()
    mocks.waitForAnyRelayAck.mockReset()
    mocks.repositoryPublish.mockReset()

    mocks.retryThunk.mockImplementation((thunk: TestThunk) => {
      mocks.actions.push(`retry:${thunk.stage}`)
      return {...thunk, event: thunk.event}
    })
    mocks.repositoryPublish.mockImplementation((event: TrustedEvent) => {
      mocks.actions.push(`commit:${event.id}`)
    })
  })

  it("requires original and target ACKs from community relays", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue({relay: communityRelayOne})
    const params = makeParams()

    await publishLinkedOperation(params)

    expect(params.originalThunk.options.relays).toEqual([outboxRelay, ...communityRelays])
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(
      1,
      params.originalThunk,
      communityRelays,
    )
    expect(mocks.waitForAnyRelayAck).toHaveBeenNthCalledWith(2, params.targetThunk, [
      communityRelayOne,
    ])
  })

  it("retries the exact failed target without retrying or regenerating the original", async () => {
    let targetAttempts = 0
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      if (thunk.stage === "original") return {relay: communityRelayOne}
      targetAttempts += 1
      if (targetAttempts === 1) throw new Error("target rejected")
      return {relay: communityRelayOne}
    })
    const params = makeParams()

    await expect(publishLinkedOperation(params)).rejects.toThrow("Target publication")
    await publishLinkedOperation({operation: params.operation, semanticInput: params.semanticInput})

    expect(params.originalFactory).toHaveBeenCalledTimes(1)
    expect(params.targetFactory).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledTimes(1)
    expect(mocks.retryThunk).toHaveBeenCalledWith(params.targetThunk)
    expect((mocks.retryThunk.mock.results[0]?.value as TestThunk).event).toBe(
      params.targetThunk.event,
    )
  })

  it("passes the relay that actually ACKed the original to the target factory", async () => {
    mocks.waitForAnyRelayAck.mockResolvedValue({relay: communityRelayTwo})
    const params = makeParams()

    await publishLinkedOperation(params)

    expect(params.targetFactory).toHaveBeenCalledWith(communityRelayTwo)
  })

  it("commits each event only after its required ACK and before the next stage", async () => {
    mocks.waitForAnyRelayAck.mockImplementation(async (thunk: TestThunk) => {
      mocks.actions.push(`ack:${thunk.stage}`)
      return {relay: communityRelayOne}
    })
    const params = makeParams()

    await publishLinkedOperation(params)

    expect(mocks.actions).toEqual([
      "publish:original",
      "ack:original",
      "commit:original-id",
      "publish:target",
      "ack:target",
      "commit:target-id",
    ])
  })
})
