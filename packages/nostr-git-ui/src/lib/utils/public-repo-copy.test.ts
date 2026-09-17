import { describe, it, expect, vi } from "vitest";
import { readPublicCopyRefs, verifyPublicCopyRefs } from "./public-repo-copy";
import type { PublicRepoSource } from "@nostr-git/core/git";

const source = {
  cloneUrl: "https://codeberg.org/o/r.git",
  defaultBranch: "trunk",
} as PublicRepoSource;
const signal = () => new AbortController().signal;
const advertised = [
  { ref: "refs/heads/trunk", oid: "a".repeat(40) },
  { ref: "refs/heads/feature", oid: "b".repeat(40) },
  { ref: "refs/tags/v1", oid: "c".repeat(40) },
  { ref: "refs/tags/v1^{}", oid: "a".repeat(40) },
  { ref: "refs/pull/1/head", oid: "d".repeat(40) },
];

describe("public Git copy snapshot", () => {
  it("keeps all branch and tag tips, excluding provider PR and peeled refs", async () => {
    const worker = { listServerRefs: vi.fn(async () => advertised) };
    const refs = await readPublicCopyRefs(worker, source, signal());
    expect(refs.branches).toEqual(["trunk", "feature"]);
    expect(refs.tags).toEqual(["v1"]);
    expect(refs.refs).toHaveLength(3);
    expect(worker.listServerRefs).toHaveBeenCalledWith({
      url: source.cloneUrl,
      symrefs: true,
      publicSource: true,
    });
  });
  it("fails closed on missing default, malformed ids, or too many refs", async () => {
    for (const refs of [
      [],
      [{ ref: "refs/heads/trunk", oid: "invalid" }],
      [
        ...advertised,
        ...Array.from({ length: 100 }, (_, n) => ({
          ref: `refs/heads/b${n}`,
          oid: "a".repeat(40),
        })),
      ],
    ]) {
      await expect(
        readPublicCopyRefs({ listServerRefs: async () => refs }, source, signal())
      ).rejects.toThrow();
    }
  });
  it("verifies remote-tracking branches, annotated tags, and a stable source", async () => {
    const worker = {
      listServerRefs: vi.fn(async () => advertised),
      resolveRef: vi.fn(async ({ ref }) => {
        if (ref.startsWith("refs/heads/")) throw new Error("remote tracking only");
        return advertised.find(
          (item) => item.ref === ref.replace("refs/remotes/origin/", "refs/heads/")
        )?.oid;
      }),
    };
    const snapshot = await readPublicCopyRefs(worker, source, signal());
    await verifyPublicCopyRefs(worker, "local", source, snapshot, signal());
    worker.listServerRefs.mockResolvedValue([
      { ...advertised[0], oid: "f".repeat(40) },
      ...advertised.slice(1),
    ]);
    await expect(verifyPublicCopyRefs(worker, "local", source, snapshot, signal())).rejects.toThrow(
      /changed during cloning/
    );
    worker.resolveRef.mockResolvedValue("e".repeat(40));
    await expect(verifyPublicCopyRefs(worker, "local", source, snapshot, signal())).rejects.toThrow(
      /incomplete/
    );
  });
});
