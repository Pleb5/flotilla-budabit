<script lang="ts">
import ThunkFailure from "@src/app/components/ThunkFailure.svelte"
import Button from "@src/lib/components/Button.svelte"
import Field from "@src/lib/components/Field.svelte"
import FieldInline from "@src/lib/components/FieldInline.svelte"
import ModalFooter from "@src/lib/components/ModalFooter.svelte"
import ModalHeader from "@src/lib/components/ModalHeader.svelte"
import Spinner from "@src/lib/components/Spinner.svelte"
import { publishThunk, Thunk } from "@welshman/app"
import { makeEvent, MESSAGE, NOTE } from "@welshman/util"
import { tick } from "svelte"
import { Router } from "@welshman/router"
import { GIT_RELAYS } from "@lib/budabit/state"
import { pushToast } from "@src/app/util/toast"
import { PublishStatus } from "@welshman/net"
import { goto } from "$app/navigation"
import { makeRoomPath } from "@src/app/util/routes"

const {url} = $props()

let title = $state("")
let pitch = $state("")
let post = $state("")
let postEdited = $state(false)
let broadCast = $state(true)
let posting = $state(false)

let budabitThunk: Thunk | undefined = $state()
let noteThunk: Thunk | undefined = $state()
let lastTitle: string | null = $state(null)
let lastPitch: string | null = $state(null)

const buildDefaultPost = (title: string, pitch: string) => {
  return `## BudaBit Demo Day application\n### Title: ${title}\n\nPitch:\n${pitch}`
}

const replaceFirst = (text: string, search: string, replacement: string) => {
  if (!search) return text

  const index = text.indexOf(search)
  if (index === -1) return text

  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`
}

const updatePostWithFields = (
  text: string,
  title: string,
  pitch: string,
  lastTitle: string | null,
  lastPitch: string | null
) => {
  let updated = text

  const titleLineRegex = /^(#{0,6}\s*Title:\s*).*/m

  if (titleLineRegex.test(updated)) {
    updated = updated.replace(titleLineRegex, `$1${title}`)
  } else if (lastTitle) {
    updated = replaceFirst(updated, lastTitle, title)
  } else if (title) {
    updated = `### Title: ${title}\n\n${updated}`
  }

  if (lastPitch) {
    const replaced = replaceFirst(updated, lastPitch, pitch)
    if (replaced !== updated) {
      return replaced
    }
  }

  const pitchBlockRegex = /^(Pitch:\s*\n)([\s\S]*?)(\n#{1,6}\s|\n*$)/m

  if (pitchBlockRegex.test(updated)) {
    return updated.replace(pitchBlockRegex, `$1${pitch}$3`)
  }

  return `${updated.trimEnd()}\n\nPitch:\n${pitch}`
}

const markPostEdited = () => {
  postEdited = true
}

const validate = ():boolean => {
  if (!title) return false
  if (!pitch) return false

  return true
}

$effect(() => {
  const titleChanged = title !== lastTitle
  const pitchChanged = pitch !== lastPitch

  if (!titleChanged && !pitchChanged) return

  if (!postEdited) {
    post = buildDefaultPost(title, pitch)
  } else {
    post = updatePostWithFields(post, title, pitch, lastTitle, lastPitch)
  }

  lastTitle = title
  lastPitch = pitch
})

const apply = async () => {
  if (!validate()) {
    pushToast({
      theme: "error",
      timeout: 5000,
      message: "Please fill in both Title and Pitch to apply!"
    })
    return
  }
  posting = true
  await tick()

  const content = post.trim() ? post : buildDefaultPost(title, pitch)

  const roomTag = ["h", "Demo Day"]
  const tTag = ["t", "budabitdemoday"]

  const roomMessageEvent = makeEvent(MESSAGE, {content, tags:[roomTag, tTag]})
  const noteEvent = makeEvent(NOTE, {content, tags:[tTag]})

  budabitThunk = publishThunk({
      relays: [url as string],
      event: roomMessageEvent
  })

  await budabitThunk.complete

  const budabitThunkSuccess = budabitThunk.results[url].status === PublishStatus.Success

  let noteThunkSuccess = true
  if (broadCast) {
    noteThunkSuccess = false
    let relays = Router.get().FromUser().getUrls()
    if (relays.length === 0) {
      relays = GIT_RELAYS
    }

    noteThunk = publishThunk({
      relays,
      event: noteEvent
    })

    await noteThunk.complete

    GIT_RELAYS.forEach(r => {
      if (noteThunk?.results[r].status === PublishStatus.Success) {
        noteThunkSuccess = true
        return
      }
    })
  }

  posting = false


  if (budabitThunkSuccess && noteThunkSuccess) {
    pushToast({
      message: "Thanks for Applying! Don't forget to promote your Demo and get as many zaps as possible!",
      timeout: 15_000
    })
  }

  goto(makeRoomPath(url, 'Demo Day'))
}

</script>

{#if budabitThunk}
  <ThunkFailure showToastOnRetry thunk={budabitThunk} class="mt-1" />
{/if}

{#if noteThunk}
  <ThunkFailure showToastOnRetry thunk={noteThunk} class="mt-1" />
{/if}

<div class="column gap-4">
  <ModalHeader>
    {#snippet title()}
      <div class="md:text-4xl">Apply to BudaBit Demo Day</div>
    {/snippet}
    {#snippet info()}
      <div class="text-lg md:texl-3xl">Register your demo to the list</div>
    {/snippet}
  </ModalHeader>
  <Field>
    {#snippet label()}
      <p>Demo Title</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <input bind:value={title} class="grow" type="text" />
      </label>
    {/snippet}
  </Field>
  <Field>
    {#snippet label()}
      <p>Demo Pitch</p>
    {/snippet}
    {#snippet input()}
      <textarea
        class="textarea textarea-bordered leading-4"
        placeholder="Write about why people should care about your demo"
        rows="5"
        bind:value={pitch}>
      </textarea>
    {/snippet}
  </Field>
  <Field>
    {#snippet label()}
      <p>Your post</p>
    {/snippet}
    {#snippet input()}
      <textarea
        class="textarea textarea-bordered leading-4"
        rows="8"
        bind:value={post}
        on:input={markPostEdited}>
      </textarea>
    {/snippet}
  </Field>
  <p class="text-warning">
    Required tag:
    <span class='text-blue-500'>#budabitdemoday</span>
  </p>
  <FieldInline>
    {#snippet label()}
      <p>Broadcast to Nostr</p>
    {/snippet}
    {#snippet input()}
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:checked={broadCast} />
    {/snippet}
    {#snippet info()}
      <p>Post as a note to multiple relays. Your application will be posted in BudaBit #Demo Day room by default</p>
    {/snippet}
  </FieldInline>
  {#if !broadCast}
    <p class="text-warning">
      You can post later with
      <span class='text-blue-500'>#budabitdemoday</span>
      <span> to promote your demo!</span>
    </p>
  {/if}
  <p class="text-warning">
    Follow 
    <span class='text-blue-500'>#budabitdemoday</span>
    <span> to stay in the loop!</span>
  </p>
  <ModalFooter>
    <div class="w-full flex justify-center">
      <Button class="btn btn-lg btn-wide btn-primary" onclick={apply}>
        {#if posting}
          <Spinner loading>Posting...</Spinner>
        {:else}
          Apply
        {/if}
      </Button>
    </div>
  </ModalFooter>
</div>
