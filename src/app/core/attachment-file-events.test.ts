import {describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import type {EventTemplate, SignedEvent} from "@welshman/util"
import {
  FilePublicationJournal,
  type FilePublicationJob,
  type FilePublicationContext,
} from "./attachment-file-events"

const fixture = () => {
  const secret = generateSecretKey()
  let account: string | undefined = getPublicKey(secret)
  const sign = (template: EventTemplate & {created_at?: number}): SignedEvent =>
    finalizeEvent({...template, created_at: template.created_at || 1}, secret)
  const parent = sign({
    kind: 9,
    created_at: 1,
    content: "Synthetic attachment",
    tags: [
      ["h", "a".repeat(64)],
      ["a", `32222:${account}:${"a".repeat(64)}`, "", "community"],
    ],
  })
  const context: FilePublicationContext = {
    mode: "non-dm",
    parent,
    relays: ["wss://community.example/", "wss://second.example/"],
    acceptedRelays: ["wss://community.example/"],
  }
  const descriptor = {
    url: `https://blossom.example/${"b".repeat(64)}`,
    sha256: "b".repeat(64),
    originalSha256: "c".repeat(64),
    name: "Transformed fixture",
    size: 3,
    type: "image/webp",
  }
  let retained = "[]"
  const storage = {
    load: (): FilePublicationJob[] => JSON.parse(retained),
    save: (jobs: FilePublicationJob[]) => {
      retained = JSON.stringify(jobs)
    },
  }
  const transport = {
    account: () => account,
    sign: vi.fn(async (template: EventTemplate, _signal: AbortSignal) => sign(template)),
    publish: vi.fn(async (_event: SignedEvent, relays: string[], _signal: AbortSignal) => relays),
  }
  const journal = new FilePublicationJournal(storage, transport)
  return {
    parent,
    context,
    descriptor,
    storage,
    transport,
    journal,
    sign,
    switchAccount: () => {
      account = undefined
    },
  }
}

describe("non-DM attachment file publication", () => {
  it("uses final x separately from ox, retaining inline parent scope and exact destinations", async () => {
    const f = fixture()
    const [id] = f.journal.enqueue(f.context, [f.descriptor, f.descriptor])
    expect(f.transport.sign).not.toHaveBeenCalled()
    const completed = await f.journal.retry(id)
    expect(completed.state).toBe("published")
    expect(completed.signed?.tags).toContainEqual(["x", f.descriptor.sha256])
    expect(completed.signed?.tags).toContainEqual(["ox", f.descriptor.originalSha256])
    expect(completed.signed?.tags).toContainEqual(f.parent.tags[1])
    expect(f.transport.publish.mock.calls[0][1]).toEqual(f.context.relays)
    expect(f.storage.load()).toHaveLength(1)
  })

  it("never signs or journals draft/DM attachments and requires parent ACK evidence", () => {
    const f = fixture()
    expect(f.storage.load()).toEqual([])
    expect(f.journal.enqueue({...f.context, mode: "direct-message"}, [f.descriptor])).toEqual([])
    for (const kind of [4, 14, 1059, 4444]) {
      const parent = f.sign({kind, content: "private", tags: []})
      expect(f.journal.enqueue({...f.context, parent}, [f.descriptor])).toEqual([])
    }
    expect(() => f.journal.enqueue({...f.context, acceptedRelays: []}, [f.descriptor])).toThrow(
      "acknowledgement",
    )
    expect(f.storage.load()).toEqual([])
    expect(f.transport.sign).not.toHaveBeenCalled()
  })

  it("retains partial success across restart and retries immutable signed metadata only", async () => {
    const f = fixture()
    f.transport.publish.mockResolvedValueOnce([f.context.relays[0]])
    const [id] = f.journal.enqueue(f.context, [f.descriptor])
    const first = await f.journal.retry(id)
    expect(first.state).toBe("pending")
    const restarted = new FilePublicationJournal(f.storage, f.transport)
    expect((await restarted.retry(id)).state).toBe("published")
    expect(f.transport.sign).toHaveBeenCalledTimes(1)
    expect(f.transport.publish.mock.calls[1][0]).toEqual(f.transport.publish.mock.calls[0][0])
    expect(f.transport.publish.mock.calls[1][1]).toEqual([f.context.relays[1]])
    const anotherParent = f.sign({...f.parent, created_at: 2})
    expect(restarted.enqueue({...f.context, parent: anotherParent}, [f.descriptor])).toEqual([id])
    await restarted.retry(id)
    expect(f.transport.publish).toHaveBeenCalledTimes(2)
    expect(f.storage.load()[0].parents).toHaveLength(2)
  })

  it("keeps successful uploads usable without inventing a publication relay", async () => {
    const f = fixture()
    const [id] = f.journal.enqueue({...f.context, relays: [], acceptedRelays: []}, [f.descriptor])
    expect(f.storage.load()[0]).toMatchObject({
      state: "no-relays",
      descriptor: f.descriptor,
      relays: [],
    })
    await expect(f.journal.retry(id)).rejects.toThrow(
      "File uploaded, but other apps may not discover it yet",
    )
    expect(f.transport.sign).not.toHaveBeenCalled()
    expect(f.transport.publish).not.toHaveBeenCalled()
  })

  it("retains a signing failure and rejects account changes or altered signed payloads", async () => {
    const f = fixture()
    f.transport.sign.mockRejectedValueOnce(new Error("Signer unavailable"))
    const [id] = f.journal.enqueue(f.context, [f.descriptor])
    expect((await f.journal.retry(id)).state).toBe("pending")
    expect(f.storage.load()[0].parents).toEqual([f.parent.id])
    f.transport.publish.mockResolvedValueOnce([])
    await f.journal.retry(id)
    const saved = f.storage.load()
    saved[0].signed!.content = "modified after signing"
    f.storage.save(saved)
    const calls = f.transport.publish.mock.calls.length
    expect((await f.journal.retry(id)).error).toContain("Retained signed file metadata")
    expect(f.transport.publish).toHaveBeenCalledTimes(calls)
    f.switchAccount()
    await expect(f.journal.retry(id)).rejects.toThrow("Sign in to the account")
  })

  it("stops an in-flight file publication durably without losing its signed retry payload", async () => {
    const f = fixture()
    f.transport.publish.mockImplementationOnce(
      async (_event, _relays, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("Stopped")), {once: true}),
        ),
    )
    const [id] = f.journal.enqueue(f.context, [f.descriptor])
    const operation = f.journal.retry(id)
    await vi.waitFor(() => expect(f.transport.publish).toHaveBeenCalledTimes(1))
    f.journal.stop(id)
    expect((await operation).state).toBe("stopped")
    const restarted = new FilePublicationJournal(f.storage, f.transport)
    expect(f.storage.load()[0].signed).toBeDefined()
    expect(f.transport.publish).toHaveBeenCalledTimes(1)
    await restarted.retry(id)
    expect(f.transport.sign).toHaveBeenCalledTimes(1)
  })
})
