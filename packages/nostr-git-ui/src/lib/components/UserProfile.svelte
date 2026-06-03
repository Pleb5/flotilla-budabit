<script lang="ts">
  import UserAvatar from "./UserAvatar.svelte";
  import { Users } from "@lucide/svelte";
  
  interface Props {
    profile?: {
      name?: string;
      picture?: string;
      display_name?: string;
      nip05?: string;
    } | null;
    pubkey?: string;
    size?: "sm" | "md" | "lg";
    showNip05?: boolean;
    class?: string;
  }
  
  const { profile, pubkey, size = "md", showNip05 = true, class: className = "" }: Props = $props();
  
  const displayName = $derived(profile?.display_name || profile?.name || pubkey?.slice(0, 8) || "Unknown");
</script>

<div class="flex items-center space-x-2 {className}">
  {#if profile?.picture || pubkey}
    <UserAvatar {profile} {pubkey} {size} />
  {:else}
    <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
      <Users class="w-4 h-4 text-gray-400" />
    </div>
  {/if}
  <div class="flex-1 min-w-0">
    <div class="text-sm font-medium text-white truncate">
      {displayName}
    </div>
    {#if showNip05 && profile?.nip05}
      <div class="text-xs text-gray-400 truncate">{profile.nip05}</div>
    {:else if pubkey}
      <div class="text-xs text-gray-500 font-mono truncate">{pubkey.slice(0, 16)}...</div>
    {/if}
  </div>
</div>
