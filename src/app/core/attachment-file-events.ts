import {verifyEvent} from "nostr-tools/pure"
import type {EventTemplate, SignedEvent} from "@welshman/util"
export type FileEventTemplate = EventTemplate & {created_at: number}

export type FileDescriptor = {
  url: string
  sha256: string
  size?: number
  type?: string
  name?: string
  originalSha256?: string
}
export type FilePublicationContext = {
  mode: "non-dm" | "direct-message"
  parent: SignedEvent
  relays: string[]
  /** Actual ACK destinations for the parent, not configured or optimistic relays. */
  acceptedRelays: string[]
}
export type FilePublicationJob = {
  id: string
  owner: string
  parents: string[]
  descriptor: FileDescriptor
  relays: string[]
  template: FileEventTemplate
  signed?: SignedEvent
  acceptedRelays: string[]
  state: "pending" | "publishing" | "published" | "stopped" | "no-relays"
  error?: string
}
export type FilePublicationStorage = {
  load(): FilePublicationJob[]
  save(jobs: FilePublicationJob[]): void
}
export type FilePublicationTransport = {
  account(): string | undefined
  sign(template: FileEventTemplate, signal: AbortSignal): Promise<SignedEvent>
  publish(event: SignedEvent, relays: string[], signal: AbortSignal): Promise<string[]>
}

export const FILE_DISCOVERY_WARNING = "File uploaded, but other apps may not discover it yet."
type PublicationHooks = {
  uploaded(owner: string, descriptor: FileDescriptor): void
  accepted(context: FilePublicationContext): void
}
const hooks = new Set<PublicationHooks>()
export const observeFilePublicationParents = (listener: PublicationHooks) => {
  hooks.add(listener)
  return () => {
    hooks.delete(listener)
  }
}
export const recordFileUpload = (owner: string, descriptor: FileDescriptor) => {
  for (const listener of hooks) listener.uploaded(owner, descriptor)
}
export const recordAttachmentParent = (context: FilePublicationContext) => {
  for (const listener of hooks) {
    try {
      listener.accepted(context)
    } catch {
      /* Parent ACK remains valid. */
    }
  }
}
const hash = /^[0-9a-f]{64}$/
const dmKinds = new Set([4, 14, 1059, 4444])
const normalizeRelay = (value: string) => {
  const url = new URL(value)
  if (!["wss:", "ws:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("Invalid file publication relay")
  return url.toString()
}
const relays = (values: string[]) => [...new Set(values.map(normalizeRelay))].sort()

export const fileMetadataTemplate = (
  descriptor: FileDescriptor,
  parent: SignedEvent,
): FileEventTemplate => {
  const url = new URL(descriptor.url)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !hash.test(descriptor.sha256)
  )
    throw new Error("Invalid uploaded file descriptor")
  if (
    descriptor.size !== undefined &&
    (!Number.isSafeInteger(descriptor.size) || descriptor.size < 0)
  )
    throw new Error("Invalid uploaded file size")
  const tags = [
    ["url", descriptor.url],
    ["x", descriptor.sha256],
  ]
  if (descriptor.type) tags.push(["m", descriptor.type])
  if (descriptor.name) tags.push(["title", descriptor.name])
  if (descriptor.size !== undefined) tags.push(["size", String(descriptor.size)])
  if (descriptor.originalSha256 && hash.test(descriptor.originalSha256))
    tags.push(["ox", descriptor.originalSha256])
  // Retain the parent's exact community context. Relay hints never create scope.
  tags.push(
    ...parent.tags
      .filter(t => t[0] === "h" || (t[0] === "a" && t[3] === "community"))
      .map(t => [...t]),
  )
  return {
    kind: 1063,
    created_at: Math.floor(Date.now() / 1000),
    content: descriptor.name || "",
    tags,
  }
}

/** The caller supplies an explicit acknowledged parent context on send/publish.
 * Draft uploads never call enqueue; the DM path performs no storage or signing. */
export class FilePublicationJournal {
  private active = new Map<string, AbortController>()
  constructor(
    private storage: FilePublicationStorage,
    private transport: FilePublicationTransport,
  ) {}

  enqueue(context: FilePublicationContext, descriptors: FileDescriptor[]): string[] {
    if (
      context.mode === "direct-message" ||
      dmKinds.has(context.parent.kind) ||
      context.parent.kind === 1063
    )
      return []
    const parent = context.parent
    if (
      !verifyEvent(parent as Parameters<typeof verifyEvent>[0]) ||
      parent.pubkey !== this.transport.account()
    )
      throw new Error("File publication belongs to a different or invalid parent signer")
    const targets = relays(context.relays)
    if (targets.length && !relays(context.acceptedRelays).some(r => targets.includes(r)))
      throw new Error("Wait for an actual parent publication acknowledgement")
    const jobs = this.storage.load()
    const ids = new Set<string>()
    for (const descriptor of descriptors) {
      const template = fileMetadataTemplate(descriptor, parent)
      // Equal bytes in a different community/relay scope require a distinct event.
      const id = JSON.stringify([
        parent.pubkey,
        descriptor.sha256,
        descriptor.url,
        targets,
        template.tags.filter(t => ["h", "a"].includes(t[0])),
      ])
      const existing = jobs.find(job => job.id === id)
      if (existing) {
        if (!existing.parents.includes(parent.id)) existing.parents.push(parent.id)
      } else {
        jobs.push({
          id,
          owner: parent.pubkey,
          parents: [parent.id],
          descriptor: {...descriptor},
          relays: targets,
          template,
          acceptedRelays: [],
          state: targets.length ? "pending" : "no-relays",
          ...(targets.length ? {} : {error: FILE_DISCOVERY_WARNING}),
        })
      }
      ids.add(id)
    }
    this.storage.save(jobs)
    return [...ids]
  }

  private update(id: string, change: (job: FilePublicationJob) => void): FilePublicationJob {
    const jobs = this.storage.load()
    const job = jobs.find(job => job.id === id)
    if (!job) throw new Error("Retained file publication was not found")
    change(job)
    this.storage.save(jobs)
    return job
  }
  stop(id: string) {
    this.active.get(id)?.abort()
    this.update(id, job => {
      job.state = "stopped"
      job.error = "File metadata publication stopped; upload retained."
    })
  }
  async retry(id: string): Promise<FilePublicationJob> {
    if (this.active.has(id)) throw new Error("This file publication is already active")
    const controller = new AbortController()
    const signal = controller.signal
    let job = this.update(id, job => {
      if (job.owner !== this.transport.account())
        throw new Error("Sign in to the account that uploaded this file")
      if (!job.relays.length)
        throw new Error(FILE_DISCOVERY_WARNING + " No publication relays were selected.")
      if (job.state !== "published") {
        job.state = "publishing"
        job.error = undefined
      }
    })
    if (job.state === "published") return job
    this.active.set(id, controller)
    try {
      if (!job.signed) {
        const signed = await this.transport.sign(job.template, signal)
        signal.throwIfAborted()
        if (
          job.owner !== this.transport.account() ||
          signed.pubkey !== job.owner ||
          !verifyEvent(signed as Parameters<typeof verifyEvent>[0]) ||
          signed.kind !== 1063 ||
          signed.content !== job.template.content ||
          signed.created_at !== job.template.created_at ||
          JSON.stringify(signed.tags) !== JSON.stringify(job.template.tags)
        )
          throw new Error("Signer returned different file metadata")
        job = this.update(id, value => {
          value.signed = signed
        })
      }
      signal.throwIfAborted()
      if (
        job.owner !== this.transport.account() ||
        !job.signed ||
        job.signed.pubkey !== job.owner ||
        !verifyEvent(job.signed as Parameters<typeof verifyEvent>[0]) ||
        job.signed.kind !== 1063 ||
        job.signed.content !== job.template.content ||
        job.signed.created_at !== job.template.created_at ||
        JSON.stringify(job.signed.tags) !== JSON.stringify(job.template.tags)
      )
        throw new Error("Retained signed file metadata did not match its publication request")
      const remaining = job.relays.filter(r => !job.acceptedRelays.includes(r))
      const accepted = relays(await this.transport.publish(job.signed!, remaining, signal)).filter(
        r => remaining.includes(r),
      )
      job = this.update(id, value => {
        value.acceptedRelays = [...new Set([...value.acceptedRelays, ...accepted])]
        value.state = signal.aborted
          ? "stopped"
          : value.relays.every(r => value.acceptedRelays.includes(r))
            ? "published"
            : "pending"
        value.error =
          value.state === "pending"
            ? "Parent published; file metadata is still pending on some relays. Retry without uploading again."
            : undefined
      })
    } catch (error) {
      job = this.update(id, value => {
        value.state = signal.aborted ? "stopped" : "pending"
        value.error =
          error instanceof Error
            ? error.message
            : "File metadata publication failed; upload retained."
      })
    } finally {
      this.active.delete(id)
    }
    return job
  }
}
