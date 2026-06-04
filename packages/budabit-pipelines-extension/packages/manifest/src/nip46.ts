import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import * as nip44 from 'nostr-tools/nip44';
import type { Event, UnsignedEvent } from 'nostr-tools';

const NIP46_KIND = 24133;

interface Nip46Request {
  id: string;
  method: string;
  params: string[];
}

interface Nip46Response {
  id: string;
  result?: string;
  error?: string;
}

interface BunkerConnection {
  remoteSignerPubkey: string;
  relays: string[];
  secret?: string;
}

interface PendingRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class Nip46Client {
  private clientSecretKey: Uint8Array;
  private clientPubkey: string;
  private pool: SimplePool;
  private connection: BunkerConnection | null = null;
  private userPubkey: string | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private subscriptionCleanup: (() => void) | null = null;
  private conversationKey: Uint8Array | null = null;

  constructor() {
    this.clientSecretKey = generateSecretKey();
    this.clientPubkey = getPublicKey(this.clientSecretKey);
    this.pool = new SimplePool();
  }

  get publicKey(): string {
    return this.clientPubkey;
  }

  get userPublicKey(): string | null {
    return this.userPubkey;
  }

  parseBunkerUrl(bunkerUrl: string): BunkerConnection {
    if (!bunkerUrl.startsWith('bunker://')) {
      throw new Error('Invalid bunker URL: must start with bunker://');
    }

    const url = new URL(bunkerUrl);
    const remoteSignerPubkey = url.hostname;

    if (!remoteSignerPubkey || remoteSignerPubkey.length !== 64) {
      throw new Error('Invalid bunker URL: missing or invalid remote-signer-pubkey');
    }

    const relays = url.searchParams.getAll('relay');
    if (relays.length === 0) {
      throw new Error('Invalid bunker URL: at least one relay is required');
    }

    const secret = url.searchParams.get('secret') || undefined;

    return { remoteSignerPubkey, relays, secret };
  }

  async connect(bunkerUrl: string, timeoutMs = 30000): Promise<string> {
    this.connection = this.parseBunkerUrl(bunkerUrl);

    // Compute conversation key for NIP-44 encryption
    this.conversationKey = nip44.v2.utils.getConversationKey(
      this.clientSecretKey,
      this.connection.remoteSignerPubkey
    );

    // Subscribe to responses from the remote signer
    this.subscribeToResponses();

    // Send connect request
    const params: string[] = [this.connection.remoteSignerPubkey];
    if (this.connection.secret) {
      params.push(this.connection.secret);
    }

    const result = await this.sendRequest('connect', params, timeoutMs);

    // Validate secret if provided
    if (this.connection.secret && result !== this.connection.secret && result !== 'ack') {
      throw new Error('Connection failed: secret mismatch');
    }

    // Get the user's public key
    this.userPubkey = await this.sendRequest('get_public_key', [], timeoutMs);

    console.log(`✅ Connected to remote signer`);
    console.log(`   Remote signer pubkey: ${this.connection.remoteSignerPubkey}`);
    console.log(`   User pubkey: ${this.userPubkey}`);

    return this.userPubkey;
  }

  private subscribeToResponses(): void {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (this.pool as any).subscribeMany(
      this.connection.relays,
      [
        {
          kinds: [NIP46_KIND],
          '#p': [this.clientPubkey],
          since: Math.floor(Date.now() / 1000) - 10,
        },
      ],
      {
        onevent: (event: Event) => {
          this.handleResponse(event);
        },
      }
    );

    this.subscriptionCleanup = () => {
      sub.close();
    };
  }

  private handleResponse(event: Event): void {
    if (!this.conversationKey) return;

    try {
      const decrypted = nip44.v2.decrypt(event.content, this.conversationKey);
      const response: Nip46Response = JSON.parse(decrypted);

      const pending = this.pendingRequests.get(response.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        // Check for auth challenge
        if (response.result === 'auth_url') {
          console.log(`\n🔐 Authentication required. Please visit:\n   ${response.error}\n`);
          // Don't reject - wait for another response with the same ID
          return;
        }
        pending.reject(new Error(response.error));
      } else if (response.result !== undefined) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error('Invalid response: missing result'));
      }
    } catch (err) {
      console.error('Failed to handle response:', err);
    }
  }

  private async sendRequest(method: string, params: string[], timeoutMs = 30000): Promise<string> {
    if (!this.connection || !this.conversationKey) {
      throw new Error('Not connected');
    }

    const requestId = Math.random().toString(36).substring(2, 15);

    const request: Nip46Request = {
      id: requestId,
      method,
      params,
    };

    const encrypted = nip44.v2.encrypt(JSON.stringify(request), this.conversationKey);

    const event: UnsignedEvent = {
      kind: NIP46_KIND,
      pubkey: this.clientPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.connection.remoteSignerPubkey]],
      content: encrypted,
    };

    // Sign with client key
    const { finalizeEvent } = await import('nostr-tools');
    const signedEvent = finalizeEvent(event, this.clientSecretKey);

    // Create promise for response
    const responsePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
    });

    // Publish request
    await Promise.any(this.pool.publish(this.connection.relays, signedEvent));

    return responsePromise;
  }

  async signEvent(unsignedEvent: UnsignedEvent): Promise<Event> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    const eventToSign = {
      kind: unsignedEvent.kind,
      content: unsignedEvent.content,
      tags: unsignedEvent.tags,
      created_at: unsignedEvent.created_at,
    };

    const result = await this.sendRequest('sign_event', [JSON.stringify(eventToSign)], 60000);
    return JSON.parse(result) as Event;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.sendRequest('ping', [], 10000);
      return result === 'pong';
    } catch {
      return false;
    }
  }

  async switchRelays(): Promise<string[] | null> {
    try {
      const result = await this.sendRequest('switch_relays', [], 10000);
      if (result === 'null' || !result) return null;
      const relays = JSON.parse(result) as string[];
      if (relays && relays.length > 0 && this.connection) {
        this.connection.relays = relays;
        // Re-subscribe on new relays
        if (this.subscriptionCleanup) {
          this.subscriptionCleanup();
        }
        this.subscribeToResponses();
      }
      return relays;
    } catch {
      return null;
    }
  }

  disconnect(): void {
    if (this.subscriptionCleanup) {
      this.subscriptionCleanup();
      this.subscriptionCleanup = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    if (this.connection) {
      this.pool.close(this.connection.relays);
    }

    this.connection = null;
    this.userPubkey = null;
    this.conversationKey = null;
  }
}

export async function connectToBunker(bunkerUrl: string): Promise<Nip46Client> {
  const client = new Nip46Client();
  await client.connect(bunkerUrl);

  // Check if remote signer wants to switch relays
  await client.switchRelays();

  return client;
}
