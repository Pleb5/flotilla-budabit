import { describe, it, expect } from 'vitest';
import { getTag, getTags, getTagValue, addTag, setTag, removeTag } from '../../src/events/nip34/nip34-utils.js';

describe('NIP-34 tag helpers (getTag/getTags/getTagValue)', () => {
  it('getTag returns first matching tag, getTags returns all, getTagValue returns first value', () => {
    const evt: any = {
      tags: [
        ['a', '30617:pk:repo'],
        ['t', 'one'],
        ['t', 'two'],
        ['clone', 'u1', 'u2']
      ]
    };

    expect(getTag(evt, 'a')).toEqual(['a', '30617:pk:repo']);
    expect(getTagValue(evt, 'a')).toBe('30617:pk:repo');

    expect(getTag(evt, 't')).toEqual(['t', 'one']);
    expect(getTags(evt, 't')).toEqual([['t', 'one'], ['t', 'two']]);

    const clone = getTag(evt, 'clone') as any;
    expect(clone).toEqual(['clone', 'u1', 'u2']);
    expect(clone.slice(1)).toEqual(['u1', 'u2']);

    expect(getTagValue(evt, 'does-not-exist' as any)).toBeUndefined();
  });

  it('helpers work after JSON serialize/parse roundtrip', () => {
    const original: any = {
      tags: [
        ['a', '30617:pk:repo'],
        ['t', 'one'],
        ['t', 'two'],
        ['clone', 'u1', 'u2']
      ]
    };

    const roundtripped: any = JSON.parse(JSON.stringify(original));

    expect(roundtripped).not.toBe(original);
    expect(roundtripped.tags).not.toBe(original.tags);

    expect(getTagValue(roundtripped, 'a')).toBe('30617:pk:repo');
    expect(getTags(roundtripped, 't').map((t: any) => t[1]).sort()).toEqual(['one', 'two']);
    expect((getTag(roundtripped, 'clone') as any).slice(1)).toEqual(['u1', 'u2']);
  });
});

describe('NIP-34 tag mutation utilities (immutable)', () => {
  it('addTag adds without removing existing tags and does not mutate original', () => {
    const original: any = { tags: [['t', 'one']] };
    const out = addTag(original, ['t', 'two']);

    expect(original.tags).toEqual([['t', 'one']]); // unchanged
    expect(out.tags).toEqual([['t', 'one'], ['t', 'two']]);
  });

  it('mutation helpers remain immutable across JSON roundtrip and return new tags arrays', () => {
    const original: any = { tags: [['t', 'one'], ['a', 'x']] };
    const roundtripped: any = JSON.parse(JSON.stringify(original));

    const added = addTag(roundtripped, ['t', 'two']);
    expect(roundtripped.tags).toEqual([['t', 'one'], ['a', 'x']]); // unchanged
    expect(added.tags).toEqual([['t', 'one'], ['a', 'x'], ['t', 'two']]);
    expect(added.tags).not.toBe(roundtripped.tags);

    const set = setTag(roundtripped, ['t', 'final']);
    expect(roundtripped.tags).toEqual([['t', 'one'], ['a', 'x']]); // unchanged
    expect(set.tags).toEqual([['a', 'x'], ['t', 'final']]);
    expect(set.tags).not.toBe(roundtripped.tags);

    const removed = removeTag(roundtripped, 't');
    expect(roundtripped.tags).toEqual([['t', 'one'], ['a', 'x']]); // unchanged
    expect(removed.tags).toEqual([['a', 'x']]);
    expect(removed.tags).not.toBe(roundtripped.tags);
  });

  it('setTag replaces all tags of same type and does not mutate original', () => {
    const original: any = { tags: [['t', 'one'], ['t', 'two'], ['a', 'x']] };
    const out = setTag(original, ['t', 'final']);

    expect(original.tags).toEqual([['t', 'one'], ['t', 'two'], ['a', 'x']]); // unchanged
    expect(out.tags).toEqual([['a', 'x'], ['t', 'final']]);
  });

  it('removeTag removes all tags of a given type and does not mutate original', () => {
    const original: any = { tags: [['t', 'one'], ['t', 'two'], ['a', 'x']] };
    const out = removeTag(original, 't');

    expect(original.tags).toEqual([['t', 'one'], ['t', 'two'], ['a', 'x']]); // unchanged
    expect(out.tags).toEqual([['a', 'x']]);
  });
});