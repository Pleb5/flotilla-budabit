<script lang="ts">
  import Profile from "@app/components/Profile.svelte";

  type Props = {
    pubkey?: string;
    url?: string;
    hideDetails?: boolean;
    showPubkey?: boolean;
    avatarSize?: number;
    title?: string;
    class?: string;
    style?: string;
    ref?: HTMLElement | null;
    [key: string]: any;
  };

  let {
    ref = $bindable(null),
    pubkey,
    url,
    hideDetails = false,
    showPubkey,
    avatarSize,
    title,
    class: className = "",
    style = "",
    ...restProps
  }: Props = $props();

  const parseAvatarSize = (classValue: string): number | undefined => {
    const match = classValue.match(/\bh-(\d+(?:\.\d+)?)\b/) ||
      classValue.match(/\bw-(\d+(?:\.\d+)?)\b/);
    return match ? parseFloat(match[1]) : undefined;
  };

  const resolvedAvatarSize = $derived.by(
    () => avatarSize ?? parseAvatarSize(className) ?? undefined,
  );
</script>

<div bind:this={ref} class={className} style={style} title={title} {...restProps}>
  {#if pubkey}
    <Profile
      {pubkey}
      {url}
      {hideDetails}
      {showPubkey}
      avatarSize={resolvedAvatarSize}
    />
  {/if}
</div>
