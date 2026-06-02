import { GIT_REPO_ANNOUNCEMENT } from "../events/nip34/nip34.js";

export function makeRepoAddr(pubkey: string, repoId: string): string {
  return `${GIT_REPO_ANNOUNCEMENT}:${pubkey}:${repoId}`;
}

export function isRepoAddr(addr: string): boolean {
  return new RegExp(`^${GIT_REPO_ANNOUNCEMENT}:[0-9a-fA-F]{64}:.+`).test(addr);
}
