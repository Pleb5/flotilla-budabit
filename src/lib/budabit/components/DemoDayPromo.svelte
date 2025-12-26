<script lang="ts">
import { pushModal } from "@src/app/util/modal"
import DemoDayApplyModal from "@lib/budabit/components/DemoDayApplyModal.svelte"
import Button from "@src/lib/components/Button.svelte"
import CalendarEventItem from "@src/app/components/CalendarEventItem.svelte"
import { onMount } from "svelte"
import { requestOne } from "@welshman/net"
import { EVENT_TIME, getTagValue } from "@welshman/util"
import type { TrustedEvent } from "@welshman/util"
import { now, sortBy } from "@welshman/lib"

const {url} = $props()

let nextDemoDay:TrustedEvent|null = $state(null)
const calendarEvents = $state<TrustedEvent[]>([])

$effect(() => {
  if (calendarEvents.length === 0) return

  const demoDayEvents = calendarEvents.filter(
    (e) => {
      if (
        (getTagValue("title", e.tags) || "")
          .toLowerCase()
          .includes("budabit demo day")
        && e.pubkey === "d04ecf33a303a59852fdb681ed8b412201ba85d8d2199aec73cb62681d62aa90"
      ) {
        return true
      }
    }
  )
  // Sort by date asc and return soonest event in the future
  sortBy(e => e.created_at, demoDayEvents)
  for (const event of demoDayEvents) {
    const startTime = parseInt(getTagValue("start", event.tags) || "0")
    if (startTime) {
      if (startTime > now()) {
        nextDemoDay = event
        break
      }
    }
  }
})

const loadCalendarEvents = async () => {
  const eventsFilter = [{kinds: [EVENT_TIME]}]
  const events = (await requestOne(
    {relay: url, filters: eventsFilter, autoClose:true}
  )) as TrustedEvent[]
  calendarEvents.push(...events)
}

const apply = () => pushModal(DemoDayApplyModal, {url})

onMount(() => {
  loadCalendarEvents()
})
</script>

<div class="card2">
  <div class="flex flex-col items-center gap-y-4">
    <h1 class="flex items-center justify-center gap-2 sm:text-3xl max-sm:text-2xl font-semibold">
      BudaBit Demo Day
    </h1>
    <h1 class="flex gap-2 sm:text-2xl max-sm:text-xl font-semibold text-center">
      Show off Your Work in Freedom Tech!
    </h1>
    {#if nextDemoDay}
      <CalendarEventItem {url} event={nextDemoDay} />
    {/if}
    <Button 
      class="btn btn-lg md:btn-wide btn-primary"
      onclick={apply}>
      Apply Now
    </Button>
  </div>
</div>
