#!/usr/bin/env node

/**
 * Simple test to verify GRASP URL construction and push logic
 */

import { nip19 } from 'nostr-tools';

const privkey = process.argv[2] || 'cdee943cbb19c51ab847a66d5d774373aa9f63d287246bb59b0827fa5e637400';
const npub = nip19.npubEncode(privkey);
const repoName = 'test-grasp-repo';
const relayUrl = 'wss://relay.ngit.dev';

console.log('Testing GRASP URL construction:\n');
console.log('Private key:', privkey);
console.log('NPub:', npub);
console.log('Relay URL:', relayUrl);
console.log('Repo name:', repoName);

// Simulate what the code does
const httpBase = relayUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
const webUrl = `${httpBase}/${npub}/${repoName}`;
const cloneUrl = `${webUrl}.git`;

console.log('\nGenerated URLs:');
console.log('HTTP Base:', httpBase);
console.log('Web URL:', webUrl);
console.log('Clone URL:', cloneUrl);

console.log('\nExpected Git HTTP endpoint:');
console.log(`${cloneUrl}/info/refs?service=git-receive-pack`);

console.log('\nTesting endpoint availability...');

// Test if the endpoint exists
const testUrl = `${cloneUrl}/info/refs?service=git-receive-pack`;

try {
  const response = await fetch(testUrl);
  console.log(`Status: ${response.status} ${response.statusText}`);
  
  if (response.status === 404) {
    console.log('\n❌ Endpoint returns 404 - relay has not created the HTTP endpoint');
    console.log('This means either:');
    console.log('1. The repo does not exist on the relay');
    console.log('2. The relay has not set up the HTTP Smart Git service');
    console.log('3. The URL format is incorrect');
  } else if (response.status === 200) {
    console.log('\n✅ Endpoint exists! Relay is serving Git HTTP protocol');
    const text = await response.text();
    console.log('Response preview:', text.substring(0, 200));
  } else {
    console.log(`\n⚠️ Unexpected status: ${response.status}`);
  }
} catch (error) {
  console.error('\n❌ Failed to fetch:', error.message);
}
