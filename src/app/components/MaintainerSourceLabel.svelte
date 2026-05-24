<script lang="ts">
  import {nip19} from "nostr-tools"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import type {RepoValueSource} from "@app/core/git-state"

  type Props = {
    sources?: RepoValueSource[]
    url?: string
    align?: "left" | "right"
    class?: string
  }

  const {sources = [], url = undefined, align = "left", class: className = ""}: Props = $props()

  let open = $state(false)

  const normalizePubkey = (value: string | undefined | null) => {
    const raw = String(value || "").trim()
    if (!raw) return ""
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
    if (raw.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(raw)
        return decoded.type === "npub" && typeof decoded.data === "string" ? decoded.data : ""
      } catch {
        return ""
      }
    }
    return ""
  }

  const maintainerPubkeys = $derived.by(() => {
    const byPubkey = new Map<string, {pubkey: string; root: boolean; index: number}>()

    sources.forEach((source, index) => {
      const pubkey = normalizePubkey(source.maintainer)
      if (!pubkey) return

      const existing = byPubkey.get(pubkey)
      if (existing) {
        existing.root ||= source.root
      } else {
        byPubkey.set(pubkey, {pubkey, root: source.root, index})
      }
    })

    return Array.from(byPubkey.values())
      .sort((a, b) => Number(b.root) - Number(a.root) || a.index - b.index)
      .map(source => source.pubkey)
  })

  const close = () => {
    open = false
  }

  const openProfile = (event: Event, pubkey: string) => {
    event.preventDefault()
    event.stopPropagation()
    close()
    setTimeout(() => pushModal(ProfileDetail, {pubkey, url}))
  }
</script>

{#if maintainerPubkeys.length === 1}
  <ProfileLink
    pubkey={maintainerPubkeys[0]}
    {url}
    unstyled
    class={`inline-flex max-w-32 items-center truncate rounded border border-border px-1 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground hover:bg-secondary/50 ${className}`} />
{:else if maintainerPubkeys.length > 1}
  <span class="relative inline-flex">
    <button
      type="button"
      class={`rounded border border-border px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-secondary/50 ${className}`}
      aria-expanded={open}
      onclick={() => (open = !open)}>
      {maintainerPubkeys.length} maintainers
    </button>
    {#if open}
      <InlinePopover onClose={close} {align} widthClass="w-64">
        <div class="space-y-2 text-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Declared by repo announcement
          </p>
          <div class="space-y-1">
            {#each maintainerPubkeys as pubkey (pubkey)}
              <button
                type="button"
                class="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-secondary/50"
                onmousedown={event => event.stopPropagation()}
                onclick={event => openProfile(event, pubkey)}>
                @<ProfileName {pubkey} {url} />
              </button>
            {/each}
          </div>
        </div>
      </InlinePopover>
    {/if}
  </span>
{/if}
