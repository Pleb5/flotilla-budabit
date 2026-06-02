import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { WidgetBridge } from '@flotilla/ext-shared';
import type { RerunDraft } from './types';

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sign an unsigned event via the host bridge and publish it to relays.
 * Returns the signed event's id.
 */
async function signAndPublish(
  bridge: WidgetBridge,
  unsignedEvent: Record<string, unknown>,
  relays: string[],
): Promise<string> {
  const res: any = await bridge.request('nostr:publish', { event: unsignedEvent, relays });

  if (res?.error) {
    throw new Error(`Publish failed: ${res.error}`);
  }

  const eventId = res?.result?.eventId ?? res?.eventId;
  if (!eventId || typeof eventId !== 'string') {
    throw new Error('Host did not return the signed event id after publishing.');
  }

  return eventId;
}

/**
 * Encrypt plaintext to a recipient pubkey using the host's NIP-44 signer.
 */
async function nip44Encrypt(
  bridge: WidgetBridge,
  recipientPubkey: string,
  plaintext: string,
): Promise<string> {
  const res: any = await bridge.request('nostr:nip44Encrypt', { recipientPubkey, plaintext });

  if (res?.error) {
    throw new Error(`NIP-44 encryption failed: ${res.error}`);
  }

  const ciphertext = res?.ciphertext;
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('Host did not return ciphertext from NIP-44 encryption.');
  }

  return ciphertext;
}

/**
 * Submit a workflow run + loom job via the host bridge.
 *
 * All signing, encryption, and publishing is delegated to the host —
 * no direct window.nostr / NIP-07 usage.
 */
export async function submitRerun(
  bridge: WidgetBridge,
  signerPubkey: string,
  draft: RerunDraft,
  paymentToken: string,
  secrets: Array<{ key: string; value: string }>
): Promise<string> {
  const ephemeralSecretKey = generateSecretKey();
  const ephemeralPubkey = getPublicKey(ephemeralSecretKey);
  const ephemeralSecretKeyHex = hexFromBytes(ephemeralSecretKey);

  // 1. Build and publish the workflow run event (kind 5401)
  const workflowRunEvent = {
    kind: 5401,
    created_at: currentTimestamp(),
    content: '',
    tags: [
      ['a', draft.repoAddress],
      ['workflow', draft.workflowPath],
      ['triggered-by', signerPubkey],
      ['publisher', ephemeralPubkey],
      ['trigger', 'manual'],
      ['branch', draft.branch],
      ['commit', draft.commit],
      ['t', 'hive-ci'],
    ],
    pubkey: signerPubkey,
  };

  const runId = await signAndPublish(bridge, workflowRunEvent, draft.publishRelays);

  // 2. Encrypt secrets via the host's NIP-44 signer
  const envTags: string[][] = [
    ['env', 'HIVE_CI_RUN_ID', runId],
    ['env', 'HIVE_CI_REPOSITORY', draft.repoNostrUrl],
    ['env', 'HIVE_CI_WORKFLOW', draft.workflowPath],
    ['env', 'HIVE_CI_BRANCH', draft.branch],
    ['env', 'HIVE_CI_COMMIT', draft.commit],
    ['env', 'HIVE_CI_RELAYS', draft.publishRelays.join(',')],
    ['env', 'HIVE_CI_BLOSSOM_SERVER', 'https://blossom.primal.net'],
    ...draft.envVars
      .filter(entry => entry.key.trim() && entry.value.trim())
      .map(entry => ['env', entry.key.trim(), entry.value]),
  ];

  const encryptedNsec = await nip44Encrypt(bridge, draft.workerPubkey, ephemeralSecretKeyHex);
  const secretTags: string[][] = [
    ['secret', 'HIVE_CI_NSEC', encryptedNsec],
  ];

  for (const secret of secrets.filter(entry => entry.key.trim() && entry.value.trim())) {
    const encrypted = await nip44Encrypt(bridge, draft.workerPubkey, secret.value);
    secretTags.push(['secret', secret.key.trim(), encrypted]);
  }

  // 3. Build and publish the loom job event (kind 5100)
  const loomJobEvent = {
    kind: 5100,
    created_at: currentTimestamp(),
    content: '',
    tags: [
      ['p', draft.workerPubkey],
      ['e', runId],
      ['cmd', draft.command],
      ['args', ...draft.args],
      ['payment', paymentToken],
      ...envTags,
      ...secretTags,
    ],
    pubkey: signerPubkey,
  };

  await signAndPublish(bridge, loomJobEvent, draft.publishRelays);

  return runId;
}

export function toRepoNostrUrl(repoAddress: string | undefined, relays: string[]): string {
  if (!repoAddress) return '';

  try {
    const parts = repoAddress.split(':');
    if (parts.length !== 3) return '';

    const [, pubkey, identifier] = parts;
    if (!pubkey || !identifier) return '';
    const npub = nip19.npubEncode(pubkey);
    const relayHints = relays.map(relay => encodeURIComponent(relay)).join('/');
    return relayHints ? `nostr://${npub}/${relayHints}/${identifier}` : `nostr://${npub}/${identifier}`;
  } catch {
    return '';
  }
}
