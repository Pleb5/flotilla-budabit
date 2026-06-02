export const nip05 = {
  queryProfile: async (_identifier: string) => null,
}
export const nip19 = {
  npubEncode: (hex: string) => `npub1${hex.slice(0, 10)}`,
  naddrEncode: ({ kind, pubkey, identifier, relays }: any) =>
    `naddr1-${kind}-${pubkey.slice(0, 8)}-${identifier ?? ''}-${(relays ?? []).length}`,
  decode: (s: string) => {
    if (s.startsWith('npub1')) return { type: 'npub', data: s.slice(5) }
    if (s.startsWith('naddr1-')) return { type: 'naddr', data: { pubkey: '0'.repeat(64), identifier: 'id' } }
    return { type: 'unknown', data: s }
  },
}
