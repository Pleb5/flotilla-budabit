import type { EventIO } from '../../src/types/index.js';

export type PublishResult = { ok: boolean; relays?: string[]; error?: string };

type FetchRule = {
  matcher: (filters: any[]) => boolean;
  events: any[];
};

export interface EventIOStub extends EventIO {
  __calls: {
    fetchEvents: any[][];
    publishEvent: any[];
  };
  __setFetchResult: (matcher: (filters: any[]) => boolean, events: any[]) => void;
  __clearFetchRules: () => void;
  __setPublishResult: (result: PublishResult) => void;
}

export function createEventIOStub(initial?: {
  publishResult?: PublishResult;
  fetchRules?: Array<{ matcher: (filters: any[]) => boolean; events: any[] }>;
}): EventIOStub {
  const calls = {
    fetchEvents: [] as any[][],
    publishEvent: [] as any[]
  };

  let publishResult: PublishResult = initial?.publishResult ?? { ok: true, relays: ['test-relay'] };
  const rules: FetchRule[] = [];

  for (const r of initial?.fetchRules ?? []) {
    rules.push({ matcher: r.matcher, events: r.events });
  }

  const stub: any = {
    __calls: calls,
    __setFetchResult(matcher: (filters: any[]) => boolean, events: any[]) {
      rules.push({ matcher, events });
    },
    __clearFetchRules() {
      rules.length = 0;
    },
    __setPublishResult(result: PublishResult) {
      publishResult = result;
    },

    async fetchEvents(filters: any[]) {
      calls.fetchEvents.push(filters);
      for (const r of rules) {
        try {
          if (r.matcher(filters)) return r.events;
        } catch {
          // ignore matcher errors, keep looking
        }
      }
      return [];
    },

    async publishEvent(event: any) {
      calls.publishEvent.push(event);
      return publishResult;
    }
  };

  return stub as EventIOStub;
}