<script lang="ts">
  import {onDestroy, tick, untrack} from "svelte"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
  import {registerForegroundDeletions} from "@app/core/foreground-deletions"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

  const {
    scope,
    relays,
    targets = [],
    filters = [],
    sourcePlans = [],
    ready = true,
  }: {
    scope: string
    relays: string[]
    targets?: TrustedEvent[]
    filters?: Filter[]
    sourcePlans?: {relays: string[]; localFilters: Filter[]}[]
    ready?: boolean
  } = $props()

  const admissionKey = $derived(
    ready && scope && relays.length && (targets.length || filters.length)
      ? JSON.stringify([$pubkey, scope, $page.url.pathname, $page.url.search])
      : "",
  )
  let paintedKey = $state("")
  let registration: ReturnType<typeof registerForegroundDeletions> | undefined
  const hinted = new Map<string, ReturnType<typeof registerForegroundDeletions>>()
  $effect(() => {
    const key = admissionKey
    paintedKey = ""
    if (!key) return
    let cancelled = false
    void (async () => {
      await tick()
      if (typeof requestAnimationFrame === "function") {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      // Content can become ready long after mount. Both storage and network
      // admission must follow that content's paint, including route reuse.
      if (!cancelled) paintedKey = key
    })()
    return () => {
      cancelled = true
    }
  })
  $effect(() => {
    const demand = {
      scope: `${$pubkey || ""}:${scope}`,
      navigation: $page.url.pathname + $page.url.search,
      relays,
      targets,
      filters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
    }
    const enabled = Boolean(admissionKey && paintedKey === admissionKey)
    const plans = sourcePlans.map(plan => ({
      ...demand,
      relays: plan.relays,
      filters: [],
      targets: targets.filter(event => matchFilters(plan.localFilters, event)),
    }))
    untrack(() => {
      if (!enabled) {
        registration?.release()
        registration = undefined
        hinted.forEach(value => value.release())
        hinted.clear()
        return
      }
      if (registration) registration.update(demand)
      else registration = registerForegroundDeletions(demand)
      const wanted = new Set<string>()
      for (const plan of plans) {
        if (!plan.targets.length) continue
        const key = JSON.stringify([plan.relays, plan.targets.map(event => event.id)])
        wanted.add(key)
        if (hinted.has(key)) hinted.get(key)!.update(plan)
        else hinted.set(key, registerForegroundDeletions(plan))
      }
      for (const [key, value] of hinted)
        if (!wanted.has(key)) {
          value.release()
          hinted.delete(key)
        }
    })
  })
  onDestroy(() => {
    registration?.release()
    hinted.forEach(value => value.release())
  })
</script>
