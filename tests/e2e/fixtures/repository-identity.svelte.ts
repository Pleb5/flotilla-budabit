/** Persistent component regression fixture: no real signing, publication or Git writes. */
import {mount, unmount} from "svelte"
import {getEventHash} from "nostr-tools"
import {EditRepoPanel, NewRepoWizard, type Repo} from "@nostr-git/ui"
import type {RepoAnnouncementEvent, RepoStateEvent} from "@nostr-git/core/events"

const owner = "a".repeat(64)
const identifier = "Legacy.Case"
const relay = "wss://metadata.identity.test/"

export function mountRepositoryIdentityFixture(mode: "settings" | "creation" = "settings") {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  const target = document.createElement("div")
  target.dataset.repositoryIdentityFixture = mode
  target.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:var(--color-base-100,#161616);overflow:auto;padding:16px"
  document.body.append(target)
  let announcement = $state.raw<RepoAnnouncementEvent>({
    kind: 30617,
    id: "fixture-source",
    sig: "fixture-only",
    created_at: 100,
    pubkey: owner,
    content: "Opaque announcement content",
    tags: [
      ["d", identifier],
      ["name", "Original display name"],
      ["description", "Repository identity fixture"],
      ["relays", relay],
      ["clone", "https://github.com/fixture/Legacy.Case.git"],
      ["u", `30617:${"b".repeat(64)}:Parent.Case`, "wss://parent.identity.test", "hint"],
      ["u", "https://git.identity.test/parent.git"],
      ["future-tag", "keep", "exactly"],
    ],
  })
  let state = $state.raw<RepoStateEvent>({
    kind: 30618,
    id: "fixture-state",
    sig: "fixture-only",
    created_at: 100,
    pubkey: owner,
    content: "",
    tags: [
      ["d", identifier],
      ["HEAD", "ref: refs/heads/main"],
      ["refs/heads/main", "1".repeat(40)],
      ["refs/heads/next", "2".repeat(40), "1".repeat(40)],
    ],
  })
  let actor = $state(owner)
  const published: Array<RepoAnnouncementEvent | RepoStateEvent> = []
  let failState = false
  let loseAnnouncementResult = false
  let beforeDelivery: (() => void) | undefined
  const repo = {
    get repoEvent() {
      return announcement
    },
    get repoStateEvent() {
      return state
    },
    get viewerPubkey() {
      return actor
    },
    get name() {
      return announcement.tags.find(tag => tag[0] === "name")?.[1] || identifier
    },
    get description() {
      return announcement.tags.find(tag => tag[0] === "description")?.[1] || ""
    },
    get relays() {
      return [relay]
    },
    get clone() {
      return ["https://github.com/fixture/Legacy.Case.git"]
    },
    get defaultBranch() {
      return (
        state.tags.find(tag => tag[0] === "HEAD")?.[1]?.replace("ref: refs/heads/", "") || "main"
      )
    },
    mainBranch: "main",
    web: [],
    hashtags: [],
    earliestUniqueCommit: "",
    identifier,
    address: `30617:${owner}:${identifier}`,
    editable: true,
    isAuthorized: (pubkey?: string) => pubkey === owner,
    getAllRefsWithFallback: async () =>
      ["main", "next"].map((name, i) => ({
        name,
        type: "heads",
        fullRef: `refs/heads/${name}`,
        commitId: String(i + 1).repeat(40),
      })),
    getCommitHistory: async () => [],
    commits: [],
  } as unknown as Repo
  const component =
    mode === "settings"
      ? mount(EditRepoPanel, {
          target,
          props: {
            repo,
            variant: "page",
            onSaveComplete: async () => {},
            onPublishEvent: async (event, context) => {
              context?.assertCurrent?.()
              beforeDelivery?.()
              beforeDelivery = undefined
              context?.assertCurrent?.()
              if (event.kind === 30618 && failState) {
                failState = false
                throw new Error("Fixture: state delivery failed")
              }
              // Deliberately not a valid signature; the fixture only records in memory.
              const recorded = {
                ...event,
                pubkey: owner,
                sig: "fixture-only",
                id: getEventHash({...event, pubkey: owner}),
              } as RepoAnnouncementEvent | RepoStateEvent
              published.push(recorded)
              if (recorded.kind === 30617) announcement = recorded
              else state = recorded
              if (recorded.kind === 30617 && loseAnnouncementResult) {
                loseAnnouncementResult = false
                throw new Error("Fixture: announcement accepted but result lost")
              }
              return {
                event: recorded,
                ackedRelays: context!.relays,
                failedRelays: [],
                hasRelayOutcomes: true,
              }
            },
          },
        })
      : mount(NewRepoWizard, {
          target,
          props: {
            userPubkey: owner,
            defaultRelays: [relay],
            onCancel: () => {},
            onPublishEvent: () => {
              throw new Error("Creation-draft fixture must never publish")
            },
            onFetchRelayEvents: async () => [],
            onDeleteEvent: () => {
              throw new Error("Fixture must never delete")
            },
          },
        })
  return {
    evidence: () => ({identifier, actor, announcement, state, published}),
    changeActor: () => {
      actor = "b".repeat(64)
    },
    changeAnnouncement: () => {
      announcement = {
        ...announcement,
        id: "fixture-newer",
        created_at: 1000,
        tags: [...announcement.tags, ["newer-field", "retain"]],
      }
    },
    failNextState: () => {
      failState = true
    },
    loseNextAnnouncementResult: () => {
      loseAnnouncementResult = true
    },
    switchActorDuringDelivery: () => {
      beforeDelivery = () => {
        actor = "b".repeat(64)
      }
    },
    destroy: async () => {
      await unmount(component)
      target.remove()
    },
  }
}
