import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getRepo, checkGraspRepoExists } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getRepo: vi.fn(),
  checkGraspRepoExists: vi.fn(),
}));

vi.mock("@nostr-git/core", () => ({
  getGitServiceApi: vi.fn(() => ({
    getCurrentUser,
    getRepo,
  })),
}));

vi.mock("./grasp-availability.js", () => ({
  checkGraspRepoExists,
}));

import { preflightNewRemoteTargets, preflightRemoteTargets } from "./remote-targets";

describe("remote target preflight", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
    getRepo.mockReset();
    checkGraspRepoExists.mockReset();
  });

  it("blocks existing git repositories when reuse is disabled", async () => {
    getCurrentUser.mockResolvedValue({ login: "alice" });
    getRepo.mockResolvedValue({
      fullName: "alice/flotilla-budabit",
      name: "flotilla-budabit",
      cloneUrl: "https://github.com/alice/flotilla-budabit.git",
      htmlUrl: "https://github.com/alice/flotilla-budabit",
      owner: { login: "alice" },
    });

    const [result] = await preflightRemoteTargets({
      targets: [
        {
          id: "git:github.com",
          label: "GitHub (github.com)",
          provider: "github",
          host: "github.com",
          status: "checking",
        },
      ],
      tokenList: [{ host: "github.com", token: "ghp_test" }],
      userPubkey: "pubkey",
      repoName: "flotilla-budabit",
      options: { allowExistingRepoReuse: false },
    });

    expect(result.status).toBe("failed");
    expect(result.existsAlready).toBe(true);
    expect(result.detail).toContain("Fork only creates new destinations");
  });

  it("allows existing git repositories when reuse stays enabled", async () => {
    getCurrentUser.mockResolvedValue({ login: "alice" });
    getRepo.mockResolvedValue({
      fullName: "alice/flotilla-budabit",
      name: "flotilla-budabit",
      cloneUrl: "https://github.com/alice/flotilla-budabit.git",
      htmlUrl: "https://github.com/alice/flotilla-budabit",
      owner: { login: "alice" },
    });

    const [result] = await preflightRemoteTargets({
      targets: [
        {
          id: "git:github.com",
          label: "GitHub (github.com)",
          provider: "github",
          host: "github.com",
          status: "checking",
        },
      ],
      tokenList: [{ host: "github.com", token: "ghp_test" }],
      userPubkey: "pubkey",
      repoName: "flotilla-budabit",
    });

    expect(result.status).toBe("ready");
    expect(result.existsAlready).toBe(true);
    expect(result.detail).toBe("Repository exists, will push to existing destination");
  });

  it("blocks existing GRASP repositories when reuse is disabled", async () => {
    checkGraspRepoExists.mockResolvedValue({
      exists: true,
      htmlUrl: "https://relay.example/npub1test/flotilla-budabit",
    });

    const [result] = await preflightRemoteTargets({
      targets: [
        {
          id: "grasp:wss://relay.example",
          label: "GRASP (relay.example)",
          provider: "grasp",
          relayUrl: "wss://relay.example",
          status: "checking",
        },
      ],
      tokenList: [],
      userPubkey: "pubkey",
      repoName: "flotilla-budabit",
      options: { allowExistingRepoReuse: false },
    });

    expect(result.status).toBe("failed");
    expect(result.existsAlready).toBe(true);
    expect(result.detail).toContain("Fork only creates new destinations");
  });

  it("keeps empty provisioned GRASP repositories resumable for import", async () => {
    checkGraspRepoExists.mockResolvedValue({
      exists: false,
      provisioned: true,
      htmlUrl: "https://relay.example/npub1test/seedsigner",
    });

    const [result] = await preflightRemoteTargets({
      targets: [
        {
          id: "grasp:wss://relay.example",
          label: "GRASP (relay.example)",
          provider: "grasp",
          relayUrl: "wss://relay.example",
          status: "checking",
        },
      ],
      tokenList: [],
      userPubkey: "pubkey",
      repoName: "seedsigner",
    });

    expect(result.status).toBe("ready");
    expect(result.existsAlready).toBeUndefined();
    expect(result.existingRemoteUrl).toBeUndefined();
    expect(result.detail).toContain("resume");
  });

  it("fails the authoritative new-target preflight when any destination exists", async () => {
    checkGraspRepoExists.mockResolvedValue({
      exists: true,
      htmlUrl: "https://relay.example/npub1test/repo",
    });

    await expect(
      preflightNewRemoteTargets({
        targets: [
          {
            id: "grasp:wss://relay.example",
            label: "GRASP (relay.example)",
            provider: "grasp",
            relayUrl: "wss://relay.example",
          },
        ],
        tokenList: [],
        userPubkey: "pubkey",
        repoName: "repo",
      })
    ).rejects.toThrow("Repository target preflight failed");
  });

  it("allows authoritative target reuse for same-coordinate augmentation", async () => {
    checkGraspRepoExists.mockResolvedValue({
      exists: true,
      htmlUrl: "https://relay.example/npub1test/repo",
    });

    const [target] = await preflightNewRemoteTargets({
      targets: [
        {
          id: "grasp:wss://relay.example",
          label: "GRASP (relay.example)",
          provider: "grasp",
          relayUrl: "wss://relay.example",
        },
      ],
      tokenList: [],
      userPubkey: "pubkey",
      repoName: "repo",
      allowExistingRepoReuse: true,
    });

    expect(target.existsAlready).toBe(true);
    expect(target.existingRemoteUrl).toBe("https://relay.example/npub1test/repo.git");
  });

  it("checks every selected GRASP target", async () => {
    checkGraspRepoExists.mockResolvedValue({ exists: false });

    const targets = await preflightNewRemoteTargets({
      targets: [
        {
          id: "grasp:wss://one.example",
          label: "GRASP one",
          provider: "grasp",
          relayUrl: "wss://one.example",
        },
        {
          id: "grasp:wss://two.example",
          label: "GRASP two",
          provider: "grasp",
          relayUrl: "wss://two.example",
        },
      ],
      tokenList: [],
      userPubkey: "pubkey",
      repoName: "repo",
    });

    expect(targets).toHaveLength(2);
    expect(checkGraspRepoExists).toHaveBeenCalledTimes(2);
  });
});
