import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("repository publication source contract", () => {
  it("keeps repository writes bound to route relay authority", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
      "../../routes/git/[id=naddr]/prs/[prid]/+page.svelte",
      "../../routes/git/[id=naddr]/commits/[commitid]/+page.svelte",
      "../../routes/git/[id=naddr]/feed/+page.svelte",
    ]) {
      expect(readProjectFile(path)).toContain("REPO_RELAYS_KEY")
    }

    const prView = readProjectFile("../components/PRView.svelte")
    expect(prView).toContain("const strictRepoRelays")
    expect(prView).not.toContain("repoRelays?.length ? repoRelays : repoClass.relays")
    expect(prView).not.toContain("repoClass.relays || repoRelays")
  })

  it("passes strict repository relay scope through actions and zaps", () => {
    const eventActions = readProjectFile("../components/EventActions.svelte")
    const reactionSummary = readProjectFile("../components/ReactionSummary.svelte")
    const issueThread = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/IssueThread.svelte",
    )
    const issueCard = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/IssueCard.svelte",
    )

    expect(eventActions).toContain("strict={strictZapRelays}")
    expect(eventActions).toContain("repoAddress: repoAddress || undefined")
    expect(reactionSummary).toContain("strict: strictZapRelays")
    expect(issueThread).toContain("strictZapRelays={Boolean(repoAddress)}")
    expect(issueCard).toContain("strictZapRelays={true}")
    expect(issueCard).toContain("loadZapReceipts={false}")
    expect(issueCard).not.toContain("wss://relay.budabit.club/")
  })

  it("reacts to successful relay provenance for scoped engagement", () => {
    const reactionSummary = readProjectFile("../components/ReactionSummary.svelte")
    const emojiPicker = readProjectFile("../../lib/components/EmojiPicker.svelte")

    expect(reactionSummary).toContain("deriveEventsByIdByUrl")
    expect(reactionSummary).toContain("getRelayScopedEvents($engagements, $engagementsByRelay)")
    expect(reactionSummary).toContain("event.kind === REACTION")
    expect(reactionSummary).toContain("event.kind === REPORT")
    expect(reactionSummary).toContain("deleteReaction(reaction)")
    expect(reactionSummary).toContain("Click to remove your reaction")
    expect(emojiPicker).toContain("Use the top row to choose a category")
  })

  it("starts creation and import repository relay selections empty", () => {
    const gitPage = readProjectFile("../../routes/git/+page.svelte")
    const newRepo = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/NewRepoWizard.svelte",
    )
    const importRepo = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/ImportRepoDialog.svelte",
    )

    expect(gitPage).toContain("const defaultRepoRelays = $state<string[]>([])")
    expect(newRepo).toContain("defaultRelays = []")
    expect(newRepo).toContain("Select at least one repository or GRASP relay")
    expect(newRepo).not.toContain("graspRelayUrls = [...graspServerOptions]")
    expect(importRepo).toContain("defaultRelays = []")
    expect(importRepo).toContain("let selectedRelays = $state<string[]>([...defaultRelays])")
    expect(importRepo).not.toContain("DEFAULT_RELAYS.default")
    expect(importRepo).not.toContain("graspRelayUrls = [...urls]")
  })

  it("keeps issue form input mounted and exposes publication errors", () => {
    const form = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/NewIssueForm.svelte",
    )
    const publishStart = form.indexOf("await onIssueCreated(issueEvent)")
    const close = form.indexOf("back();", publishStart)
    const catchBlock = form.indexOf("errors.submit =", publishStart)

    expect(publishStart).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(publishStart)
    expect(catchBlock).toBeGreaterThan(close)
    expect(form).toContain("{errors.submit}")
  })

  it("guards community permalink fanout before creating any thunk", () => {
    const source = readProjectFile("../util/permalink-publishing.ts")
    const guard = source.indexOf("requireRepoPublicationScope")
    const firstThunk = source.indexOf("publishThunk({", guard)

    expect(guard).toBeGreaterThan(-1)
    expect(firstThunk).toBeGreaterThan(guard)
  })

  it("does not re-expand repository stars or metadata deletes", () => {
    const collect = readProjectFile("../components/RepoCollectButton.svelte")
    const layout = readProjectFile("../../routes/git/[id=naddr]/+layout.svelte")
    const deleteRepo = readProjectFile("../components/DeleteRepoConfirm.svelte")
    const gitPage = readProjectFile("../../routes/git/+page.svelte")

    expect(collect).not.toContain("getRepoStarRelays")
    expect(layout).not.toContain("getRepoStarRelays")
    expect(deleteRepo).not.toContain("getMetadataDeleteRelays")
    expect(gitPage).not.toContain("repoEvent.kind === 0")
    expect(gitPage).not.toContain("publishThunk({event: repoEvent")
  })
})
