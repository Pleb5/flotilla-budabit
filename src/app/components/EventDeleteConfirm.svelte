<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Confirm from "@lib/components/Confirm.svelte"
  import {publishSocialDelete, canEnforceNip70} from "@app/core/commands"
  import {clearModals} from "@app/util/modal"

  type Props = {
    url?: string
    event: TrustedEvent
    noun?: string
  }

  const {url, event, noun = "Message"}: Props = $props()

  const confirm = async () => {
    const protect = url ? await canEnforceNip70(url) : false

    await publishSocialDelete({url, event, protect})

    clearModals()
  }

  const lowerNoun = noun.toLowerCase()
</script>

<Confirm
  {confirm}
  title={`Delete ${noun}`}
  subtitle={`Are you sure you want to delete this ${lowerNoun}?`}
  message={`This will send a request to delete this ${lowerNoun}. Be aware that not all relays may honor this request.`} />
