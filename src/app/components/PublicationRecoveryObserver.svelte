<script lang="ts">
  import {onDestroy} from "svelte"
  import PublicationRecoveryToast from "@app/components/PublicationRecoveryToast.svelte"
  import RelayDeliveryNotice from "@app/components/RelayDeliveryNotice.svelte"
  import {relayDeliveryNotices} from "@app/core/relay-publish-delivery"
  import {publicationOperations} from "@app/core/publication-operations"
  import {popToast, pushToast, toast} from "@app/util/toast"

  const emittedAttempts = new Map<string, number>()
  const toastIds = new Map<string, string>()
  const deliveryToastIds = new Map<string, string>()

  $effect(() => {
    const notices = $relayDeliveryNotices
    for (const [eventId, toastId] of deliveryToastIds) {
      if (!notices.has(eventId)) {
        popToast(toastId)
        deliveryToastIds.delete(eventId)
      }
    }
    for (const eventId of notices.keys()) {
      if (deliveryToastIds.has(eventId)) continue
      deliveryToastIds.set(
        eventId,
        pushToast({
          timeout: 0,
          children: {component: RelayDeliveryNotice, props: {eventId}},
        }),
      )
    }
  })

  $effect(() => {
    const operations = $publicationOperations
    const visibleToastIds = new Set($toast.map(item => item.id))

    for (const operationId of emittedAttempts.keys()) {
      if (!operations.has(operationId)) {
        const toastId = toastIds.get(operationId)
        if (toastId) popToast(toastId)
        emittedAttempts.delete(operationId)
        toastIds.delete(operationId)
      }
    }

    for (const operation of operations.values()) {
      if (operation.phase !== "unconfirmed") continue
      if ((emittedAttempts.get(operation.operationId) || 0) >= operation.attempt) continue

      emittedAttempts.set(operation.operationId, operation.attempt)
      const existingToastId = toastIds.get(operation.operationId)
      if (existingToastId && visibleToastIds.has(existingToastId)) continue

      toastIds.set(
        operation.operationId,
        pushToast({
          timeout: 0,
          children: {
            component: PublicationRecoveryToast,
            props: {operationId: operation.operationId},
          },
        }),
      )
    }
  })

  onDestroy(() => {
    for (const toastId of deliveryToastIds.values()) popToast(toastId)
    deliveryToastIds.clear()
    for (const toastId of toastIds.values()) popToast(toastId)
    toastIds.clear()
    emittedAttempts.clear()
  })
</script>
