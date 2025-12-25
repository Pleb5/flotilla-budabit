#!/usr/bin/env node

/**
 * Test GRASP push flow directly without UI
 * Usage: node test-grasp-push.mjs <hex-private-key>
 */

import { getGitWorker } from './packages/nostr-git/packages/core/dist/index.js';
import { nip19 } from 'nostr-tools';

const privkey = process.argv[2];
if (!privkey || privkey.length !== 64) {
  console.error('Usage: node test-grasp-push.mjs <hex-private-key>');
  process.exit(1);
}

const pubkey = nip19.npubEncode(privkey);
console.log(`Testing GRASP push with pubkey: ${pubkey}`);

// Mock EventIO for testing
const mockEventIO = {
  async publishEvent(event) {
    console.log('[MockEventIO] Publishing event:', {
      kind: event.kind,
      tags: event.tags.length,
      content: event.content.substring(0, 50)
    });
    return { ok: true, eventId: 'mock-event-id' };
  },
  async fetchEvents(filters) {
    console.log('[MockEventIO] Fetching events:', filters);
    return [];
  }
};

// Mock SignEvent
const mockSignEvent = async (event) => {
  console.log('[MockSignEvent] Signing event:', event.kind);
  // In real implementation, this would sign with the private key
  return {
    ...event,
    id: 'mock-signed-id',
    pubkey: privkey,
    sig: 'mock-signature'
  };
};

async function test() {
  try {
    console.log('\n1. Getting Git worker...');
    const { api, worker } = getGitWorker();
    
    console.log('\n2. Configuring EventIO...');
    await api.configureEventIO(mockEventIO);
    
    console.log('\n3. Creating local repository...');
    const repoName = `test-grasp-${Date.now()}`;
    const localRepo = await api.createLocalRepo({
      name: repoName,
      description: 'Test GRASP push',
      defaultBranch: 'master'
    });
    console.log('Local repo created:', localRepo);
    
    console.log('\n4. Creating remote GRASP repository...');
    const remoteResult = await api.createRemoteRepo({
      provider: 'grasp',
      name: repoName,
      description: 'Test GRASP push',
      token: privkey,
      baseUrl: 'wss://relay.ngit.dev'
    });
    console.log('Remote repo result:', remoteResult);
    
    if (!remoteResult.success) {
      throw new Error(`Failed to create remote: ${remoteResult.error}`);
    }
    
    console.log('\n5. Pushing to remote...');
    const pushResult = await api.safePushToRemote({
      provider: 'grasp',
      repoPath: `${privkey}:${repoName}`,
      remoteUrl: remoteResult.remoteUrl,
      defaultBranch: 'master',
      token: privkey
    });
    console.log('Push result:', pushResult);
    
    if (!pushResult.success) {
      throw new Error(`Push failed: ${pushResult.error}`);
    }
    
    console.log('\n✅ SUCCESS! GRASP push completed.');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
