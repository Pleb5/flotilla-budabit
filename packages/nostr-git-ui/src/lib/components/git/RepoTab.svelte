<script lang="ts">
  import { cn } from "../../utils";

  const {
    tabValue,
    label,
    href,
    icon,
    activeTab,
    notification = false,
    pending = false,
    onNavigateIntent,
  }: {
    tabValue: string;
    label: string;
    href: string;
    icon?: any;
    activeTab: string;
    notification?: boolean;
    pending?: boolean;
    onNavigateIntent?: (event: MouseEvent, href: string) => void;
  } = $props();

  const isActive = $derived(activeTab === tabValue);
</script>

<a
  href={href}
  class={cn(
    "ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border-b-2",
    isActive ? "text-foreground border-foreground" : "text-muted-foreground border-transparent",
    pending
      ? "animate-pulse cursor-wait border-primary bg-primary/10 text-foreground ring-2 ring-primary/30"
      : ""
  )}
  data-state={isActive ? "active" : undefined}
  aria-current={isActive ? "page" : undefined}
  aria-busy={pending}
  tabindex="0"
  onclick={(event) => onNavigateIntent?.(event, href)}
>
  <span class="flex items-center gap-1">
    {@render icon?.()}
    <span class="relative">
      {label}
      {#if notification}
        <span
          class="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-primary"
          aria-label="Unread updates"
          title="Unread updates"
        ></span>
      {/if}
    </span>
  </span>
</a>
