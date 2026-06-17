<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import CalendarEventForm from "@app/components/CalendarEventForm.svelte"
  import {getCalendarEventRange, parseCalendarTimestamp} from "@app/core/calendar-events"

  type Props = {
    url: string
    event: TrustedEvent
    relays?: string[]
    redirectPath?: string
  }

  const {url, event, relays = [], redirectPath}: Props = $props()
  const h = getTagValue("h", event.tags)

  const getFirstTagValue = (...names: string[]) => {
    for (const name of names) {
      const value = getTagValue(name, event.tags)
      if (value) return value
    }

    return ""
  }

  const range = getCalendarEventRange(event)

  const initialValues = {
    kind: event.kind,
    created_at: event.created_at,
    d: getFirstTagValue("d"),
    title: getFirstTagValue("title", "name"),
    location: getFirstTagValue("location"),
    start: range?.dateBased ? undefined : parseCalendarTimestamp(getFirstTagValue("start")),
    end: range?.dateBased ? undefined : parseCalendarTimestamp(getFirstTagValue("end")),
    startDate: range?.dateBased ? range.startDate : undefined,
    endDate: range?.dateBased ? range.endDate : undefined,
    content: event.content || getFirstTagValue("description", "summary"),
    tags: event.tags,
  }
</script>

<CalendarEventForm {url} {h} {relays} {initialValues} {redirectPath}>
  {#snippet header()}
    <ModalHeader>
      {#snippet title()}
        <div>Edit this Event</div>
      {/snippet}
      {#snippet info()}
        <div>Invite other group members to events online or in real life.</div>
      {/snippet}
    </ModalHeader>
  {/snippet}
</CalendarEventForm>
