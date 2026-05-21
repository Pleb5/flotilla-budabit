<script lang="ts">
  import { cn } from "../../utils";
  import { filterValidCloneUrls } from "@nostr-git/core/utils";
  import { classifyCloneUrlIssue, getCloneUrlBannerTitle } from "../../utils/cloneUrlIssues";
  import { AlertTriangle, X } from "@lucide/svelte";
  import { Repo } from "./Repo.svelte";

  const {
    repoClass,
    activeTab = "overview",
    children,
    resolveCloneUrlIssues,
  }: {
    repoClass: Repo;
    activeTab?: string;
    children?: any;
    // Accepted for backward compatibility; this component no longer renders these actions.
    refreshRepo?: () => Promise<void>;
    forkRepo?: () => void;
    overviewRepo?: () => void;
    isRefreshing?: boolean;
    settingsRepo?: () => void;
    bookmarkRepo?: () => void | Promise<void>;
    isBookmarked?: boolean;
    isTogglingBookmark?: boolean;
    watchRepo?: () => void | Promise<void>;
    isWatching?: boolean;
    canEditSettings?: boolean;
    updateRepoState?: () => void | Promise<void>;
    hasRepoStateUpdate?: boolean;
    isCheckingRepoStateUpdate?: boolean;
    resolveCloneUrlIssues?: () => void;
  } = $props();

  const normalizeUrl = (url: string): string => {
    const raw = String(url || "").trim();
    if (!raw) return "";

    const stripGit = (value: string) => value.replace(/\.git$/i, "");
    try {
      const parsed = new URL(raw);
      return `${parsed.hostname.toLowerCase()}${stripGit(parsed.pathname.replace(/\/+$/, "").toLowerCase())}`;
    } catch {
      return stripGit(
        raw
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "")
          .toLowerCase()
      );
    }
  };

  const getRepoTabsScrollKey = () => {
    if (typeof window === "undefined") return "";

    const match = window.location.pathname.match(/(\/c\/[^/]+\/git\/[^/]+)/);
    return `repo-tabs-scroll:${match?.[1] || window.location.pathname}`;
  };

  const readTabsScroll = (key: string) => {
    if (!key || typeof window === "undefined") return 0;

    try {
      const value = Number(window.sessionStorage.getItem(key) || "0");
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };

  const writeTabsScroll = (key: string, value: number) => {
    if (!key || typeof window === "undefined") return;

    try {
      window.sessionStorage.setItem(key, String(value));
    } catch {
      // pass
    }
  };

  function persistTabsScroll(node: HTMLElement) {
    if (typeof window === "undefined") {
      return { destroy: () => {} };
    }

    const key = getRepoTabsScrollKey();
    let raf = 0;
    let timeout = 0;

    const restore = () => {
      const storedScrollLeft = readTabsScroll(key);

      if (Math.abs(node.scrollLeft - storedScrollLeft) > 1) {
        node.scrollLeft = storedScrollLeft;
      }
    };

    const persist = () => writeTabsScroll(key, node.scrollLeft);

    raf = window.requestAnimationFrame(restore);
    timeout = window.setTimeout(restore, 0);

    node.addEventListener("scroll", persist, { passive: true });
    node.addEventListener("pointerdown", persist, true);
    node.addEventListener("click", persist, true);

    return {
      destroy: () => {
        window.cancelAnimationFrame(raf);
        window.clearTimeout(timeout);
        node.removeEventListener("scroll", persist);
        node.removeEventListener("pointerdown", persist, true);
        node.removeEventListener("click", persist, true);
      },
    };
  }

  const primaryCloneUrl = $derived.by(() =>
    normalizeUrl(filterValidCloneUrls(repoClass.cloneUrls || [])[0] || "")
  );

  const cloneUrlErrors = $derived.by(() => {
    const errors = repoClass.cloneUrlErrors || [];
    return errors.filter((error) => {
      const status = Number(error?.status || 0);
      if (status >= 400) return true;
      const text = String(error?.error || "").toLowerCase();
      return (
        text.includes("timeout") ||
        text.includes("failed to fetch") ||
        text.includes("network") ||
        text.includes("cors") ||
        text.includes("not found") ||
        text.includes("authentication required") ||
        text.includes("bad credentials") ||
        text.includes("no tokens found") ||
        text.includes("forbidden") ||
        text.includes("unauthorized") ||
        text.includes("rate limit")
      );
    });
  });

  const primaryCloneErrors = $derived.by(() => {
    if (!primaryCloneUrl) return [] as Array<{ url: string; error: string; status?: number }>;
    return cloneUrlErrors.filter((error) => normalizeUrl(error.url) === primaryCloneUrl);
  });

  const displayCloneUrlErrors = $derived.by(() =>
    (primaryCloneErrors.length > 0 ? primaryCloneErrors : cloneUrlErrors).slice(0, 4)
  );

  const cloneUrlBannerTitle = $derived.by(() =>
    getCloneUrlBannerTitle({
      hasPrimaryIssue: primaryCloneErrors.length > 0,
      issueCount: primaryCloneErrors.length > 0 ? primaryCloneErrors.length : cloneUrlErrors.length,
    })
  );

  const hasCloneUrlErrors = $derived.by(() => cloneUrlErrors.length > 0);

  // Dismiss errors
  function dismissErrors() {
    repoClass.clearCloneUrlErrors();
  }

  // Format error message for display
  function formatError(error: { url: string; error: string; status?: number }): string {
    const urlShort = error.url.replace(/^https?:\/\//, "").replace(/\.git$/, "");
    const issue = classifyCloneUrlIssue(error.error, error.status);
    return `${issue.summary}: ${urlShort}`;
  }
</script>

{#if hasCloneUrlErrors}
  <div class="mb-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-2 min-w-0">
        <AlertTriangle class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-amber-700 dark:text-amber-300">{cloneUrlBannerTitle}</p>
          <ul class="mt-1 text-sm text-muted-foreground space-y-1">
            {#each displayCloneUrlErrors as error}
              <li class="truncate" title={error.error}>{formatError(error)}</li>
            {/each}
          </ul>
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        {#if resolveCloneUrlIssues}
          <button
            onclick={resolveCloneUrlIssues}
            class="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            title="Review remote read issues"
          >
            Review
          </button>
        {/if}
        <button
          onclick={dismissErrors}
          class="text-muted-foreground hover:text-foreground p-1 rounded-sm hover:bg-muted"
          title="Dismiss"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
{/if}

<nav
  data-repo-tabs
  class={cn(
    "sticky top-0 z-10 w-full rounded-md bg-base-200/95 text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-base-200/80"
  )}
>
  <div use:persistTabsScroll data-repo-tabs-scroll class="flex overflow-x-auto scrollbar-hide">
    <div class="m-1 flex min-w-max gap-1">
      {@render children?.(activeTab)}
    </div>
  </div>
</nav>

<style>
  /* Ensure long commit messages don't break layout */
  .break-words {
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .repo-description :global(.markdown) {
    font-size: 0.875rem;
    line-height: 1.5;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  @media (min-width: 640px) {
    .repo-description :global(.markdown) {
      font-size: 1rem;
    }
  }
</style>
