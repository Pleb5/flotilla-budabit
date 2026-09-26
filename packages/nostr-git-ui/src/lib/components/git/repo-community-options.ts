import type { RepoCommunityBinding } from "@nostr-git/core/events";

export type RepoCommunityOption = {
  ownerPubkey: string;
  address: string;
  communityId: string;
  name?: string;
  about?: string;
  label?: string;
  relay?: string;
  relays?: string[];
  graspServers?: string[];
};

export const getRepoCommunityOptionKey = (option: RepoCommunityOption): string => option.address;

export const getRepoCommunityOptionLabel = (option: RepoCommunityOption): string => {
  if (option.name && option.about) return `${option.name} - ${option.about}`;
  return (
    option.name ||
    option.label ||
    `${option.communityId.slice(0, 8)}...${option.communityId.slice(-6)}`
  );
};

export const getRepoCommunityOptionBinding = (
  option: RepoCommunityOption | undefined
): RepoCommunityBinding | undefined => {
  if (!option?.communityId) return undefined;
  const relay = option.relay || option.relays?.[0];

  return relay
    ? { address: option.address, communityId: option.communityId, relay }
    : { address: option.address, communityId: option.communityId };
};

export const findRepoCommunityOption = (
  options: RepoCommunityOption[],
  key: string | undefined
): RepoCommunityOption | undefined => {
  const exact = options.find((option) => getRepoCommunityOptionKey(option) === key);
  if (exact) return exact;
  const matching = options.filter((option) => option.communityId === key);
  return matching.length === 1 ? matching[0] : undefined;
};
