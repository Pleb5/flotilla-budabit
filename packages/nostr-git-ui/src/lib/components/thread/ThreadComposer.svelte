<script lang="ts">
  import { Plus, Send } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Button } = useRegistry();
  import { Textarea } from "../ui/textarea";

  const { onSubmit }: { onSubmit: (message: string) => void } = $props();
  let message = $state("");

  function handleSubmit(e: Event) {
    e.preventDefault();
    onSubmit(message);
    message = "";
  }
</script>

<form onsubmit={handleSubmit} class="flex gap-2">
  <div class="flex-1 relative">
    <Textarea
      bind:value={message}
      placeholder="Type a message or use / commands..."
      class="min-h-[60px] resize-none pr-12"
    />
    <div class="absolute right-2 top-2">
      <Button type="button" variant="ghost" size="icon">
        <Plus class="h-4 w-4" />
      </Button>
    </div>
  </div>
  <Button type="submit" size="icon" class="h-[60px] w-[60px]">
    <Send class="h-5 w-5" />
  </Button>
</form>
