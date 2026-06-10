import { describe, it, expect } from 'vitest';
import {
  resolveStatus,
  resolveStatusState,
  statusKindToState,
  type LocalStatusEvent,
} from '../src/events/nip34/status-resolver.js';

function makeStatus(
  id: string,
  kind: number,
  pubkey: string,
  created_at: number,
  tags: string[][] = []
): LocalStatusEvent {
  const e = {
    id,
    kind,
    pubkey,
    created_at,
    content: '',
    tags,
    sig: ''
  } as unknown as LocalStatusEvent;
  return e;
}

describe('resolveStatus', () => {
  it('uses latest authorized status across root author, maintainers, and repo owner', () => {
    const rootAuthor = 'root-pub';
    const maintainers = new Set<string>(['maintainer-pub']);

    const events: LocalStatusEvent[] = [
      makeStatus('s1', 1630, 'other-pub', 1000), // open by other
      makeStatus('s2', 1631, 'root-pub', 1100), // applied by root
      makeStatus('s3', 1630, 'maintainer-pub', 900), // open by maintainer older
      makeStatus('s4', 1632, 'other-pub', 1200), // closed by other ignored
      makeStatus('s5', 1631, 'maintainer-pub', 800), // applied by maintainer oldest
      makeStatus('s6', 1630, 'root-pub', 1300) // latest authorized wins, even lower kind
    ];

    const { final, reason } = resolveStatus({ statuses: events, rootAuthor, maintainers, repoOwner: 'owner-pub' });

    expect(final?.id).toBe('s6');
    expect(reason).toMatch(/latest authorized status/);
  });

  it('accepts repo owner status even when owner is not a maintainer', () => {
    const events: LocalStatusEvent[] = [
      makeStatus('s1', 1632, 'owner-pub', 1000),
      makeStatus('s2', 1630, 'other-pub', 1100)
    ];
    const { final } = resolveStatus({
      statuses: events,
      rootAuthor: 'root',
      maintainers: new Set(),
      repoOwner: 'owner-pub'
    });
    expect(final?.id).toBe('s1');
  });

  it('uses recency among authorized statuses', () => {
    const rootAuthor = 'root';
    const maintainers = new Set<string>([]);
    const events: LocalStatusEvent[] = [
      makeStatus('s1', 1630, 'root', 1000),
      makeStatus('s2', 1630, 'root', 2000)
    ];
    const { final } = resolveStatus({ statuses: events, rootAuthor, maintainers });
    expect(final?.id).toBe('s2');
  });

  it('uses status id as a deterministic tie-break for equal timestamps', () => {
    const events: LocalStatusEvent[] = [
      makeStatus('a', 1630, 'root', 1000),
      makeStatus('b', 1632, 'root', 1000)
    ];
    const { final } = resolveStatus({ statuses: events, rootAuthor: 'root', maintainers: new Set() });
    expect(final?.id).toBe('b');
  });

  it('ignores non-status kinds', () => {
    const rootAuthor = 'r';
    const maintainers = new Set<string>();
    const events: LocalStatusEvent[] = [makeStatus('x', 1, 'r', 1)];
    const { final, reason } = resolveStatus({ statuses: events, rootAuthor, maintainers });
    expect(final).toBeUndefined();
    expect(reason).toBe('no-authorized-status-events');
  });

  it('accepts imported status baselines for imported roots but not synthetic root author authority', () => {
    const events: LocalStatusEvent[] = [
      makeStatus('s1', 1631, 'synthetic-author', 1000),
      makeStatus('s2', 1632, 'imported-closer', 1100, [['imported', '']]),
      makeStatus('s3', 1630, 'maintainer-pub', 1200)
    ];
    const { final } = resolveStatus({
      statuses: events,
      rootAuthor: 'synthetic-author',
      maintainers: new Set(['maintainer-pub']),
      importedRoot: true,
    });
    expect(final?.id).toBe('s3');
  });

  it('maps status kinds to effective states with open fallback', () => {
    expect(statusKindToState(1630)).toBe('open');
    expect(statusKindToState(1631)).toBe('applied');
    expect(statusKindToState(1632)).toBe('closed');
    expect(statusKindToState(1633)).toBe('draft');
    expect(statusKindToState(1)).toBe('open');
    expect(statusKindToState(undefined)).toBe('open');
  });

  it('resolves missing authorized status as effective open', () => {
    const resolved = resolveStatusState({
      statuses: [],
      rootAuthor: 'root',
      maintainers: new Set(),
    });
    expect(resolved.final).toBeUndefined();
    expect(resolved.state).toBe('open');
    expect(resolved.reason).toBe('no-authorized-status-events');
  });

  it('resolves unauthorized statuses as effective open', () => {
    const resolved = resolveStatusState({
      statuses: [makeStatus('closed-by-other', 1632, 'other', 1000)],
      rootAuthor: 'root',
      maintainers: new Set(),
    });
    expect(resolved.final).toBeUndefined();
    expect(resolved.state).toBe('open');
  });
});
