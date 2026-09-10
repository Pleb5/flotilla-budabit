import { validateRepoUpstream, type RepoUpstreamTag } from "@nostr-git/core/events";
import { makeNaddrFromAddress } from "./eventLink.js";

/** Never turn unknown tag content or a non-web Git transport into an unsafe browser link. */
export function repoUpstreamLink(tag: RepoUpstreamTag): {
  label: string;
  href?: string;
  external?: boolean;
} {
  const target = tag[1];
  if (validateRepoUpstream(target)) return { label: target };
  if (target.startsWith("30617:")) {
    const naddr = makeNaddrFromAddress(target, tag[2] ? [tag[2]] : []);
    const [, owner, ...identifier] = target.split(":");
    return {
      label: `${owner.slice(0, 8)}…/${identifier.join(":")}`,
      href: naddr ? `/git/${naddr}` : undefined,
    };
  }
  return {
    label: target,
    ...(/^https?:\/\//i.test(target) ? { href: target, external: true } : {}),
  };
}
