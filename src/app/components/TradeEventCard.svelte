<script lang="ts">
  import type {ComponentProps} from "svelte"
  import EventCard from "@app/components/EventCard.svelte"
  import TradeEventContent from "@app/components/TradeEventContent.svelte"

  const props: ComponentProps<typeof TradeEventContent> = $props()
</script>

<EventCard event={props.event} relays={props.relays} compact={props.compact} variant="trade">
  <TradeEventContent {...props} />
</EventCard>
