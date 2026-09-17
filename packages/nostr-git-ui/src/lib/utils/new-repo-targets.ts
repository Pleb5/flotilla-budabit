import type { Token } from "../stores/tokens.js";
import {
  buildRemoteTargetOptions,
  inferRemoteTargetProvider,
  normalizeTokenHostForTarget,
  type RemoteTargetSelection,
} from "./remote-targets.js";

const hosts: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  gitea: "gitea.com",
  forgejo: "codeberg.org",
};
export function newRepoTargetHost(id: string): string {
  return id.startsWith("git:") ? id.slice(4) : hosts[id] || "";
}

export function newRepoTargetCards(tokens: Token[]) {
  const configured = buildRemoteTargetOptions({ tokenList: tokens, graspRelayUrls: [] });
  const known = Object.entries(hosts).map(([id, host]) => ({
    id,
    host,
    name:
      host === "codeberg.org"
        ? "Codeberg / Forgejo"
        : id === "github"
          ? "GitHub"
          : id === "gitlab"
            ? "GitLab"
            : "Gitea",
    hasToken: tokens.some((token) => normalizeTokenHostForTarget(token.host) === host),
    supported: true,
  }));
  return [
    { id: "grasp", host: "", name: "GRASP", hasToken: true, supported: true },
    ...known,
    ...configured
      .filter((target) => !Object.values(hosts).includes(target.host || ""))
      .map((target) => ({
        id: `git:${target.host}`,
        host: target.host || "",
        name: target.label,
        hasToken: true,
        supported: target.status !== "unsupported",
      })),
  ];
}

export function newRepoTargets(
  ids: string[],
  relays: string[],
  tokens: Token[]
): RemoteTargetSelection[] {
  return ids.flatMap<RemoteTargetSelection>((id) => {
    if (id === "grasp")
      return relays.map((relayUrl) => ({
        id: `grasp:${relayUrl}`,
        label: `GRASP (${relayUrl})`,
        provider: "grasp",
        relayUrl,
      }));
    const host = newRepoTargetHost(id);
    const provider = inferRemoteTargetProvider(
      host,
      tokens.find((token) => normalizeTokenHostForTarget(token.host) === host)?.token || ""
    );
    return provider ? [{ id: `git:${host}`, label: host, host, provider }] : [];
  });
}

export function validGraspSelection(selected: boolean, urls: string[]): boolean {
  return (
    !selected ||
    (urls.length > 0 &&
      urls.every((value) => {
        try {
          const url = new URL(value);
          return (
            ["ws:", "wss:"].includes(url.protocol) &&
            Boolean(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.hash
          );
        } catch {
          return false;
        }
      }))
  );
}
