<script lang="ts">
  import type {ComponentProps} from "svelte"
  import ArticleContent from "@app/components/ArticleContent.svelte"
  import EventCard from "@app/components/EventCard.svelte"

  const props: ComponentProps<typeof ArticleContent> = $props()
</script>

<EventCard event={props.event} relays={props.relays} compact={props.compact} variant="article">
  <ArticleContent {...props} />
</EventCard>
