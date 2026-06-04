<script lang="ts">
  import {goto} from "$app/navigation"
  import {profilesByPubkey, publishThunk} from "@welshman/app"
  import {PublishStatus} from "@welshman/net"
  import {getTagValue, makeEvent, THREAD, type TrustedEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import {preventDefault} from "@lib/html"
  import ContentQuote from "@app/components/ContentQuote.svelte"
  import {makeCommunityThread} from "@app/core/community-threads"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
  } from "@app/core/community-permissions"
  import {getQuoteEventTags} from "@app/util/git-quote"
  import {getEventShareRelayHints, makeEventShareNostrUri} from "@app/util/event-share"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {makeCommunityThreadPath} from "@app/util/routes"
  import {pushToast} from "@app/util/toast"
  import {GIT_ISSUE, GIT_PULL_REQUEST} from "@nostr-git/core/events"

  type Props = {
    event: TrustedEvent
    url?: string
    relays?: string[]
    defaultCommunityPubkey?: string
  }

  type PublishThunkResult = {
    event?: TrustedEvent
    complete?: Promise<unknown>
    results?: Record<string, {status?: unknown}>
  }

  const {event, url = "", relays = [], defaultCommunityPubkey = ""}: Props = $props()

  const getActivityKindLabel = () => {
    if (event.kind === GIT_ISSUE) return "issue"
    if (event.kind === GIT_PULL_REQUEST) return "pull request"
    return "activity"
  }

  const getDefaultTitle = () => {
    const subject = getTagValue("subject", event.tags) || "Untitled"

    return `Discuss ${getActivityKindLabel()}: ${subject}`
  }

  const getCommunityLabel = (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)

    return profile?.display_name || profile?.name || formatShortNpub(pubkey) || "Community"
  }

  const isRelaySuccessStatus = (status: unknown) =>
    status === PublishStatus.Success || String(status).toLowerCase() === "success"

  const hasRelaySuccess = (thunk: PublishThunkResult) =>
    Object.values(thunk.results || {}).some(result => isRelaySuccessStatus(result?.status))

  const waitForFirstRelaySuccess = (thunk: PublishThunkResult, timeoutMs = 30_000) =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      const timers: {
        interval?: ReturnType<typeof setInterval>
        timeout?: ReturnType<typeof setTimeout>
      } = {}

      const cleanup = () => {
        if (timers.interval) clearInterval(timers.interval)
        if (timers.timeout) clearTimeout(timers.timeout)
      }

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const check = () => {
        if (!hasRelaySuccess(thunk)) return false
        finish(resolve)
        return true
      }

      if (check()) return

      timers.interval = setInterval(check, 100)
      timers.timeout = setTimeout(
        () => finish(() => reject(new Error("No relay accepted the thread in time."))),
        timeoutMs,
      )

      thunk.complete
        ?.then(() => {
          if (check()) return
          finish(() => reject(new Error("No relay accepted the thread.")))
        })
        .catch(error => finish(() => reject(error)))
    })

  const back = () => history.back()

  const createThread = async () => {
    const trimmedTitle = title.trim()
    const trimmedContext = context.trim()

    if (!trimmedTitle || !selectedCommunity || publishing || !quoteUri) return

    if (publishRelays.length === 0) {
      pushToast({theme: "error", message: "Selected community has no publish relays."})
      return
    }

    publishing = true

    try {
      const content = trimmedContext ? `${quoteUri}\n\n${trimmedContext}` : quoteUri
      const threadEvent = makeEvent(
        THREAD,
        makeCommunityThread({
          communityPubkey: selectedCommunity.communityPubkey,
          title: trimmedTitle,
          content,
          tags: quoteTags,
        }),
      )
      const thunk = publishThunk({relays: publishRelays, event: threadEvent}) as PublishThunkResult
      const publishedEvent = thunk.event

      if (!publishedEvent?.id) {
        throw new Error("Thread could not be signed.")
      }

      await waitForFirstRelaySuccess(thunk)
      await goto(makeCommunityThreadPath(selectedCommunity.communityPubkey, publishedEvent.id), {
        replaceState: true,
      })
      pushToast({message: `thread '${trimmedTitle}' created!`})
    } catch (error) {
      console.error("Failed to create activity thread", error)
      pushToast({theme: "error", message: "Failed to create thread. No relay accepted it yet."})
    } finally {
      publishing = false
    }
  }

  let title = $state(getDefaultTitle())
  let context = $state("")
  let selectedCommunityPubkey = $state("")
  let publishing = $state(false)

  const quoteRelayHints = $derived(getEventShareRelayHints(event, {url, relays}))
  const quoteUri = $derived(makeEventShareNostrUri(event, {url, relays}))
  const quoteTags = $derived(
    getQuoteEventTags({id: event.id, author: event.pubkey, relays: quoteRelayHints}),
  )
  const quoteValue = $derived({
    id: event.id,
    kind: event.kind,
    pubkey: event.pubkey,
    relays: quoteRelayHints,
  })
  const threadCommunityOptions = $derived.by(() =>
    $activeUserCommunityRefs.filter(ref =>
      communityWritableSectionsSupportTarget({
        definition: ref.definition,
        writableSections: ref.writableSections,
        target: COMMUNITY_WRITE_TARGETS.thread,
      }),
    ),
  )
  const selectedCommunity = $derived(
    threadCommunityOptions.find(ref => ref.communityPubkey === selectedCommunityPubkey),
  )
  const publishRelays = $derived(
    selectedCommunity ? getCommunityScopedPublishRelays(selectedCommunity.definition) : [],
  )

  $effect(() => {
    if (
      selectedCommunityPubkey &&
      threadCommunityOptions.some(ref => ref.communityPubkey === selectedCommunityPubkey)
    ) {
      return
    }

    selectedCommunityPubkey =
      threadCommunityOptions.find(ref => ref.communityPubkey === defaultCommunityPubkey)
        ?.communityPubkey ||
      threadCommunityOptions[0]?.communityPubkey ||
      ""
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(createThread)}>
  <ModalHeader>
    {#snippet title()}
      <div>Create Activity Thread</div>
    {/snippet}
    {#snippet info()}
      <div>The activity quote is locked. Add your context below it.</div>
    {/snippet}
  </ModalHeader>

  {#if threadCommunityOptions.length === 0}
    <div class="rounded-box border border-warning/40 bg-warning/10 p-4 text-sm">
      You do not have permission to publish threads in any loaded community.
    </div>
  {:else}
    <Field>
      {#snippet label()}
        <p>Community</p>
      {/snippet}
      {#snippet input()}
        <select bind:value={selectedCommunityPubkey} class="select select-bordered w-full">
          {#each threadCommunityOptions as option (option.communityPubkey)}
            <option value={option.communityPubkey}
              >{getCommunityLabel(option.communityPubkey)}</option>
          {/each}
        </select>
      {/snippet}
    </Field>

    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={NotesMinimalistic} />
          <input bind:value={title} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>

    <Field>
      {#snippet label()}
        <p>Locked quote</p>
      {/snippet}
      {#snippet input()}
        <div class="rounded-box border border-border/60 bg-base-200/40 p-2">
          <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This quote will be included at the top of the thread.
          </div>
          <ContentQuote value={quoteValue} {event} {url} />
        </div>
      {/snippet}
    </Field>

    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea
          bind:value={context}
          class="textarea textarea-bordered min-h-32"
          placeholder="Add context after the fixed quote (optional)"></textarea>
      {/snippet}
    </Field>
  {/if}

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={publishing}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button
      type="submit"
      class="btn btn-primary"
      disabled={publishing || !title.trim() || !selectedCommunity || !quoteUri}>
      {#if publishing}
        <span class="loading loading-spinner loading-xs"></span>
        Publishing
      {:else}
        Create Thread
        <Icon icon={AltArrowRight} />
      {/if}
    </Button>
  </ModalFooter>
</form>
