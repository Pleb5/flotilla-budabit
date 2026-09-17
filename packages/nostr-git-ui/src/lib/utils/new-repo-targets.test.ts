import { describe, it, expect } from "vitest";
import { newRepoTargets, newRepoTargetCards, validGraspSelection } from "./new-repo-targets";
import { registerGitHost, clearGitHosts } from "@nostr-git/core/git";

describe("new repository target selection", () => {
  it("requires explicit provider selection for an unidentified destination host", () => {
    const tokens = [{ host: "forge.example.net:8443", token: "target" }];
    expect(newRepoTargetCards(tokens).find((card) => card.host === tokens[0].host)?.supported).toBe(
      false
    );
    expect(newRepoTargets([`git:${tokens[0].host}`], [], tokens)).toEqual([]);
    registerGitHost(tokens[0].host, "forgejo");
    expect(newRepoTargetCards(tokens).find((card) => card.host === tokens[0].host)?.supported).toBe(
      true
    );
    expect(newRepoTargets([`git:${tokens[0].host}`], [], tokens)[0]).toMatchObject({
      host: tokens[0].host,
      provider: "forgejo",
    });
    clearGitHosts();
  });
  it("keeps provider identities and custom hosts distinct", () => {
    const tokens = [
      { host: "codeberg.org", token: "target" },
      { host: "gitea.example.org:8443", token: "target" },
    ];
    const cards = newRepoTargetCards(tokens);
    expect(cards.find((card) => card.id === "forgejo")).toMatchObject({
      name: "Codeberg / Forgejo",
      hasToken: true,
    });
    expect(cards.some((card) => card.id === "bitbucket")).toBe(false);
    expect(newRepoTargets(["forgejo", "git:gitea.example.org:8443"], [], tokens)).toEqual([
      { id: "git:codeberg.org", host: "codeberg.org", label: "codeberg.org", provider: "forgejo" },
      {
        id: "git:gitea.example.org:8443",
        host: "gitea.example.org:8443",
        label: "gitea.example.org:8443",
        provider: "gitea",
      },
    ]);
  });
  it("never treats selected GRASP without a valid server as ready", () => {
    expect(validGraspSelection(true, [])).toBe(false);
    for (const value of [
      "wss://",
      "https://example.org",
      "wss://user:password@example.org",
      "garbage",
    ])
      expect(validGraspSelection(true, [value])).toBe(false);
    expect(validGraspSelection(true, ["wss://grasp.example.org/git"])).toBe(true);
    expect(validGraspSelection(false, [])).toBe(true);
  });
});
