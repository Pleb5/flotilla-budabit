<script lang="ts">
  import {writable} from "svelte/store"
  import type {Writable} from "svelte/store"
  import type {Instance} from "tippy.js"
  import {profileSearch} from "@welshman/app"
  import Suggestions from "@lib/components/Suggestions.svelte"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileSuggestion from "@app/editor/ProfileSuggestion.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"

  interface Props {
    value: string
    autofocus?: boolean
    term?: Writable<string>
  }

  let {value = $bindable(), term = writable(""), autofocus = false}: Props = $props()

  const search = (term: string) => $profileSearch.searchValues(term)

  const selectPubkey = (pubkey: string) => {
    term.set("")
    popover?.hide()
    value = pubkey
  }

  const clearSelection = () => {
    value = ""
    term.set("")
  }

  const onKeyDown = (e: Event) => {
    if (instance.onKeyDown(e)) {
      e.preventDefault()
    }
  }

  const inputDisabled = $derived(Boolean(value))

  let input: Element | undefined = $state()
  let popover: Instance | undefined = $state()
  let instance: any = $state()

  $effect(() => {
    // @ts-ignore
    oninput?.($term)

    if ($term && !inputDisabled) {
      popover?.show()
    } else {
      popover?.hide()
    }
  })
</script>

<div class="flex flex-col gap-2">
  <div>
    {#if value}
      {@const onClick = () => pushModal(ProfileDetail, {pubkey: value})}
      <div class="flex-inline badge badge-neutral mr-1 gap-1">
        <Button class="flex items-center" onclick={clearSelection}>
          <Icon icon={CloseCircle} size={4} class="-ml-1 mt-px" />
        </Button>
        <Button onclick={onClick}>
          <ProfileName pubkey={value} />
        </Button>
      </div>
    {/if}
  </div>
  <label class="input input-bordered flex w-full items-center gap-2" bind:this={input}>
    <Icon icon={Magnifier} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      {autofocus}
      class="grow"
      type="text"
      placeholder={inputDisabled ? "Recipient selected" : "Search for profiles..."}
      bind:value={$term}
      disabled={inputDisabled}
      onkeydown={onKeyDown} />
  </label>
  <Tippy
    bind:popover
    bind:instance
    component={Suggestions}
    props={{
      term,
      search,
      select: selectPubkey,
      component: ProfileSuggestion,
      class: "rounded-box",
      style: `left: 4px; width: ${input?.clientWidth + 12}px`,
    }}
    params={{
      trigger: "manual",
      interactive: true,
      maxWidth: "none",
      getReferenceClientRect: () => input!.getBoundingClientRect(),
    }} />
</div>
