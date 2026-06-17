<script lang="ts">
  import type {Snippet} from "svelte"
  import {writable} from "svelte/store"
  import {goto} from "$app/navigation"
  import {HOUR, now, randomId} from "@welshman/lib"
  import {EVENT_DATE, EVENT_TIME, makeEvent} from "@welshman/util"
  import {publishThunk} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import MapPoint from "@assets/icons/map-point.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import DateTimeInput from "@lib/components/DateTimeInput.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import EditorContent from "@app/editor/EditorContent.svelte"
  import {makeEditor, plainTextToTiptapHTML} from "@app/editor"
  import {normalizeRelays} from "@app/core/community"
  import {
    type CalendarEventKind,
    makeCalendarEventTags,
    normalizeCalendarEventKind,
    parseCalendarDate,
    timestampToDateInputValue,
  } from "@app/core/calendar-events"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {pushToast} from "@app/util/toast"

  type Props = {
    url: string
    h?: string
    relays?: string[]
    redirectPath?: string
    header: Snippet
    initialValues?: {
      kind?: number
      created_at?: number
      d?: string
      title?: string
      content?: string
      location?: string
      start?: number
      end?: number
      startDate?: string
      endDate?: string
      tags?: string[][]
    }
  }

  const {url, h, relays = [], redirectPath, header, initialValues}: Props = $props()
  const managedTagNames = new Set(["d", "title", "name", "location", "start", "end", "D", "h"])

  const uploading = writable(false)
  const uploadStage = writable<BlossomUploadStage>("idle")

  const back = () => history.back()

  const selectFiles = () => editor.then(ed => ed.chain().selectFiles().run())

  const validateDateRange = () => {
    const normalizedStartDate = parseCalendarDate(startDate)
    const normalizedEndDate = parseCalendarDate(endDate) || normalizedStartDate

    if (!normalizedStartDate) {
      pushToast({theme: "error", message: "Please provide a valid start date."})
      return undefined
    }

    if (!normalizedEndDate) {
      pushToast({theme: "error", message: "Please provide a valid end date."})
      return undefined
    }

    if (normalizedEndDate < normalizedStartDate) {
      pushToast({theme: "error", message: "End date must be on or after start date."})
      return undefined
    }

    if (normalizedEndDate < timestampToDateInputValue(now())) {
      pushToast({theme: "error", message: "End date must be today or later."})
      return undefined
    }

    return {startDate: normalizedStartDate, endDate: normalizedEndDate}
  }

  const validateTimeRange = () => {
    if (!start || !end) {
      pushToast({theme: "error", message: "Please provide start and end times."})
      return undefined
    }

    if (start >= end) {
      pushToast({theme: "error", message: "End time must be later than start time."})
      return undefined
    }

    if (end <= now()) {
      pushToast({theme: "error", message: "End time must be in the future."})
      return undefined
    }

    return {start, end}
  }

  const submit = async () => {
    if ($uploading) return

    if (!title) {
      return pushToast({
        theme: "error",
        message: "Please provide a title.",
      })
    }

    const eventKind = normalizeCalendarEventKind(kind)
    const dateRange = eventKind === EVENT_DATE ? validateDateRange() : undefined
    const timeRange = eventKind === EVENT_TIME ? validateTimeRange() : undefined
    if (eventKind === EVENT_DATE && !dateRange) return
    if (eventKind === EVENT_TIME && !timeRange) return

    const ed = await editor
    const content = ed.getText({blockSeparator: "\n"}).trim()
    const preservedTags = (initialValues?.tags || []).filter(tag => !managedTagNames.has(tag[0]))
    const extraTags = [...ed.storage.nostr.getEditorTags()]

    if (h) {
      extraTags.push(["h", h])
    }

    const tags = makeCalendarEventTags({
      kind: eventKind,
      identifier: initialValues?.d || randomId(),
      title,
      location,
      start: timeRange?.start,
      end: timeRange?.end,
      startDate: dateRange?.startDate,
      endDate: dateRange?.endDate,
      preservedTags,
      extraTags,
    })
    const created_at = initialValues?.created_at
      ? Math.max(now(), initialValues.created_at + 1)
      : undefined
    const event = makeEvent(eventKind, {content, tags, created_at})
    const publishRelays = normalizeRelays(relays.length ? relays : [url])

    if (publishRelays.length === 0) {
      return pushToast({theme: "error", message: "No relay is available to publish this event."})
    }

    pushToast({message: "Your event has been saved!"})
    publishThunk({event, relays: publishRelays})

    if (redirectPath) {
      goto(redirectPath, {replaceState: true})
    } else {
      history.back()
    }
  }

  const content = initialValues?.content || ""
  const tiptapContent = plainTextToTiptapHTML(content)
  const editor = makeEditor({
    url,
    blossomContext: h ? {type: "community", communityPubkey: h} : undefined,
    submit,
    uploadStage,
    uploading,
    content: tiptapContent,
  })

  let title = $state(initialValues?.title || "")
  let location = $state(initialValues?.location || "")
  let kind = $state<CalendarEventKind>(normalizeCalendarEventKind(initialValues?.kind))
  let start: number | undefined = $state(initialValues?.start)
  let end: number | undefined = $state(initialValues?.end)
  let startDate = $state(initialValues?.startDate || timestampToDateInputValue(initialValues?.start))
  let endDate = $state(initialValues?.endDate || timestampToDateInputValue(initialValues?.end))
  let endDirty = Boolean(initialValues?.end)
  const isDateBased = $derived(kind === EVENT_DATE)

  $effect(() => {
    if (!endDirty && start) {
      end = start + HOUR
    } else if (end) {
      endDirty = true
    }
  })

  $effect(() => {
    if (!isDateBased) return
    if (!startDate && start) startDate = timestampToDateInputValue(start)
    if (!endDate && end) endDate = timestampToDateInputValue(end)
  })
</script>

<form novalidate class="column gap-4" onsubmit={preventDefault(submit)}>
  {@render header()}
  <Field>
    {#snippet label()}
      <p>Title*</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <input bind:value={title} class="grow" type="text" />
      </label>
    {/snippet}
  </Field>
  <Field>
    {#snippet label()}
      <p>Summary</p>
    {/snippet}
    {#snippet input()}
      <div class="relative z-feature flex gap-2 border-t border-solid border-base-100 bg-base-100">
        <div class="input-editor flex-grow overflow-hidden">
          <EditorContent {editor} />
        </div>
        <!-- <Button data-tip="Add an image" class="center btn tooltip" onclick={selectFiles}> -->
        <!--   {#if $uploading} -->
        <!--     <span class="loading loading-spinner loading-xs"></span> -->
        <!--   {:else} -->
        <!--     <Icon icon={GallerySend} /> -->
        <!--   {/if} -->
        <!-- </Button> -->
      </div>
      <div class="mt-2">
        <BlossomUploadStatus stage={$uploadStage} />
      </div>
    {/snippet}
  </Field>
  <Field>
    {#snippet label()}
      <p>Event type</p>
    {/snippet}
    {#snippet input()}
      <select bind:value={kind} class="select select-bordered w-full">
        <option value={EVENT_TIME}>Timed event</option>
        <option value={EVENT_DATE}>All-day event</option>
      </select>
    {/snippet}
  </Field>
  {#if isDateBased}
    <Field>
      {#snippet label()}
        Start date*
      {/snippet}
      {#snippet input()}
        <input bind:value={startDate} class="input input-bordered w-full" type="date" />
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        End date* <span class="text-xs opacity-70">inclusive</span>
      {/snippet}
      {#snippet input()}
        <input bind:value={endDate} class="input input-bordered w-full" type="date" />
      {/snippet}
    </Field>
  {:else}
    <Field>
      {#snippet label()}
        Start*
      {/snippet}
      {#snippet input()}
        <DateTimeInput bind:value={start} />
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        End*
      {/snippet}
      {#snippet input()}
        <DateTimeInput bind:value={end} />
      {/snippet}
    </Field>
  {/if}
  <Field>
    {#snippet label()}
      <p>Location (optional)</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon={MapPoint} />
        <input bind:value={location} class="grow" type="text" />
      </label>
    {/snippet}
  </Field>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={$uploading}>
      <Spinner loading={$uploading}>Save Event</Spinner>
    </Button>
  </ModalFooter>
</form>
