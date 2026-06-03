import type { NostrEvent } from "nostr-tools";
import { writable, type Writable } from "svelte/store";

export interface Signer {
  sign(event: NostrEvent): Promise<NostrEvent>;
  getPubkey(): Promise<string>;
  nip04: {
    encrypt(pubkey: string, data: string): Promise<string>;
    decrypt(pubkey: string, data: string): Promise<string>;
  };
  nip44: {
    encrypt(pubkey: string, data: string): Promise<string>;
    decrypt(pubkey: string, data: string): Promise<string>;
  };
}

export function createSigner(): Writable<Signer> {
  const { subscribe, update, set } = writable<Signer>({
    sign: async (event: NostrEvent) => event,
    getPubkey: async () => Promise.resolve(""),
    nip04: {
      encrypt: async (pubkey: string, data: string) => Promise.resolve(""),
      decrypt: async (pubkey: string, data: string) => Promise.resolve(""),
    },
    nip44: {
      encrypt: async (pubkey: string, data: string) => Promise.resolve(""),
      decrypt: async (pubkey: string, data: string) => Promise.resolve(""),
    },
  });

  return {
    subscribe,
    update,
    set,
  };
}

export const signer = createSigner();
export const pubkey = writable<string>("");
