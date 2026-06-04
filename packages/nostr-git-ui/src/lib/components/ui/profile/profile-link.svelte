<script lang="ts">
  type Props = {
    pubkey?: string;
    relays?: string[];
    [key: string]: any;
  };

  let { pubkey, relays: _relays = [], ...restProps }: Props = $props();
</script>

<div {...restProps}>
  {pubkey ? pubkey.substring(0, 9) : ""}
</div>
