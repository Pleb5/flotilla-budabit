import type { RepoCommunityBinding } from "@nostr-git/core/events";

export type RepoCommunityOption = {
  pubkey: string;
  label?: string;
  relay?: string;
  relays?: string[];
};

export const getRepoCommunityOptionLabel = (option: RepoCommunityOption): string =>
  option.label || `${option.pubkey.slice(0, 8)}...${option.pubkey.slice(-6)}`;

export const getRepoCommunityOptionBinding = (
  option: RepoCommunityOption | undefined
): RepoCommunityBinding | undefined => {
  if (!option?.pubkey) return undefined;
  const relay = option.relay || option.relays?.[0];

  return relay ? { pubkey: option.pubkey, relay } : { pubkey: option.pubkey };
};

export const findRepoCommunityOption = (
  options: RepoCommunityOption[],
  pubkey: string | undefined
): RepoCommunityOption | undefined =>
  options.find((option) => option.pubkey === pubkey);
