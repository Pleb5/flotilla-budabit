<script lang="ts">
  import { context } from "../stores/context";
  import { fade } from "svelte/transition";
  import { Check, AlertCircle, Loader2, AlertTriangle, Info } from "@lucide/svelte";
  import { derived } from "svelte/store";

  // Convert the record of messages to an array for iteration
  const messages = derived(context, ($context) => {
    return Object.values($context);
  });

  const icons = {
    loading: Loader2,
    error: AlertCircle,
    warning: AlertTriangle,
    success: Check,
    info: Info,
  };

  const colors = {
    loading: "text-blue-500",
    error: "text-red-500",
    warning: "text-yellow-500",
    success: "text-green-500",
    info: "text-blue-500",
  };

  const bgColors = {
    loading: "bg-blue-50 dark:bg-blue-900/30",
    error: "bg-red-50 dark:bg-red-900/30",
    warning: "bg-yellow-50 dark:bg-yellow-900/30",
    success: "bg-green-50 dark:bg-green-900/30",
    info: "bg-blue-50 dark:bg-blue-900/30",
  };

  const borderColors = {
    loading: "border-blue-200 dark:border-blue-800",
    error: "border-red-200 dark:border-red-800",
    warning: "border-yellow-200 dark:border-yellow-800",
    success: "border-green-200 dark:border-green-800",
    info: "border-blue-200 dark:border-blue-800",
  };
</script>

<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]">
  {#each $messages as message (message.id)}
    <div
      class={[
        "rounded-lg border p-4 shadow-lg transition-all duration-200",
        message.type === "loading" ? "animate-pulse opacity-90" : "",
        bgColors[message.type] || "bg-white dark:bg-gray-800",
        borderColors[message.type] || "border-gray-200 dark:border-gray-700",
      ]
        .filter(Boolean)
        .join(" ")}
      in:fade={{ duration: 150 }}
      out:fade={{ duration: 150 }}
    >
      <div class="flex items-start gap-3">
        <div
          class={`mt-0.5 flex-shrink-0 ${colors[message.type as keyof typeof colors] || "text-gray-500"}`}
        >
          {#if message.type === "loading"}
            <Loader2 class="h-5 w-5 animate-spin" />
          {:else if message.type === "error"}
            <AlertCircle class="h-5 w-5" />
          {:else if message.type === "warning"}
            <AlertTriangle class="h-5 w-5" />
          {:else if message.type === "success"}
            <Check class="h-5 w-5" />
          {:else}
            <Info class="h-5 w-5" />
          {/if}
        </div>
        <div class="flex-1">
          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {message.message}
          </p>
          {#if message.details}
            <p class="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {typeof message.details === "string"
                ? message.details
                : JSON.stringify(message.details, null, 2)}
            </p>
          {/if}
        </div>
        <button
          type="button"
          class="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          onclick={() => context.remove(message.id)}
        >
          <span class="sr-only">Close</span>
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </button>
      </div>
    </div>
  {/each}
</div>
