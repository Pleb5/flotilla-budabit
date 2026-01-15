<script lang="ts">
  import {
    LayoutGrid,
    Puzzle,
    Box,
    Settings,
    Zap,
    MessageSquare,
    Music,
    Video,
    Image,
    FileText,
    Code,
    Terminal,
    Globe,
    Lock,
    Unlock,
    Bell,
    Star,
    Heart,
    Bookmark,
    Share,
    Download,
    Upload,
    Trash,
    Edit,
    Plus,
    Minus,
    Check,
    X,
    AlertCircle,
    Info,
    HelpCircle,
  } from "@lucide/svelte"

  type Props = {
    icon?: string
    class?: string
    size?: number
  }

  let {icon, class: className = "", size = 24}: Props = $props()

  // Check if icon is a URL (starts with http, https, or /)
  const isUrl = $derived(icon ? /^(https?:\/\/|\/|data:)/.test(icon) : false)

  // Convert kebab-case to PascalCase (e.g., "layout-grid" -> "LayoutGrid")
  // If already PascalCase, return as-is
  const toPascalCase = (str: string): string => {
    // If it contains hyphens or underscores, convert from kebab/snake case
    if (str.includes('-') || str.includes('_')) {
      return str
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join("")
    }
    // Otherwise assume it's already PascalCase
    return str
  }

  // Normalize icon name for matching
  const iconName = $derived(icon && !isUrl ? toPascalCase(icon) : null)
</script>

{#if icon}
  {#if isUrl}
    <img src={icon} alt="icon" class={className} style="width: {size}px; height: {size}px;" />
  {:else if iconName === "LayoutGrid"}
    <LayoutGrid class={className} {size} />
  {:else if iconName === "Puzzle"}
    <Puzzle class={className} {size} />
  {:else if iconName === "Box"}
    <Box class={className} {size} />
  {:else if iconName === "Settings"}
    <Settings class={className} {size} />
  {:else if iconName === "Zap"}
    <Zap class={className} {size} />
  {:else if iconName === "MessageSquare"}
    <MessageSquare class={className} {size} />
  {:else if iconName === "Music"}
    <Music class={className} {size} />
  {:else if iconName === "Video"}
    <Video class={className} {size} />
  {:else if iconName === "Image"}
    <Image class={className} {size} />
  {:else if iconName === "FileText"}
    <FileText class={className} {size} />
  {:else if iconName === "Code"}
    <Code class={className} {size} />
  {:else if iconName === "Terminal"}
    <Terminal class={className} {size} />
  {:else if iconName === "Globe"}
    <Globe class={className} {size} />
  {:else if iconName === "Lock"}
    <Lock class={className} {size} />
  {:else if iconName === "Unlock"}
    <Unlock class={className} {size} />
  {:else if iconName === "Bell"}
    <Bell class={className} {size} />
  {:else if iconName === "Star"}
    <Star class={className} {size} />
  {:else if iconName === "Heart"}
    <Heart class={className} {size} />
  {:else if iconName === "Bookmark"}
    <Bookmark class={className} {size} />
  {:else if iconName === "Share"}
    <Share class={className} {size} />
  {:else if iconName === "Download"}
    <Download class={className} {size} />
  {:else if iconName === "Upload"}
    <Upload class={className} {size} />
  {:else if iconName === "Trash"}
    <Trash class={className} {size} />
  {:else if iconName === "Edit"}
    <Edit class={className} {size} />
  {:else if iconName === "Plus"}
    <Plus class={className} {size} />
  {:else if iconName === "Minus"}
    <Minus class={className} {size} />
  {:else if iconName === "Check"}
    <Check class={className} {size} />
  {:else if iconName === "X"}
    <X class={className} {size} />
  {:else if iconName === "AlertCircle"}
    <AlertCircle class={className} {size} />
  {:else if iconName === "Info"}
    <Info class={className} {size} />
  {:else if iconName === "HelpCircle"}
    <HelpCircle class={className} {size} />
  {:else}
    <!-- Fallback: show a placeholder -->
    <Puzzle class={className} {size} />
  {/if}
{/if}
