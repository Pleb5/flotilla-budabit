import { Client } from "@contextvm/mcp-sdk/client";
import type { Transport } from "@contextvm/mcp-sdk/shared/transport.js";
import {
  NostrClientTransport,
  type NostrTransportOptions,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";

export interface FollowRepoInput {
  /**
   * Full repo address, 30617:<owner-pubkey-hex>:<identifier>, or an naddr (relay hints are used)
   */
  repo_addr?: string;
  /**
   * Repo owner pubkey (hex) — alternative to repo_addr
   */
  repo_owner?: string;
  /**
   * Repo identifier (the 30617 d tag) — alternative to repo_addr
   */
  d_tag?: string;
  /**
   * Extra relay hints where the repo publishes
   */
  relays?: string[];
}

export interface FollowRepoOutput {
  [k: string]: unknown;
}

export interface UnfollowRepoInput {
  /**
   * Full repo address, 30617:<owner-pubkey-hex>:<identifier>, or an naddr (relay hints are used)
   */
  repo_addr?: string;
  /**
   * Repo owner pubkey (hex) — alternative to repo_addr
   */
  repo_owner?: string;
  /**
   * Repo identifier (the 30617 d tag) — alternative to repo_addr
   */
  d_tag?: string;
  /**
   * Extra relay hints where the repo publishes
   */
  relays?: string[];
}

export interface UnfollowRepoOutput {
  [k: string]: unknown;
}

export type ListFollowedInput = Record<string, unknown>;

export interface ListFollowedOutput {
  [k: string]: unknown;
}

export type StatusInput = Record<string, unknown>;

export interface StatusOutput {
  [k: string]: unknown;
}

export type ListRunnersInput = Record<string, unknown>;

export interface ListRunnersOutput {
  [k: string]: unknown;
}

export interface RunnersAddInput {
  /**
   * Loom worker pubkey (hex)
   */
  pubkey: string;
}

export interface RunnersAddOutput {
  [k: string]: unknown;
}

export interface RunnersRemoveInput {
  /**
   * Loom worker pubkey (hex)
   */
  pubkey: string;
}

export interface RunnersRemoveOutput {
  [k: string]: unknown;
}

export interface AllowPubkeyInput {
  /**
   * Requester pubkey (hex)
   */
  pubkey: string;
}

export interface AllowPubkeyOutput {
  [k: string]: unknown;
}

export interface RevokePubkeyInput {
  /**
   * Requester pubkey (hex)
   */
  pubkey: string;
}

export interface RevokePubkeyOutput {
  [k: string]: unknown;
}

export type ListAllowedInput = Record<string, unknown>;

export interface ListAllowedOutput {
  [k: string]: unknown;
}

export type BudabitHiveCI = {
  FollowRepo: (repo_addr?: string, repo_owner?: string, d_tag?: string, relays?: string[]) => Promise<FollowRepoOutput>;
  UnfollowRepo: (repo_addr?: string, repo_owner?: string, d_tag?: string, relays?: string[]) => Promise<UnfollowRepoOutput>;
  ListFollowed: (args: ListFollowedInput) => Promise<ListFollowedOutput>;
  Status: (args: StatusInput) => Promise<StatusOutput>;
  ListRunners: (args: ListRunnersInput) => Promise<ListRunnersOutput>;
  RunnersAdd: (pubkey: string) => Promise<RunnersAddOutput>;
  RunnersRemove: (pubkey: string) => Promise<RunnersRemoveOutput>;
  AllowPubkey: (pubkey: string) => Promise<AllowPubkeyOutput>;
  RevokePubkey: (pubkey: string) => Promise<RevokePubkeyOutput>;
  ListAllowed: (args: ListAllowedInput) => Promise<ListAllowedOutput>;
};

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text"
    )
    .map((block) => block.text)
    .join("\n");
}

export class BudabitHiveCIClient implements BudabitHiveCI {
//  static readonly SERVER_PUBKEY = "94f4eb902465daeaa56c291d4abf07e712f03bda3d4f15a411b9728f80da18fa";  // Greg's
  static readonly SERVER_PUBKEY = "f814c1976ca05431081e0b27e2a190c379e8e4b25477c7f431fe58e8a7fa9551";  // Arjen's
  static readonly DEFAULT_RELAYS = ["wss://relay.budabit.club/", "wss://relay.contextvm.org/", "wss://relay2.contextvm.org/"];
  private client: Client;
  private transport: Transport;

  constructor(
    options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {}
  ) {
    this.client = new Client({
      name: "BudabitHiveCIClient",
      version: "1.0.0",
    });

    // Private key precedence: constructor options > config file
    const resolvedPrivateKey = options.privateKey ||
      "";

    // Use options.signer if provided, otherwise create from resolved private key
    const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey);
    // Use options.relays if provided, otherwise use class DEFAULT_RELAYS
    const relays = options.relays || BudabitHiveCIClient.DEFAULT_RELAYS;
    // Use options.relayHandler if provided, otherwise create from relays
    const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays);
    const serverPubkey = options.serverPubkey;
    const { privateKey: _, ...rest } = options;

    this.transport = new NostrClientTransport({
      serverPubkey: serverPubkey || BudabitHiveCIClient.SERVER_PUBKEY,
      signer,
      relayHandler,
      isStateless: true,
      ...rest,
    });

    // Auto-connect in constructor
    this.client.connect(this.transport).catch((error) => {
      console.error(`Failed to connect to server: ${error}`);
    });
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
  }

  private async call<T = unknown>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const result = await this.client.callTool({
      name,
      arguments: { ...args },
    });
    if (result.isError) {
      throw new Error(`Tool "${name}" failed: ${extractTextContent(result.content)}`);
    }
    if (result.structuredContent !== undefined) {
      return result.structuredContent as T;
    }
    // Fall back to text content blocks when the server does not provide
    // structured content.
    const text = extractTextContent(result.content);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

    /**
   * Add a repo to the follow table. Any repo — the watcher performs no maintainer check on the caller.
   * @param {string} repo_addr [optional] Full repo address, 30617:<owner-pubkey-hex>:<identifier>, or an naddr (relay hints are used)
   * @param {string} repo_owner [optional] Repo owner pubkey (hex) — alternative to repo_addr
   * @param {string} d_tag [optional] Repo identifier (the 30617 d tag) — alternative to repo_addr
   * @param {string[]} relays [optional] Extra relay hints where the repo publishes
   * @returns {Promise<FollowRepoOutput>} The result of the follow_repo operation
   */
  async FollowRepo(
    repo_addr?: string, repo_owner?: string, d_tag?: string, relays?: string[]
  ): Promise<FollowRepoOutput> {
    return this.call("follow_repo", { repo_addr, repo_owner, d_tag, relays });
  }

    /**
   * Remove a repo from the follow table, along with its ref state and schedules.
   * @param {string} repo_addr [optional] Full repo address, 30617:<owner-pubkey-hex>:<identifier>, or an naddr (relay hints are used)
   * @param {string} repo_owner [optional] Repo owner pubkey (hex) — alternative to repo_addr
   * @param {string} d_tag [optional] Repo identifier (the 30617 d tag) — alternative to repo_addr
   * @param {string[]} relays [optional] Extra relay hints where the repo publishes
   * @returns {Promise<UnfollowRepoOutput>} The result of the unfollow_repo operation
   */
  async UnfollowRepo(
    repo_addr?: string, repo_owner?: string, d_tag?: string, relays?: string[]
  ): Promise<UnfollowRepoOutput> {
    return this.call("unfollow_repo", { repo_addr, repo_owner, d_tag, relays });
  }

    /**
   * Followed repos with their per-ref last-seen commit.
   * @returns {Promise<ListFollowedOutput>} The result of the list_followed operation
   */
  async ListFollowed(
    args: ListFollowedInput
  ): Promise<ListFollowedOutput> {
    return this.call("list_followed", args);
  }

    /**
   * Uptime, relay health, runner pool size, and recent runs.
   * @returns {Promise<StatusOutput>} The result of the status operation
   */
  async Status(
    args: StatusInput
  ): Promise<StatusOutput> {
    return this.call("status", args);
  }

    /**
   * The resolved runner pool: allowed ∩ online, with the round-robin cursor. Advertised pricing is reported but does not gate eligibility — pool membership asserts an unpaid arrangement with the worker.
   * @returns {Promise<ListRunnersOutput>} The result of the list_runners operation
   */
  async ListRunners(
    args: ListRunnersInput
  ): Promise<ListRunnersOutput> {
    return this.call("list_runners", args);
  }

    /**
   * Add a runner pubkey to the private pool. The pool is never published.
   * @param {string} pubkey Loom worker pubkey (hex)
   * @returns {Promise<RunnersAddOutput>} The result of the runners_add operation
   */
  async RunnersAdd(
    pubkey: string
  ): Promise<RunnersAddOutput> {
    return this.call("runners_add", { pubkey });
  }

    /**
   * Remove a runner pubkey from the pool.
   * @param {string} pubkey Loom worker pubkey (hex)
   * @returns {Promise<RunnersRemoveOutput>} The result of the runners_remove operation
   */
  async RunnersRemove(
    pubkey: string
  ): Promise<RunnersRemoveOutput> {
    return this.call("runners_remove", { pubkey });
  }

    /**
   * Add a requester to the allowlist.
   * @param {string} pubkey Requester pubkey (hex)
   * @returns {Promise<AllowPubkeyOutput>} The result of the allow_pubkey operation
   */
  async AllowPubkey(
    pubkey: string
  ): Promise<AllowPubkeyOutput> {
    return this.call("allow_pubkey", { pubkey });
  }

    /**
   * Remove a requester from the allowlist.
   * @param {string} pubkey Requester pubkey (hex)
   * @returns {Promise<RevokePubkeyOutput>} The result of the revoke_pubkey operation
   */
  async RevokePubkey(
    pubkey: string
  ): Promise<RevokePubkeyOutput> {
    return this.call("revoke_pubkey", { pubkey });
  }

    /**
   * Dump the allowlist. The owner is implicitly authorized and is not listed.
   * @returns {Promise<ListAllowedOutput>} The result of the list_allowed operation
   */
  async ListAllowed(
    args: ListAllowedInput
  ): Promise<ListAllowedOutput> {
    return this.call("list_allowed", args);
  }
}
