<script lang="ts">
  import { tokens, type Token } from "../../stores/tokens.js";
  import { Key, Shield, AlertCircle, CheckCircle, RefreshCw } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { useRegistry } from "../../useRegistry.js";
  import { Repo } from "./Repo.svelte";
  const { Badge, Button } = useRegistry();

  interface Props {
    repository: Repo;
    pubkey: string;
  }

  const { repository, pubkey }: Props = $props();

  // Get tokens from store
  let tokenList: Token[] = $state([]);
  tokens.subscribe((t: Token[]) => (tokenList = t));

  // Loading state for refresh operations
  let isRefreshing = $state(false);

  // Refresh tokens manually
  async function refreshTokens() {
    isRefreshing = true;
    try {
      await tokens.refresh();
    } catch (error) {
      console.error("Failed to refresh tokens:", error);
    } finally {
      isRefreshing = false;
    }
  }

  onMount(async () => {
    // Tokens are initialized at app level - just wait if needed
    try {
      await tokens.waitForInitialization();
    } catch (error) {
      console.warn("Failed to load tokens in AuthStatusIndicator:", error);
    }
  });

  // Extract hosts from clone URLs
  const repoHosts = $derived.by(() => {
    const hosts = new Set<string>();

    // Extract from clone URLs
    repository.clone?.forEach((url: string) => {
      try {
        const urlObj = new URL(url);
        hosts.add(urlObj.hostname);
      } catch (e) {
        // Skip invalid URLs
      }
    });

    // Extract from web URLs
    repository.web.forEach((url) => {
      try {
        const urlObj = new URL(url);
        hosts.add(urlObj.hostname);
      } catch (e) {
        // Skip invalid URLs
      }
    });

    return Array.from(hosts);
  });

  // Check if we have tokens for this repo's hosts
  const hasTokensForRepo = $derived.by(() =>
    tokenList.some((token) => repoHosts.includes(token.host))
  );

  // Get matching tokens for this repo
  const matchingTokens = $derived.by(() =>
    tokenList.filter((token) => repoHosts.includes(token.host))
  );

  const isOwner = $derived.by(() => {
    const userPubkey = pubkey;
    if (!userPubkey || !repository) return false;
    return repository.isAuthorized(userPubkey);
  });

  // Determine overall auth status
  const authStatus = $derived.by(() => {
    const userPubkey = pubkey;
    if (!userPubkey) {
      return {
        type: "no-user",
        icon: AlertCircle,
        color: "text-gray-600 dark:text-gray-300",
        bgColor: "bg-gray-100 dark:bg-gray-800",
        message: "Not logged in",
      };
    }

    if (isOwner && hasTokensForRepo) {
      return {
        type: "authorized",
        icon: CheckCircle,
        color: "text-green-700 dark:text-green-300",
        bgColor: "bg-green-100 dark:bg-green-900/40",
        message: "Authorized owner",
      };
    }

    if (isOwner && !hasTokensForRepo) {
      return {
        type: "owner-no-token",
        icon: Key,
        color: "text-orange-700 dark:text-orange-300",
        bgColor: "bg-orange-100 dark:bg-orange-900/40",
        message: "Owner - needs auth token",
      };
    }

    if (!isOwner && hasTokensForRepo) {
      return {
        type: "token-no-access",
        icon: Shield,
        color: "text-blue-700 dark:text-blue-300",
        bgColor: "bg-blue-100 dark:bg-blue-900/40",
        message: "Has token - not owner",
      };
    }

    return {
      type: "no-access",
      icon: AlertCircle,
      color: "text-gray-600 dark:text-gray-300",
      bgColor: "bg-gray-100 dark:bg-gray-800",
      message: "Read-only access",
    };
  });
</script>

<div class="flex items-center gap-2">
  <!-- Auth Status Badge -->
  <Badge variant="outline" class={`${authStatus.bgColor} ${authStatus.color} border-current`}>
    {@const IconComponent = authStatus.icon}
    <IconComponent class="h-3 w-3 mr-1" />
    {authStatus.message}
  </Badge>

  <!-- Token Count Indicator -->
  {#if tokenList.length > 0}
    <Badge variant="secondary" class="text-xs">
      <Key class="h-3 w-3 mr-1" />
      {matchingTokens.length}/{tokenList.length} tokens
    </Badge>
  {/if}

  <!-- Action Button for owners without tokens -->
  {#if authStatus.type === "owner-no-token"}
    <Button variant="outline" size="sm" class="text-xs">
      <Key class="h-3 w-3 mr-1" />
      Add Token
    </Button>
  {/if}
</div>
