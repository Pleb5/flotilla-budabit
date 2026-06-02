<script lang="ts">
  import {ProfileModel} from 'applesauce-core/models'
  import type {ProfileContent} from 'applesauce-core/helpers/profile'
  import {eventStore} from '../nostr'

  interface Props {
    pubkey: string
    size?: 'sm' | 'md'
    showName?: boolean
    link?: boolean
    class?: string
  }

  const {
    pubkey,
    size = 'sm',
    showName = true,
    link = true,
    class: className = '',
  }: Props = $props()

  let profile = $state<ProfileContent | undefined>(undefined)

  $effect(() => {
    profile = undefined
    if (!pubkey) return
    const sub = eventStore.model(ProfileModel, pubkey).subscribe(next => {
      profile = next
    })
    return () => sub.unsubscribe()
  })

  const sizeClass = $derived(size === 'md' ? 'h-6 w-6' : 'h-4 w-4')
  const name = $derived(
    profile?.display_name ||
      profile?.name ||
      (pubkey ? `${pubkey.slice(0, 8)}…` : 'unknown'),
  )
  const picture = $derived(profile?.picture)
  const initial = $derived(name.charAt(0).toUpperCase() || '?')
</script>

{#snippet body()}
  {#if picture}
    <img
      src={picture}
      alt=""
      referrerpolicy="no-referrer"
      class={`${sizeClass} shrink-0 rounded-full object-cover`}
    />
  {:else}
    <span
      class={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-muted text-[0.6rem] font-medium uppercase text-muted-foreground`}
    >
      {initial}
    </span>
  {/if}
  {#if showName}
    <span class="truncate">{name}</span>
  {/if}
{/snippet}

{#if link && pubkey}
  <a
    class={`inline-flex min-w-0 items-center gap-1.5 hover:underline ${className}`}
    href={`nostr:${pubkey}`}
    target="_blank"
    rel="noreferrer"
    title={name}
    onclick={event => event.stopPropagation()}>
    {@render body()}
  </a>
{:else}
  <span class={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
    {@render body()}
  </span>
{/if}
