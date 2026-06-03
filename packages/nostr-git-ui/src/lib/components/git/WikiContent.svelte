<script lang="ts">
  import { Plus } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Card, Button } = useRegistry();

  // Accept content (string | SvelteComponent | undefined) and pageName as props
  const props = $props();
  const pageName: string = props.pageName;
  // content can be a string (markdown/html) or a Svelte component
  const content: string | typeof import("svelte").SvelteComponent | undefined = props.content;
</script>

<Card class="p-6">
  {#if typeof content === "object" && content}
    <!-- Svelte 5 runes mode: dynamic components are just rendered as {content} -->
    {content}
  {:else if typeof content === "string"}
    <div class="prose prose-sm max-w-none">{@html content}</div>
  {:else}
    <div class="flex flex-col items-center justify-center py-12">
      <div class="text-6xl mb-4">📝</div>
      <h2 class="text-xl font-semibold mb-2">Page not found</h2>
      <p class="" style="color: hsl(var(--ng-muted-foreground)); mb-6">
        The wiki page "{pageName}" does not exist yet.
      </p>
      <Button variant="default" class="flex items-center gap-2">
        <Plus class="h-4 w-4" /> Create this page
      </Button>
    </div>
  {/if}
</Card>
