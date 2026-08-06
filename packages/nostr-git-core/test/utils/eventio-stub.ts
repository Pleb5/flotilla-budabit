import type {EventIO} from "../../src/types/index.js"

export type PublishResult = {ok: boolean; relays?: string[]; error?: string}

type FetchRule = {
  matcher: (filters: any[]) => boolean
  events: any[]
}

export interface EventIOStub extends EventIO {
  __calls: {
    fetchEvents: Array<{filters: any[]; scope: {relays: string[]}}>
    publishEvent: Array<{event: any; scope: {relays: string[]}}>
  }
  __setFetchResult: (matcher: (filters: any[]) => boolean, events: any[]) => void
  __clearFetchRules: () => void
  __setPublishResult: (result: PublishResult) => void
}

export function createEventIOStub(initial?: {
  publishResult?: PublishResult
  fetchRules?: Array<{matcher: (filters: any[]) => boolean; events: any[]}>
}): EventIOStub {
  const calls = {
    fetchEvents: [] as Array<{filters: any[]; scope: {relays: string[]}}>,
    publishEvent: [] as Array<{event: any; scope: {relays: string[]}}>,
  }

  let publishResult: PublishResult = initial?.publishResult ?? {ok: true, relays: ["test-relay"]}
  const rules: FetchRule[] = []

  for (const r of initial?.fetchRules ?? []) {
    rules.push({matcher: r.matcher, events: r.events})
  }

  const stub: any = {
    __calls: calls,
    __setFetchResult(matcher: (filters: any[]) => boolean, events: any[]) {
      rules.push({matcher, events})
    },
    __clearFetchRules() {
      rules.length = 0
    },
    __setPublishResult(result: PublishResult) {
      publishResult = result
    },

    async fetchEvents(filters: any[], scope: {relays: string[]}) {
      calls.fetchEvents.push({filters, scope})
      for (const r of rules) {
        try {
          if (r.matcher(filters)) return r.events
        } catch {
          // ignore matcher errors, keep looking
        }
      }
      return []
    },

    async publishEvent(event: any, scope: {relays: string[]}) {
      calls.publishEvent.push({event, scope})
      return publishResult
    },

    async publishEvents(events: any[], scope: {relays: string[]}) {
      return await Promise.all(events.map(event => stub.publishEvent(event, scope)))
    },

    getCurrentPubkey() {
      return null
    },
  }

  return stub as EventIOStub
}
