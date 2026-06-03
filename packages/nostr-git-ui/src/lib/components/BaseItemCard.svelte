<script lang="ts">
  import { useRegistry } from "../useRegistry";
  import type { Snippet } from "svelte";
  const { Card } = useRegistry();

  export type CardVariant = "issue" | "pr" | "commit";

  interface Props {
    variant?: CardVariant;
    accent?: "blue" | "purple" | "red" | "zinc" | "green" | "amber";
    href?: string;
    clickable?: boolean;
    compact?: boolean;
    disablePrefetch?: boolean;
    // snippets
    children: Snippet;
    slotIcon?: Snippet;
    slotTitle?: Snippet;
    slotActions?: Snippet;
    slotMeta?: Snippet;
    slotTags?: Snippet;
    slotStatus?: Snippet;
    slotFooter?: Snippet;
    slotSide?: Snippet;
  }

  let {
    variant = "issue",
    accent = "zinc",
    href,
    clickable = false,
    compact = false,
    disablePrefetch = false,
    children,
    slotIcon,
    slotTitle,
    slotActions,
    slotMeta,
    slotTags,
    slotStatus,
    slotFooter,
    slotSide,
  }: Props = $props();

  const accentClass = $derived.by(() => {
    switch (accent) {
      case "blue":
        return "accent-blue-500";
      case "purple":
        return "accent-purple-500";
      case "red":
        return "accent-red-500";
      case "green":
        return "accent-green-500";
      case "amber":
        return "accent-amber-500";
      default:
        return "accent-zinc-500";
    }
  });

  const footerClass = $derived.by(() => {
    return variant === "commit" ? "ml-auto w-full" : "ml-auto";
  });
</script>

<Card class={`git-card transition-colors ${clickable ? "hover:bg-muted/20" : ""}`}>
  <div class="flex items-start gap-3">
    <!-- Left column: icon / status indicator -->
    {#if slotIcon}
      <div class="flex-shrink-0 mt-0.5">
        {@render slotIcon?.()}
      </div>
    {/if}

    <!-- Main content -->
    <div class="flex flex-col flex-1 min-w-0 gap-2">
      <!-- Title row -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex-1 min-w-0">
          {#if href}
            <a
              href={href}
              class={clickable ? "cursor-pointer" : ""}
              data-sveltekit-preload-data={disablePrefetch ? "off" : undefined}
            >
              <h3
                class={`text-base font-semibold leading-tight break-words line-clamp-2 ${clickable ? "transition-colors hover:text-foreground" : ""}`}
              >
                {@render slotTitle?.()}
              </h3>
              {#if !compact}
                <div class="text-sm text-muted-foreground">
                  <!-- optional subtitle snippet in future -->
                </div>
              {/if}
            </a>
          {:else}
            <h3 class={`text-base font-semibold leading-tight break-words line-clamp-2`}>
              {@render slotTitle?.()}
            </h3>
          {/if}
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          {@render slotActions?.()}
        </div>
      </div>

      <!-- Meta row: author, time, counts -->
      <div class="flex items-center flex-wrap gap-2 text-sm text-muted-foreground overflow-hidden">
        {@render slotMeta?.()}
      </div>

      <!-- Body content -->
      <div class="text-sm text-muted-foreground min-w-0">
        {@render children?.()}
      </div>

      <!-- Tags / labels -->
      <div class="flex flex-nowrap gap-1 min-w-0 overflow-x-auto">
        {@render slotTags?.()}
      </div>

      <!-- Footer: status pill / controls -->
      <div class="flex items-center gap-2">
        {@render slotStatus?.()}
        <div class={footerClass}>{@render slotFooter?.()}</div>
      </div>
    </div>

    <!-- Right column optional (e.g., avatar) - only render if slotSide is provided -->
    {#if slotSide}
      <div class="flex-shrink-0 w-10">
        {@render slotSide()}
      </div>
    {/if}
  </div>
</Card>
