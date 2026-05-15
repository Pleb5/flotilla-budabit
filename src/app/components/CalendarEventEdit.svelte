<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import CalendarEventForm from "@app/components/CalendarEventForm.svelte"

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

  const parseCalendarTime = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return undefined

    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1000 : numeric)
    }

    const timestamp = Date.parse(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed)

    return Number.isNaN(timestamp) ? undefined : Math.floor(timestamp / 1000)
  }

  const initialValues = {
    kind: event.kind,
    created_at: event.created_at,
    d: getFirstTagValue("d"),
    title: getFirstTagValue("title", "name"),
    location: getFirstTagValue("location"),
    start: parseCalendarTime(getFirstTagValue("start")),
    end: parseCalendarTime(getFirstTagValue("end")),
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
