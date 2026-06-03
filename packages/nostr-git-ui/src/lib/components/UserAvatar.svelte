<script lang="ts">
  import { useRegistry } from "../useRegistry";
  const { Avatar, AvatarImage, AvatarFallback } = useRegistry();
  
  interface Props {
    profile?: {
      name?: string;
      picture?: string;
      display_name?: string;
      nip05?: string;
    } | null;
    pubkey?: string;
    size?: "sm" | "md" | "lg";
    class?: string;
  }
  
  const { profile, pubkey, size = "md", class: className = "" }: Props = $props();
  
  const sizeClasses = {
    sm: "size-6",
    md: "size-8",
    lg: "size-10"
  };
  
  const displayName = $derived(profile?.display_name || profile?.name || pubkey?.slice(0, 8) || "Unknown");
  const fallbackText = $derived((profile?.display_name || profile?.name || "U").slice(0, 2).toUpperCase());
  const avatarUrl = $derived(
    profile?.picture || 
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`
  );
</script>

<Avatar class="{sizeClasses[size]} border bg-muted text-muted-foreground {className}">
  <AvatarImage src={avatarUrl} alt={displayName} />
  <AvatarFallback>{fallbackText}</AvatarFallback>
</Avatar>
