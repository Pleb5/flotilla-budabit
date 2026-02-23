<script lang="ts">
  import {onMount} from "svelte"
  import {preventDefault} from "@lib/html"
  import {randomInt, displayList, TIMEZONE} from "@welshman/lib"
  import {Address} from "@welshman/util"
  import type {Filter} from "@welshman/util"
  import {load} from "@welshman/net"
  import {makeIntersectionFeed, makeRelayFeed, feedFromFilters} from "@welshman/feeds"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import {createAlert} from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import {pubkey} from "@welshman/app"
  import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_STATUS_OPEN,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_LABEL,
    parseRepoAnnouncementEvent,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import {bookmarksStore} from "@nostr-git/ui"
  import {repoAnnouncements, getRepoAnnouncementRelays, GIT_RELAYS} from "@lib/budabit/state"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"

  const timezoneOffset = parseInt(TIMEZONE.split(":")?.[0] || "00")
  const minute = randomInt(0, 59)
  const hour = (17 - timezoneOffset) % 24
  const WEEKLY = `0 ${minute} ${hour} * * 1`
  const DAILY = `0 ${minute} ${hour} * * *`

  let loading = $state(false)
  let cron = $state(WEEKLY)
  let email = $state("")
  let repoQuery = $state("")
  let selectedRepos = $state<string[]>([])

  let notifyIssues = $state(true)
  let notifyPatches = $state(true)
  let notifyPrUpdates = $state(true)
  let notifyStatus = $state(true)
  let notifyAssignments = $state(true)
  let notifyReviews = $state(true)

  const normalizeBookmarks = (value: unknown): BookmarkAddress[] => {
    if (!value) return []
    if (Array.isArray(value)) return value as BookmarkAddress[]
    return []
  }

  const toBookmarkAddresses = (bookmarks: BookmarkAddress[]): BookmarkAddress[] =>
    bookmarks.map((b: BookmarkAddress): BookmarkAddress => ({
      address: b.address,
      author: b.address.split(":")[1] || "",
      identifier: b.address.split(":")[2] || "",
      relayHint: b.relayHint,
    }))

  const bookmarkedAddresses = $derived.by((): BookmarkAddress[] =>
    toBookmarkAddresses(normalizeBookmarks($bookmarksStore)),
  )

  const repoOptions = $derived.by(() => {
    const bookmarkSet = new Set(bookmarkedAddresses.map(b => b.address))
    const candidates: RepoAnnouncementEvent[] = []

    for (const event of $repoAnnouncements as RepoAnnouncementEvent[]) {
      if ($pubkey && event.pubkey === $pubkey) {
        candidates.push(event)
        continue
      }
      try {
        const address = Address.fromEvent(event).toString()
        if (bookmarkSet.has(address)) {
          candidates.push(event)
        }
      } catch {
        // ignore malformed
      }
    }

    const byAddress = new Map<string, {address: string; name: string}>()
    for (const event of candidates) {
      let address = ""
      try {
        address = Address.fromEvent(event).toString()
      } catch {
        continue
      }
      const parsed = parseRepoAnnouncementEvent(event)
      const name = parsed?.name || parsed?.repoId || address
      byAddress.set(address, {address, name})
    }

    return Array.from(byAddress.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const filteredRepos = $derived.by(() => {
    const query = repoQuery.trim().toLowerCase()
    if (!query) return repoOptions
    return repoOptions.filter(repo =>
      `${repo.name} ${repo.address}`.toLowerCase().includes(query),
    )
  })

  const toggleRepo = (address: string) => {
    if (selectedRepos.includes(address)) {
      selectedRepos = selectedRepos.filter(item => item !== address)
    } else {
      selectedRepos = [...selectedRepos, address]
    }
  }

  const back = () => history.back()

  const submit = async () => {
    if (!email.includes("@")) {
      return pushToast({
        theme: "error",
        message: "Please provide an email address",
      })
    }

    if (selectedRepos.length === 0) {
      return pushToast({
        theme: "error",
        message: "Please select at least one repository",
      })
    }

    if (
      !notifyIssues &&
      !notifyPatches &&
      !notifyPrUpdates &&
      !notifyStatus &&
      !notifyAssignments &&
      !notifyReviews
    ) {
      return pushToast({
        theme: "error",
        message: "Please select something to be notified about",
      })
    }

    const filters: Filter[] = []
    const display: string[] = []

    if (notifyIssues) {
      display.push("issues")
      filters.push({kinds: [GIT_ISSUE], "#a": selectedRepos})
    }

    if (notifyPatches) {
      display.push("patches / PRs")
      filters.push({kinds: [GIT_PATCH, GIT_PULL_REQUEST], "#a": selectedRepos})
    }

    if (notifyPrUpdates) {
      display.push("PR updates")
      filters.push({kinds: [GIT_PULL_REQUEST_UPDATE], "#a": selectedRepos})
    }

    if (notifyStatus) {
      display.push("status changes")
      filters.push({
        kinds: [GIT_STATUS_OPEN, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
        "#a": selectedRepos,
      })
    }

    if (notifyAssignments && $pubkey) {
      display.push("assignments")
      filters.push({kinds: [GIT_LABEL], "#a": selectedRepos, "#p": [$pubkey], "#l": ["assignee"]})
    }

    if (notifyReviews && $pubkey) {
      display.push("review requests")
      filters.push({kinds: [GIT_LABEL], "#a": selectedRepos, "#p": [$pubkey], "#l": ["reviewer"]})
    }

    loading = true

    try {
      const relaySet = new Set<string>(GIT_RELAYS)
      const repoByAddress = new Map<string, RepoAnnouncementEvent>()
      for (const event of $repoAnnouncements as RepoAnnouncementEvent[]) {
        try {
          const address = Address.fromEvent(event).toString()
          repoByAddress.set(address, event)
        } catch {}
      }
      for (const repoAddr of selectedRepos) {
        const repoEvent = repoByAddress.get(repoAddr)
        if (!repoEvent) continue
        try {
          const parsed = parseRepoAnnouncementEvent(repoEvent)
          for (const relay of parsed.relays || []) {
            const normalized = normalizeRelayUrl(relay)
            if (isRelayUrl(normalized)) relaySet.add(normalized)
          }
        } catch {}
      }

      const relays = Array.from(relaySet)
      const feed =
        relays.length > 0
          ? makeIntersectionFeed(feedFromFilters(filters), makeRelayFeed(...relays))
          : feedFromFilters(filters)

      const {error} = await createAlert({
        feed,
        description: `for ${displayList(display)} on ${selectedRepos.length} repos`,
        email: {cron, email},
      })

      if (error) {
        pushToast({theme: "error", message: error})
      } else {
        pushToast({message: "Your alert has been successfully created!"})
        back()
      }
    } finally {
      loading = false
    }
  }

  let lastBookmarksKey = ""

  $effect(() => {
    if (!$pubkey) return
    const relays = getRepoAnnouncementRelays()
    if (relays.length === 0) return
    load({relays, filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]}]})
  })

  $effect(() => {
    if (bookmarkedAddresses.length === 0) return
    const authors = bookmarkedAddresses.map(b => b.author)
    const identifiers = bookmarkedAddresses.map(b => b.identifier)
    const key = `${authors.join(",")}|${identifiers.join(",")}`
    if (key === lastBookmarksKey) return
    lastBookmarksKey = key

    const relayHints = Array.from(
      new Set(bookmarkedAddresses.map(b => b.relayHint).filter((hint): hint is string => Boolean(hint))),
    )
    const relays = getRepoAnnouncementRelays(relayHints)
    if (relays.length === 0) return
    load({relays, filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], authors, "#d": identifiers}]})
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      Add a Repo Alert
    {/snippet}
    {#snippet info()}
      Email digests include issues, patches/PRs, status changes, and assignments.
    {/snippet}
  </ModalHeader>

  <FieldInline>
    {#snippet label()}
      <p>Email Address*</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <input placeholder="email@example.com" bind:value={email} />
      </label>
    {/snippet}
  </FieldInline>

  <FieldInline>
    {#snippet label()}
      <p>Frequency*</p>
    {/snippet}
    {#snippet input()}
      <select bind:value={cron} class="select select-bordered">
        <option value={WEEKLY}>Weekly</option>
        <option value={DAILY}>Daily</option>
      </select>
    {/snippet}
  </FieldInline>

  <div class="card2 bg-alt p-4 shadow-sm">
    <div class="flex items-center justify-between gap-3">
      <strong>Repositories*</strong>
      <span class="text-xs text-muted-foreground">{selectedRepos.length} selected</span>
    </div>
    <label class="input input-bordered mt-3 flex items-center gap-2">
      <Icon icon={Magnifier} />
      <input
        bind:value={repoQuery}
        class="grow"
        type="text"
        placeholder="Search repositories" />
    </label>
    <div class="mt-3 max-h-56 overflow-auto space-y-2">
      {#if filteredRepos.length === 0}
        <p class="text-sm text-muted-foreground">No repositories found.</p>
      {:else}
        {#each filteredRepos as repo (repo.address)}
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              class="checkbox"
              checked={selectedRepos.includes(repo.address)}
              oninput={() => toggleRepo(repo.address)} />
            <span class="truncate">{repo.name}</span>
          </label>
        {/each}
      {/if}
    </div>
  </div>

  <div class="card2 bg-alt p-4 shadow-sm">
    <strong class="mb-2 block">Notifications*</strong>
    <div class="grid gap-2 sm:grid-cols-2">
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyIssues} />
        Issues
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyPatches} />
        Patches / PRs
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyPrUpdates} />
        PR updates
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyStatus} />
        Status changes
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyAssignments} />
        Assigned to me
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={notifyReviews} />
        Review requested
      </label>
    </div>
  </div>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={loading}>
      <Spinner {loading}>Confirm</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
