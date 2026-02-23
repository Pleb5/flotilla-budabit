<style lang="postcss">
  .markdown {
    @apply text-base leading-relaxed;
  }

  .markdown :global(h1) {
    @apply mb-4 mt-6 text-3xl font-bold;
  }

  .markdown :global(h2) {
    @apply mb-3 mt-5 text-2xl font-bold;
  }

  .markdown :global(h3) {
    @apply mb-2 mt-4 text-xl font-semibold;
  }

  .markdown :global(h4) {
    @apply mb-2 mt-3 text-lg font-semibold;
  }

  .markdown :global(h5) {
    @apply mb-1 mt-2 text-base font-semibold;
  }

  .markdown :global(h6) {
    @apply mb-1 mt-2 text-sm font-semibold;
  }

  .markdown :global(p) {
    @apply my-3;
  }

  .markdown :global(a) {
    @apply text-primary hover:underline;
  }

  .markdown :global(strong) {
    @apply font-bold;
  }

  .markdown :global(em) {
    @apply italic;
  }

  .markdown :global(code) {
    @apply rounded bg-base-200 px-1.5 py-0.5 font-mono text-sm;
    color: hsl(var(--bc) / 0.9);
  }

  .markdown :global(pre) {
    @apply my-4 overflow-x-auto rounded-lg border border-base-300 bg-base-300/50 p-4;
    box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);
  }

  .markdown :global(pre code) {
    @apply bg-transparent p-0 text-sm;
    font-family: "Menlo", "Monaco", "Courier New", monospace;
    line-height: 1.5;
  }

  .markdown :global(blockquote) {
    @apply my-4 border-l-4 border-primary pl-4 italic;
  }

  .markdown :global(ul) {
    @apply my-3 list-disc pl-6;
  }

  .markdown :global(ol) {
    @apply my-3 list-decimal pl-6;
  }

  .markdown :global(li) {
    @apply my-1;
  }

  .markdown :global(hr) {
    @apply my-6 border-t border-base-300;
  }

  /* Table wrapper for horizontal scroll on mobile */
  .markdown :global(table) {
    @apply my-4 w-full border-collapse;
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  @media (min-width: 768px) {
    .markdown :global(table) {
      display: table;
    }
  }

  .markdown :global(th) {
    @apply border border-base-300 bg-base-200 p-2 font-semibold;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .markdown :global(th) {
      white-space: normal;
    }
  }

  .markdown :global(td) {
    @apply border border-base-300 p-2;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .markdown :global(td) {
      white-space: normal;
    }
  }

  .markdown :global(img) {
    @apply my-4 h-auto max-w-full rounded-lg;
  }

  /* Profile mentions - ensure proper vertical alignment */
  .markdown :global(.inline-flex) {
    vertical-align: middle;
  }

  .markdown--comment {
    @apply text-sm leading-relaxed;
  }

  .markdown--comment :global(h1) {
    @apply mb-3 mt-4 text-xl font-bold;
  }

  .markdown--comment :global(h2) {
    @apply mb-2 mt-3 text-lg font-semibold;
  }

  .markdown--comment :global(h3) {
    @apply mb-2 mt-3 text-base font-semibold;
  }

  .markdown--comment :global(h4) {
    @apply mb-2 mt-2 text-sm font-semibold;
  }

  .markdown--comment :global(h5) {
    @apply mb-1 mt-2 text-sm font-semibold;
  }

  .markdown--comment :global(h6) {
    @apply mb-1 mt-2 text-xs font-semibold;
  }

  .markdown--comment :global(p) {
    @apply my-2;
  }

  .markdown--comment :global(ul) {
    @apply my-2 list-disc pl-5;
  }

  .markdown--comment :global(ol) {
    @apply my-2 list-decimal pl-5;
  }

  .markdown--comment :global(li) {
    @apply my-1;
  }

  .markdown--comment :global(blockquote) {
    @apply my-3 border-l-4 border-primary/70 pl-3 italic;
  }

  .markdown--comment :global(pre) {
    @apply my-3;
  }

  .markdown--comment :global(hr) {
    @apply my-4 border-t border-base-300;
  }

  .markdown--comment :global(table) {
    @apply my-3;
  }

  .markdown--comment :global(img) {
    @apply my-3;
  }
</style>

<script lang="ts">
  import {Marked} from "marked"
  import DOMPurify from "dompurify"
  import "highlight.js/styles/github-dark.css"
  import {getContext} from "svelte"
  import {REPO_RELAYS_KEY} from "@lib/budabit"
  import {normalizeRelayUrl} from "@welshman/util"
  import type {TrustedEvent} from "@welshman/util"
  import {createNostrTokenizer, createEmailTokenizer} from "./markdown/markdownTokenizers.js"
  import {createTokenWalker} from "./markdown/markdownTokenWalker.js"
  import {createRenderers} from "./markdown/markdownRenderers.js"
  import {
    mountPlaceholderComponents,
    cleanupMountedComponents,
    type MountedComponent,
  } from "./markdown/markdownComponentMounter.js"

  interface Props {
    content?: string
    relays?: string[]
    event?: TrustedEvent
    url?: string
    minimalQuote?: boolean
    hideMediaAtDepth?: number
    depth?: number
    variant?: "default" | "comment"
  }

  const {
    content = "",
    relays,
    event,
    url,
    minimalQuote = false,
    hideMediaAtDepth = 1,
    depth = 0,
    variant = "default",
  }: Props = $props()

  // ============================================================================
  // Reactive State
  // ============================================================================

  let sanitizedContent = $state("")
  let containerElement: HTMLDivElement | undefined = $state()
  let mountedComponents: MountedComponent[] = $state([])


  // ============================================================================
  // Relay Configuration
  // ============================================================================
  // Determine which relays to use: props > context > empty array

  const contextRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const defaultRelays = $derived.by(() => {
    if (relays && relays.length > 0) {
      return relays.map((u: string) => normalizeRelayUrl(u)).filter(Boolean) as string[]
    }
    if (contextRelays && contextRelays.length > 0) {
      return contextRelays.map((u: string) => normalizeRelayUrl(u)).filter(Boolean) as string[]
    }
    return []
  })

  // ============================================================================
  // Marked Instance Creation
  // ============================================================================
  // Creates a configured Marked instance with Nostr-specific tokenizers and renderers

  const createMarkedInstance = () => {
    const options = {
      event,
      url,
      minimalQuote,
      depth,
      hideMediaAtDepth,
    }

    return new Marked({
      extensions: [
        createNostrTokenizer(options),
        createEmailTokenizer(),
      ],
      async: true,
      breaks: true,
      walkTokens: createTokenWalker({defaultRelays: defaultRelays}),
      renderer: createRenderers(options),
    })
  }

  // ============================================================================
  // Content Parsing Effect
  // ============================================================================
  // Parses markdown content and sanitizes it. Re-runs when content or props change.
  // Note: This will re-run if event/url/etc change, but that's usually fine since
  // we want to re-parse with updated context (e.g., new event for mentions).

  $effect(() => {
    const currentContent = content
    if (!currentContent) {
      sanitizedContent = ""
      return
    }

    // Parse asynchronously to avoid blocking
    ;(async () => {
      const markedInstance = createMarkedInstance()
      const parsed = await markedInstance.parse(currentContent)
      
      // Guard: Only update if content hasn't changed during async operation
      if (content === currentContent) {
        sanitizedContent = DOMPurify.sanitize(parsed, {
          ADD_ATTR: [
            "target",
            "title",
            "data-pubkey",
            "data-url",
            "data-event-id",
            "data-type",
            "data-id",
            "data-relays",
            "data-kind",
            "data-identifier",
            "data-minimal",
            "data-depth",
            "data-hide-media",
          ],
          ADD_TAGS: ["span"],
        })
      }
    })()
  })

  // ============================================================================
  // Component Mounting Effect
  // ============================================================================
  // Mounts Svelte components for placeholders (mentions, quotes, etc.) after
  // the sanitized HTML is rendered. Only re-mounts when sanitizedContent changes
  // to avoid unnecessary work.

  let lastSanitizedContent = ""

  $effect(() => {
    const currentContainer = containerElement
    const currentSanitizedContent = sanitizedContent

    // Only mount if content actually changed (prevents unnecessary re-mounting)
    if (!currentContainer || !currentSanitizedContent || currentSanitizedContent === lastSanitizedContent) {
      return
    }

    lastSanitizedContent = currentSanitizedContent

    // Clean up previously mounted components
    cleanupMountedComponents(mountedComponents)
    mountedComponents = []

    // Defer mounting to next tick to ensure DOM is ready
    setTimeout(() => {
      // Guard: Check container still exists and content hasn't changed
      if (!currentContainer || sanitizedContent !== currentSanitizedContent) {
        return
      }

      mountedComponents = mountPlaceholderComponents(currentContainer, {
        event,
        url,
        minimalQuote,
        depth,
        hideMediaAtDepth,
      })
    }, 0)

    // Cleanup on unmount
    return () => {
      cleanupMountedComponents(mountedComponents)
    }
  })
</script>

<div
  class="markdown max-w-full overflow-hidden"
  class:markdown--comment={variant === "comment"}
  bind:this={containerElement}
>
  {@html sanitizedContent}
</div>
