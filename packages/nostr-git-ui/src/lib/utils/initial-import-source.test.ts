import { describe, expect, it, vi } from "vitest";
import { finalizeEvent } from "nostr-tools";
import { validateIssueEvent, validateStatusEvent } from "@nostr-git/core/utils";
import {
  INITIAL_IMPORT_LIMITS,
  initialImportPages,
  initialImportSourceKey,
  initialImportTemplate,
  inspectInitialImportSource,
  parseInitialImportUrl,
  readImportJson,
  type GitHubImportItem,
  type InitialImportSource,
} from "./initial-import-source";

const signal = () => new AbortController().signal;
const jsonFetch = (data: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(data))) as unknown as typeof fetch;
const source: InitialImportSource = {
  url: "https://github.com/owner/repo",
  owner: "owner",
  name: "repo",
  id: 1,
  description: "",
  defaultBranch: "main",
  sizeKiB: 1,
  openIssues: 1,
};
const item: GitHubImportItem = {
  id: 42,
  number: 7,
  title: "An issue",
  body: "hello",
  user: { login: "alice" },
  state: "closed",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

describe("bounded public GitHub source", () => {
  it("normalizes clone URLs and rejects ambiguous/secret/unsupported URLs", () => {
    expect(parseInitialImportUrl(`${source.url}.git/`).url).toBe(source.url);
    for (const url of [
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://github.com.evil/a/b",
      "https://github.com/a/b?token=secret",
      "https://user:secret@github.com/a/b",
      "https://github.com/a/b/issues",
      "https://github.com:8080/a/b",
    ]) {
      expect(() => parseInitialImportUrl(url)).toThrow();
    }
  });
  it("requires anonymous public, nonempty and bounded repository evidence", async () => {
    const metadata = {
      id: 1,
      private: false,
      full_name: "owner/repo",
      open_issues_count: 1,
      default_branch: "main",
      size: 1,
    };
    const fetcher = jsonFetch(metadata);
    expect(await inspectInitialImportSource(source.url, signal(), fetcher)).toMatchObject(source);
    expect(vi.mocked(fetcher).mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    for (const overrides of [
      { private: true },
      { size: 0 },
      { size: INITIAL_IMPORT_LIMITS.gitKiB + 1 },
      { full_name: "moved/repo" },
    ]) {
      await expect(
        inspectInitialImportSource(source.url, signal(), jsonFetch({ ...metadata, ...overrides }))
      ).rejects.toThrow();
    }
  });
  it("bounds streamed bytes before JSON parsing and redacts network exceptions", async () => {
    const fetcher = jsonFetch({ body: "x".repeat(100) });
    await expect(
      readImportJson("https://api.github.com/repos/a/b", signal(), "secret", fetcher, 20)
    ).rejects.toThrow("limit");
    await expect(
      readImportJson(
        "https://api.github.com/repos/a/b",
        signal(),
        "secret",
        vi.fn(async () => {
          throw new Error("secret-token in fetch failure");
        })
      )
    ).rejects.toThrow("Could not read the public GitHub source");
  });
  it("does not prefetch while a page is being consumed; detects repetition", async () => {
    const fetcher = jsonFetch(Array.from({ length: 30 }, (_, i) => ({ ...item, id: i + 1 })));
    const pages = initialImportPages(source, "issues", signal(), { fetcher });
    expect(vi.mocked(fetcher)).not.toHaveBeenCalled();
    expect((await pages.next()).value).toHaveLength(30);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
    await expect(pages.next()).rejects.toThrow("repeated");
  });
  it("enforces page limits and observes cancellation before fetching", async () => {
    const fetcher = jsonFetch(Array.from({ length: 30 }, (_, i) => ({ ...item, id: i + 1 })));
    const pages = initialImportPages(source, "issues", signal(), { fetcher, maxPages: 1 });
    await pages.next();
    await expect(pages.next()).rejects.toThrow("page limit");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readImportJson("https://api.github.com/repos/a/b", controller.signal, "", fetcher)
    ).rejects.toThrow();
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1);
  });
});

describe("initial import provenance", () => {
  const secret = new Uint8Array(32).fill(1);
  const create = (type: "issue" | "status" | "comment", overrides = {}) =>
    initialImportTemplate({
      source,
      item,
      repoAddress: `30617:${"a".repeat(64)}:repo`,
      ownerPubkey: "a".repeat(64),
      createdAt: 100,
      rootId: "b".repeat(64),
      issueNumber: 7,
      type,
      ...overrides,
    });
  it("retains source attribution with owner signing and valid event schemas", () => {
    const issue = finalizeEvent(create("issue"), secret);
    expect(validateIssueEvent(issue).success).toBe(true);
    expect(validateStatusEvent(finalizeEvent(create("status"), secret)).success).toBe(true);
    expect(issue.tags).toContainEqual(["proxy", `${source.url}/issues/7`, "github"]);
    expect(issue.tags).toContainEqual(["source-author", "alice", "https://github.com/alice"]);
    expect(create("comment").tags).toContainEqual(["E", "b".repeat(64), "", "a".repeat(64)]);
    expect(create("comment").tags).toContainEqual(["q", `30617:${"a".repeat(64)}:repo`]);
  });
  it("scopes identities to source repository and object type", () => {
    expect(initialImportSourceKey(source, "issue", 1)).not.toBe(
      initialImportSourceKey({ ...source, id: 2 }, "issue", 1)
    );
    expect(initialImportSourceKey(source, "issue", 1)).not.toBe(
      initialImportSourceKey(source, "comment", 1)
    );
  });
  it("does not fabricate future timestamps or silently truncate oversized events", () => {
    expect(create("issue").created_at).toBe(100);
    expect(() =>
      create("issue", { item: { ...item, body: "x".repeat(INITIAL_IMPORT_LIMITS.eventBytes) } })
    ).toThrow("not truncated");
  });
});
