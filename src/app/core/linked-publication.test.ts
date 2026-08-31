import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {awaitLinkedPublication, type LinkedPublication} from "./linked-publication"

const publication = (
  results: LinkedPublication["results"],
  complete: Promise<unknown> = Promise.resolve(),
): LinkedPublication => ({complete, results})

describe("awaitLinkedPublication", () => {
  it("succeeds when every event is acknowledged by one same relay", async () => {
    const root = publication({
      "wss://one.example/": {status: PublishStatus.Success},
      "wss://two.example": {status: PublishStatus.Failure},
    })
    const status = publication({
      "wss://one.example": {status: PublishStatus.Success},
    })

    await expect(awaitLinkedPublication([root, status])).resolves.toEqual(["wss://one.example"])
  })

  it("rejects when separate relays accept only one event each", async () => {
    const root = publication({
      "wss://one.example": {status: PublishStatus.Success},
      "wss://two.example": {status: PublishStatus.Failure},
    })
    const status = publication({
      "wss://one.example": {status: PublishStatus.Failure},
      "wss://two.example": {status: PublishStatus.Success},
    })

    await expect(awaitLinkedPublication([root, status])).rejects.toThrow(/No relay accepted both/)
  })

  it("waits for every publication before inspecting results", async () => {
    let release = () => {}
    const complete = new Promise<void>(resolve => {
      release = resolve
    })
    const root = publication({"wss://one.example": {status: PublishStatus.Success}}, complete)
    const status = publication({"wss://one.example": {status: PublishStatus.Success}})
    let settled = false
    const linked = awaitLinkedPublication([root, status]).finally(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await expect(linked).resolves.toEqual(["wss://one.example"])
  })
})
