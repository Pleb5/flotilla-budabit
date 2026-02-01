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
let broadCast = $state(true)
let posting = $state(false)

let budabitThunk: Thunk | undefined = $state()
let noteThunk: Thunk | undefined = $state()

const validate = ():boolean => {
  if (!title) return false
  if (!pitch) return false

  return true
}

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

  let content = "## BudaBit Demo Day application\n"
  content += `### Title: ${title}\n\n`
  content += `Pitch:\n${pitch}`

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
