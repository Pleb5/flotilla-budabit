import type { Readable } from "svelte/store";

export interface ProfileSearchContext {
  communityPubkey?: string;
}

export type ProfileSearchUpdateSignal = Readable<unknown>;
