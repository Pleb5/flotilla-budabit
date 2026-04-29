<script lang="ts">
  import {Card, type Repo} from "@nostr-git/ui"
  import Button from "@src/lib/components/Button.svelte"
  import {pubkey} from "@welshman/app"
  import {createRepoStateEvent, type RepoStateEvent} from "@nostr-git/core/events"
  import {parseRepoAnnouncementEvent} from "@nostr-git/core/events"
  import {normalizeRelayUrl} from "@welshman/util"
  import {postRepoStateEvent} from "@lib/budabit/commands.js"
  import {GIT_RELAYS} from "@lib/budabit/state"
  import {pushToast} from "@src/app/util/toast"

  const {repo}: {repo: Repo} = $props()

  const HEAD_REF_PREFIX = "ref: refs/heads/"

  const currentHead = $derived.by(() => {
    const event = repo.repoStateEvent
    if (!event?.tags) return ""
    for (const tag of event.tags) {
      if (tag?.[0] === "HEAD" && typeof tag[1] === "string") {
        return tag[1].startsWith(HEAD_REF_PREFIX) ? tag[1].slice(HEAD_REF_PREFIX.length) : tag[1]
      }
    }
    return ""
  })

  const publishedBranches = $derived.by(() => {
    const event = repo.repoStateEvent
    if (!event?.tags) return [] as string[]
    return event.tags
      .filter(tag => typeof tag?.[0] === "string" && tag[0].startsWith("refs/heads/"))
      .map(tag => tag[0].slice("refs/heads/".length))
  })

  const branches = $derived(
    publishedBranches.length > 0
      ? publishedBranches
      : (repo.refs || [])
          .filter(ref => ref?.type === "heads" && ref?.name)
          .map(ref => ref.name),
  )
  const isMaintainer = $derived.by(() => {
    const me = $pubkey
    if (!me) return false
    return (repo.maintainers || []).includes(me)
  })

  let selected = $state("")
  let saving = $state(false)

  $effect(() => {
    if (!selected && currentHead) selected = currentHead
  })

  const repoRelays = () => {
    if (!repo.repoEvent) return []
    try {
      return parseRepoAnnouncementEvent(repo.repoEvent).relays || []
    } catch {
      return []
    }
  }

  const save = async () => {
    if (!isMaintainer) return
    const branch = selected.trim()
    if (!branch) {
      pushToast({message: "Pick a branch first", theme: "error"})
      return
    }
    if (branch === currentHead) {
      pushToast({message: "Already the default branch"})
      return
    }

    const refs = (repo.refs || [])
      .filter(ref => ref?.name && ref?.commitId && (ref.type === "heads" || ref.type === "tags"))
      .map(ref => ({type: ref.type, name: ref.name, commit: ref.commitId}))

    if (!refs.some(r => r.type === "heads" && r.name === branch)) {
      pushToast({message: `Branch '${branch}' is not in published refs`, theme: "error"})
      return
    }

    const relays = Array.from(new Set([...repoRelays(), ...GIT_RELAYS]))
      .map(r => normalizeRelayUrl(r))
      .filter(Boolean) as string[]

    if (relays.length === 0) {
      pushToast({message: "No relays available to publish to", theme: "error"})
      return
    }

    const stateEvent = createRepoStateEvent({
      repoId: repo.name,
      head: branch,
      refs,
    }) as RepoStateEvent

    saving = true
    try {
      const thunk = postRepoStateEvent(stateEvent, relays)
      await thunk.complete
      pushToast({message: `Default branch set to '${branch}'`})
    } catch (e: any) {
      pushToast({message: `Failed to publish: ${e?.message || e}`, theme: "error"})
    } finally {
      saving = false
    }
  }
</script>

<Card class="p-4 sm:p-6">
  <h3 class="mb-4 text-lg font-semibold">Default branch</h3>

  {#if !isMaintainer}
    <p class="text-sm text-muted-foreground">
      Only maintainers can change the default branch for this repository.
    </p>
  {:else if branches.length === 0}
    <p class="text-sm text-muted-foreground">
      No branches are published in the repository state event yet.
    </p>
  {:else}
    <p class="mb-2 text-sm text-muted-foreground">
      Current: <span class="font-mono">{currentHead || "(unset)"}</span>
    </p>
    <label class="mb-4 flex flex-col gap-1 text-sm">
      <span>Branch</span>
      <select
        class="rounded border border-zinc-700 bg-transparent p-2"
        bind:value={selected}
        disabled={saving}>
        {#each branches as name}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </label>
    <div class="flex justify-end">
      <Button
        class="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        onclick={save}
        disabled={saving || selected === currentHead}>
        {saving ? "Publishing..." : "Save"}
      </Button>
    </div>
    <p class="mt-3 text-xs text-muted-foreground">
      Publishes a new NIP-34 state event (kind 30618) with HEAD pointing at the selected
      branch. Other maintainers' state events may still diverge.
    </p>
  {/if}
</Card>
