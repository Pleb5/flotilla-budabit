<script lang="ts">
  import ProfileLink from "@app/components/ProfileLink.svelte";

  type Props = {
    pubkey?: string;
    url?: string;
    class?: string;
    unstyled?: boolean;
    [key: string]: any;
  };

  const {
    pubkey,
    url,
    class: className = "",
    unstyled = true,
    ...restProps
  }: Props = $props();
</script>

{#if pubkey}
  <ProfileLink {pubkey} {url} class={className} {unstyled} {...restProps} />
{/if}
