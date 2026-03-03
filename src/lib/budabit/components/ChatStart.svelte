<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {onMount} from "svelte"
  import {writable} from "svelte/store"
  import {goto} from "$app/navigation"
  import {tryCatch} from "@welshman/lib"
  import {fromNostrURI} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ProfileSingleSelect from "@lib/budabit/components/ProfileSingleSelect.svelte"
  import {makeChatPath} from "@app/util/routes"

  const back = () => history.back()

  const onSubmit = () => {
    if (!recipient) return
    goto(makeChatPath([recipient, $pubkey!]))
  }

  const addPubkey = (value: string) => {
    recipient = value
    term.set("")
  }

  const term = writable("")

  let recipient: string = $state("")

  onMount(() => {
    return term.subscribe(t => {
      if (!t || recipient) return

      if (t.match(/^[0-9a-f]{64}$/)) {
        addPubkey(t)
      }

      if (t.match(/^(nostr:)?(npub1|nprofile1)/)) {
        tryCatch(() => {
          const {type, data} = nip19.decode(fromNostrURI(t))

          if (type === "npub") {
            addPubkey(data)
          }

          if (type === "nprofile") {
            addPubkey(data.pubkey)
          }
        })
      }
    })
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(onSubmit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Start a Chat</div>
    {/snippet}
    {#snippet info()}
      <div>Direct messages are one-on-one only.</div>
    {/snippet}
  </ModalHeader>
  <Field>
    {#snippet input()}
      <ProfileSingleSelect autofocus bind:value={recipient} {term} />
    {/snippet}
  </Field>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={!recipient}>
      Start Chat
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
