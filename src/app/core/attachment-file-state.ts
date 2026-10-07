import {get, writable, derived} from "svelte/store"
import {pubkey, signer, subscribeAcceptedPublications} from "@welshman/app"
import {publish, PublishStatus} from "@welshman/net"
import {prep, type SignedEvent} from "@welshman/util"
import {pushToast} from "@app/util/toast"
import {
  FilePublicationJournal,
  FILE_DISCOVERY_WARNING,
  observeFilePublicationParents,
  type FileDescriptor,
  type FilePublicationContext,
  type FilePublicationJob,
} from "./attachment-file-events"

const key = "budabit/file-publications:v1"
type SavedUpload = FileDescriptor & {owner: string}
type State = {jobs: FilePublicationJob[]; uploads: SavedUpload[]}
let unreadable = false
const initial = (): State => {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key)
    if (!raw) return {jobs: [], uploads: []}
    const parsed = JSON.parse(raw) as State
    if (!Array.isArray(parsed.jobs) || !Array.isArray(parsed.uploads))
      throw new Error("Invalid file journal")
    return {
      ...parsed,
      jobs: parsed.jobs.map(job =>
        job.state === "publishing"
          ? {...job, state: "pending", error: "Interrupted; retry this retained file event."}
          : job,
      ),
    }
  } catch {
    unreadable = true
    return {jobs: [], uploads: []}
  }
}
const state = writable<State>(initial())
const save = (next: State) => {
  if (unreadable)
    throw new Error("Retained file metadata could not be read; existing journal was preserved.")
  if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(next))
  state.set(next)
}
export const filePublicationJobs = derived([state, pubkey], ([$state, $pubkey]) =>
  $state.jobs.filter(job => job.owner === $pubkey && job.state !== "published"),
)
export const filePublicationJournal = new FilePublicationJournal(
  {
    load: () => structuredClone(get(state).jobs),
    save: jobs => save({...get(state), jobs}),
  },
  {
    account: () => pubkey.get(),
    sign: async (template, signal) => {
      const selected = signer.get()
      const account = pubkey.get()
      if (!selected || !account) throw new Error("Sign in to publish file metadata")
      return selected.sign(prep(template, account, template.created_at), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      })
    },
    publish: async (event, relays, signal) => {
      const results = await publish({event, relays, signal, timeout: 12_000})
      return relays.filter(relay => results[relay]?.status === PublishStatus.Success)
    },
  },
)

/** Upload completion records a descriptor, but neither signs nor publishes it. */
export const rememberAttachmentUpload = (descriptor: FileDescriptor, owner = pubkey.get()) => {
  if (!owner) return
  const current = get(state)
  save({
    ...current,
    uploads: [
      ...current.uploads.filter(u => u.owner !== owner || u.url !== descriptor.url),
      {...descriptor, owner},
    ],
  })
}
export const attachmentsForParent = (parent: SignedEvent): FileDescriptor[] => {
  const explicitUrls = new Set(
    parent.tags.flatMap(tag =>
      tag[0] === "imeta"
        ? tag
            .slice(1)
            .filter(v => v.startsWith("url "))
            .map(v => v.slice(4))
        : [],
    ),
  )
  if (parent.kind === 0) {
    try {
      const profile = JSON.parse(parent.content)
      for (const value of [profile.picture, profile.banner])
        if (typeof value === "string") explicitUrls.add(value)
    } catch {
      /* Invalid profile JSON does not authorize any attachment. */
    }
  }
  // Exact URL tokens cover rich editor media, Markdown and associated cover tags.
  const urls = new Set(parent.content.match(/https:\/\/[^\s<>"'\)\]]+/g) || [])
  for (const tag of parent.tags)
    if (["image", "picture", "banner", "thumb"].includes(tag[0]) && tag[1]) explicitUrls.add(tag[1])
  return get(state).uploads.filter(
    u => u.owner === parent.pubkey && (explicitUrls.has(u.url) || urls.has(u.url)),
  )
}

export const publishParentFileMetadata = (context: FilePublicationContext) => {
  if (context.mode === "direct-message" || [4, 14, 1059, 4444, 1063].includes(context.parent.kind))
    return
  const descriptors = attachmentsForParent(context.parent)
  if (!descriptors.length) return
  try {
    const ids = filePublicationJournal.enqueue(context, descriptors)
    for (const id of ids) {
      const job = get(state).jobs.find(job => job.id === id)!
      if (["published", "publishing", "stopped"].includes(job.state)) continue
      if (job.state === "no-relays") {
        pushToast({theme: "warning", message: FILE_DISCOVERY_WARNING})
        continue
      }
      void filePublicationJournal
        .retry(id)
        .then(job => {
          if (job.state !== "published")
            pushToast({
              theme: "warning",
              message:
                "Your post is available. File metadata is pending; retry it from Publication recovery.",
            })
        })
        .catch(() =>
          pushToast({
            theme: "warning",
            message: "File metadata is pending; open Publication recovery.",
          }),
        )
    }
  } catch (error) {
    pushToast({
      theme: "warning",
      message: `${FILE_DISCOVERY_WARNING} ${error instanceof Error ? error.message : "File metadata could not be retained."}`,
    })
  }
}

/** Installed with the app's UI lifetime; loading a journal never retries it. */
export const observeAttachmentPublications = () => {
  const stopParents = observeFilePublicationParents({
    uploaded: (owner, descriptor) => rememberAttachmentUpload(descriptor, owner),
    accepted: publishParentFileMetadata,
  })
  const stopAccepted = subscribeAcceptedPublications(value =>
    publishParentFileMetadata({
      parent: value.event,
      mode: value.mode,
      relays: value.relays,
      acceptedRelays: value.acceptedRelays,
    }),
  )
  let previous = pubkey.get()
  const stopAccount = pubkey.subscribe(account => {
    if (account !== previous) {
      for (const job of get(state).jobs.filter(job => job.state === "publishing"))
        filePublicationJournal.stop(job.id)
      previous = account
    }
  })
  return () => {
    stopAccepted()
    stopAccount()
    stopParents()
  }
}
