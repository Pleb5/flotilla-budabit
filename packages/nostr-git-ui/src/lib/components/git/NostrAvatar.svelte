<script lang="ts">
  import { User } from "@lucide/svelte";
  import { gravatarUrl } from "../../utils/hash";
  import { useRegistry } from "../../useRegistry";

  const { ProfileComponent } = useRegistry();

  type Size = number;

  interface Props {
    // Preferred explicit avatar URL
    avatarUrl?: string;
    // Nostr data
    pubkey?: string;
    relays?: string[];
    nip05?: string; // e.g. name@domain
    nip39?: string; // optional extended profile image URL or mapping
    // Fallbacks
    email?: string;
    displayName?: string;
    size?: Size; // pixel size (square). default 24
    class?: string;
    rounded?: boolean; // default true
    title?: string;
    responsive?: boolean; // enable responsive sizing for mobile/desktop
  }

  let {
    avatarUrl,
    pubkey,
    relays = [],
    nip05,
    nip39,
    email,
    displayName,
    size = 24,
    class: className = "",
    rounded = true,
    title = displayName || "",
    responsive = false,
  }: Props = $props();

  // Choose best source:
  // 1) pubkey -> delegate to app-provided ProfileComponent (handles Nostr profiles/cdn)
  // 2) explicit avatarUrl
  // 3) nip39 (if it's a direct URL)
  // 4) nip05/email -> gravatar identicon
  // 5) fallback icon/initials
  const pix: number = size ?? 24;
  const shape = rounded ? "rounded-full" : "rounded";

  // Calculate responsive sizes if responsive prop is true
  const mobileSize = $derived(responsive ? Math.max(16, Math.round(size * 0.6)) : size);
  const mobileSizePx = $derived(mobileSize);
  const desktopSizePx = $derived(size);

  // Responsive classes for Tailwind using CSS custom properties
  const responsiveClasses = $derived(
    responsive
      ? "!w-[var(--avatar-size-mobile)] !h-[var(--avatar-size-mobile)] !min-w-[var(--avatar-size-mobile)] sm:!w-[var(--avatar-size-desktop)] sm:!h-[var(--avatar-size-desktop)] sm:!min-w-[var(--avatar-size-desktop)]"
      : ""
  );

  // Responsive style with CSS custom properties
  const responsiveStyle = $derived(
    responsive
      ? `--avatar-size-mobile: ${mobileSizePx}px; --avatar-size-desktop: ${desktopSizePx}px;`
      : ""
  );

  // Inline size styles - only needed when not responsive (responsive uses Tailwind classes)
  const sizeStyle = $derived(
    responsive ? "" : `width: ${pix}px; height: ${pix}px; min-width: ${pix}px;`
  );

  function getNip39Url(): string | undefined {
    if (!nip39) return undefined;
    if (/^https?:\/\//i.test(nip39)) return nip39;
    return undefined;
  }

  function getGravatarFromNip05(): string | undefined {
    // Use the widest available stable identifier so we don't fall back to the same icon
    // Prefer: nip05 -> email -> displayName -> pubkey
    const id = (nip05 || email || displayName || pubkey || "").trim();
    if (!id) return undefined;
    return gravatarUrl(id, pix, "identicon");
  }
</script>

{#if pubkey}
  <!-- Let host app render a Nostr avatar (handles caching, cdn, etc.) -->
  <ProfileComponent
    pubkey={pubkey}
    relays={relays}
    class={`inline-block ${shape} overflow-hidden ${className}`}
    hideDetails={true}
    title={title}
  />
{:else if avatarUrl}
  <img
    src={avatarUrl}
    alt={displayName || "avatar"}
    width={responsive ? undefined : pix}
    height={responsive ? undefined : pix}
    class={`inline-block ${shape} object-cover ${className} ${responsiveClasses}`}
    style={responsiveStyle}
    title={title}
    decoding="async"
    loading="lazy"
  />
{:else if getNip39Url()}
  <img
    src={getNip39Url()}
    alt={displayName || "avatar"}
    width={responsive ? undefined : pix}
    height={responsive ? undefined : pix}
    class={`inline-block ${shape} object-cover ${className} ${responsiveClasses}`}
    style={responsiveStyle}
    title={title}
    decoding="async"
    loading="lazy"
  />
{:else if getGravatarFromNip05()}
  <img
    src={getGravatarFromNip05()}
    alt={displayName || "avatar"}
    width={responsive ? undefined : pix}
    height={responsive ? undefined : pix}
    class={`inline-block ${shape} object-cover ${className} ${responsiveClasses}`}
    style={responsiveStyle}
    title={title}
    decoding="async"
    loading="lazy"
  />
{:else}
  <div
    class={`inline-flex items-center justify-center bg-muted text-muted-foreground ${shape} ${className} ${responsiveClasses}`}
    style={`${sizeStyle} ${responsiveStyle}`}
    title={title}
    aria-label="avatar"
  >
    <User class="h-3.5 w-3.5" />
  </div>
{/if}
