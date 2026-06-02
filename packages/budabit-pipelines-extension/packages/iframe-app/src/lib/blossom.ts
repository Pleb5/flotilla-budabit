import {Actions, createUploadAuth} from 'blossom-client-sdk';
import type {WidgetBridge} from '@flotilla/ext-shared';

/** Order matters — first server that accepts the upload wins. */
const DEFAULT_BLOSSOM_SERVERS = ['https://cdn.sovbit.host/'];

/**
 * Wraps the host bridge's `nostr:sign` action as a blossom-client-sdk-compatible
 * signer callback. Lets Blossom auth events (kind 24242) be signed with the
 * user's key without exposing the secret to the iframe.
 */
function bridgeSigner(bridge: WidgetBridge) {
  return async (event: any) => {
    const res: any = await bridge.request('nostr:sign', event);
    if (res?.error) throw new Error(`nostr:sign failed: ${res.error}`);
    // Host returns either `{event}` or the signed event directly.
    const signed = res?.event ?? res;
    if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
      throw new Error('nostr:sign returned an unsigned event');
    }
    return signed;
  };
}

/**
 * Upload a UTF-8 string blob to one of the default Blossom servers. Returns
 * the public URL of the stored blob (which is keyed by SHA-256 hash, so it's
 * stable across servers and restarts).
 *
 * Mirrors hive-ci-site/src/services/blossom/client.ts: try each server in
 * order, fall through on failure, throw if none accept.
 */
export async function uploadScriptToBlossom(
  bridge: WidgetBridge,
  content: string,
  servers: string[] = DEFAULT_BLOSSOM_SERVERS,
): Promise<string> {
  const signer = bridgeSigner(bridge);
  const file = new File([content], 'run-workflow.sh', {type: 'text/plain'});

  const errors: string[] = [];
  for (const server of servers) {
    try {
      const result = await Actions.uploadBlob(server, file, {
        // Force auth from the start — sovbit.host returns 401 on the SDK's
        // existence-probe HEAD before the PUT, which would otherwise short-
        // circuit before onAuth ever fires.
        auth: true,
        onAuth: async (_server, sha256, authType) => createUploadAuth(signer, sha256, {type: authType}),
      });
      return result.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${server}: ${msg}`);
      console.warn(`[blossom] upload failed for ${server}:`, msg);
    }
  }

  throw new Error(`All Blossom servers failed:\n${errors.join('\n')}`);
}

/**
 * Upload the runner script and return the args array a worker should use to
 * fetch and execute it via curl + bash.
 */
export async function buildScriptArgs(
  bridge: WidgetBridge,
  script: string,
): Promise<string[]> {
  const url = await uploadScriptToBlossom(bridge, script);
  return [
    '-c',
    `curl -fsSL "${url}" -o /tmp/run-workflow.sh && chmod +x /tmp/run-workflow.sh && /tmp/run-workflow.sh`,
  ];
}
