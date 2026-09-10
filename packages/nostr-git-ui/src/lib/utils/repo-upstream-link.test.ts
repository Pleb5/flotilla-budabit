import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { repoUpstreamLink } from "./repo-upstream-link.js";

describe("upstream links", () => {
  it("preserves the exact coordinate in the repository link", () => {
    const link = repoUpstreamLink([
      "u",
      `30617:${"a".repeat(64)}:Legacy/Case:ID`,
      "wss://relay.test",
    ]);
    const decoded = nip19.decode(link.href!.slice(5));
    expect(decoded.type).toBe("naddr");
    expect(decoded.data).toMatchObject({
      kind: 30617,
      pubkey: "a".repeat(64),
      identifier: "Legacy/Case:ID",
    });
  });
  it("links web Git URLs but gives unsafe/unknown targets no href", () => {
    expect(repoUpstreamLink(["u", "https://git.test/repo.git"]).href).toBe(
      "https://git.test/repo.git"
    );
    expect(repoUpstreamLink(["u", "javascript:alert(1)"]).href).toBeUndefined();
    expect(repoUpstreamLink(["u", "git@git.test:repo.git"]).href).toBeUndefined();
  });
});
