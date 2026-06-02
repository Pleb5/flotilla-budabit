#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { connectToBunker, type Nip46Client } from './nip46.js';
import { uploadToBlossom, uploadToGithubRelease, getArtifactPath, type UploadResult } from './upload.js';

interface PublishOptions {
  eventPath: string;
  relays: string[];
  secretKey?: string;
  bunker?: string;
  dryRun: boolean;
  // Artifact upload options
  artifactPath?: string;
  blossomServers?: string[];
  githubRepo?: string;
  githubTag?: string;
  githubToken?: string;
  // If true, upload artifact first and update event's app URL before signing
  uploadFirst?: boolean;
}

const DEFAULT_RELAYS = [
  'wss://relay.yakihonne.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

async function publishWithLocalKey(
  unsignedEvent: import('nostr-tools').EventTemplate,
  skHex: string,
  relays: string[]
): Promise<{ signedEvent: import('nostr-tools').Event; relays: string[] }> {
  const sk = Uint8Array.from(Buffer.from(skHex, 'hex'));
  console.log('🔐 Signing event with local key...');
  const signedEvent = finalizeEvent(unsignedEvent, sk);
  return { signedEvent, relays };
}

async function publishWithBunker(
  unsignedEvent: Record<string, unknown>,
  bunkerUrl: string,
  relays: string[]
): Promise<{ signedEvent: import('nostr-tools').Event; relays: string[]; client: Nip46Client }> {
  console.log('🔗 Connecting to remote signer (NIP-46)...');
  const client = await connectToBunker(bunkerUrl);

  console.log('🔐 Requesting remote signature...');
  const signedEvent = await client.signEvent(unsignedEvent as import('nostr-tools').UnsignedEvent);

  return { signedEvent, relays, client };
}

// Helper to update the app URL in the event's button tag
function updateEventAppUrl(event: Record<string, unknown>, newAppUrl: string): void {
  if (!event.tags || !Array.isArray(event.tags)) {
    throw new Error('Event must have a tags array');
  }
  const tags = event.tags as string[][];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (!tag) continue;
    // Button tag format: ["button", label, type, url]
    if (tag[0] === 'button' && tag[2] === 'app') {
      tags[i] = [tag[0] ?? 'button', tag[1] ?? 'Open', tag[2] ?? 'app', newAppUrl];
      console.log(`   🔗 Updated app URL in event: ${newAppUrl}`);
      return;
    }
  }
  // If no app button found, add one
  tags.push(['button', 'Open', 'app', newAppUrl]);
  console.log(`   🔗 Added app URL to event: ${newAppUrl}`);
}

async function publishWidget(options: PublishOptions): Promise<void> {
  // Read the unsigned event
  const eventPath = options.eventPath;
  if (!existsSync(eventPath)) {
    throw new Error(`Event file not found: ${eventPath}`);
  }

  const eventJson = readFileSync(eventPath, 'utf-8');
  const unsignedEvent = JSON.parse(eventJson);

  // Determine signing method: bunker URL or local secret key
  const bunkerUrl = options.bunker || process.env.NOSTR_BUNKER || process.env.BUNKER_URL;
  const skHex = options.secretKey || process.env.NOSTR_SK || process.env.NOSTR_SECRET_KEY;

  // If uploadFirst is enabled, upload artifact and update event URL before signing
  let uploadedArtifactUrl: string | undefined;
  let nip46ClientForSigning: Nip46Client | undefined;
  
  if (options.uploadFirst && (options.blossomServers?.length || (options.githubRepo && options.githubTag))) {
    console.log('\n📦 Uploading artifact before signing...');
    
    try {
      const artifactPath = options.artifactPath || getArtifactPath('.');
      
      if (options.blossomServers && options.blossomServers.length > 0) {
        const sk = skHex ? Uint8Array.from(Buffer.from(skHex, 'hex')) : undefined;
        // For NIP-46, connect once and reuse for both upload and signing
        if (bunkerUrl && !sk) {
          nip46ClientForSigning = await connectToBunker(bunkerUrl);
        }
        
        const results = await uploadToBlossom({
          servers: options.blossomServers,
          filePath: artifactPath,
          secretKey: sk,
          nip46Client: nip46ClientForSigning,
        });
        
        if (results.length > 0 && results[0]) {
          uploadedArtifactUrl = results[0].url;
        }
      }
      
      if (!uploadedArtifactUrl && options.githubRepo && options.githubTag) {
        const token = options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        if (!token) {
          console.warn('⚠️  GitHub token required for GitHub upload. Skipping.');
        } else {
          const parts = options.githubRepo.split('/');
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error(`Invalid github-repo format: "${options.githubRepo}". Expected format: owner/repo`);
          }
          const [owner, repo] = parts;
          const result = await uploadToGithubRelease({
            owner,
            repo,
            tag: options.githubTag,
            filePath: artifactPath,
            token,
          });
          uploadedArtifactUrl = result.url;
        }
      }
      
      if (uploadedArtifactUrl) {
        updateEventAppUrl(unsignedEvent, uploadedArtifactUrl);
        // Update created_at to current time since we modified the event
        unsignedEvent.created_at = Math.floor(Date.now() / 1000);
      } else {
        console.warn('⚠️  No artifact uploaded, using original app URL');
      }
    } catch (error) {
      console.error('❌ Pre-signing upload failed:', error);
      console.warn('⚠️  Continuing with original app URL');
      // Clean up NIP-46 client if it was created
      if (nip46ClientForSigning) {
        nip46ClientForSigning.disconnect();
        nip46ClientForSigning = undefined;
      }
    }
  }

  if (options.dryRun) {
    console.log('🔍 Dry run mode - not publishing to relays\n');
    console.log('Event to be signed:');
    console.log(JSON.stringify(unsignedEvent, null, 2));
    if (bunkerUrl) {
      console.log('\nSigning method: NIP-46 Remote Signer');
      console.log('Bunker URL:', bunkerUrl.substring(0, 50) + '...');
    } else if (skHex) {
      const sk = Uint8Array.from(Buffer.from(skHex, 'hex'));
      console.log('\nSigning method: Local Key');
      console.log('Public key:', getPublicKey(sk));
    } else {
      console.log('\nSigning method: Not configured (set NOSTR_SK or NOSTR_BUNKER)');
    }
    console.log('Relays:', options.relays.join(', '));
    return;
  }

  if (!bunkerUrl && !skHex) {
    console.error('❌ Missing signing credentials.');
    console.error('\nProvide one of:');
    console.error('  --bunker <bunker://...>  NIP-46 remote signer URL');
    console.error('  --secret-key <hex>       Local secret key in hex format');
    console.error('\nOr set environment variables:');
    console.error('  NOSTR_BUNKER or BUNKER_URL  for NIP-46 remote signing');
    console.error('  NOSTR_SK or NOSTR_SECRET_KEY  for local signing');
    process.exit(1);
  }

  let signedEvent: import('nostr-tools').Event;
  let nip46Client: Nip46Client | undefined;

  if (bunkerUrl) {
    // Reuse existing NIP-46 client if we created one for uploadFirst
    if (nip46ClientForSigning) {
      console.log('🔐 Requesting remote signature (reusing connection)...');
      signedEvent = await nip46ClientForSigning.signEvent(unsignedEvent as import('nostr-tools').UnsignedEvent);
      nip46Client = nip46ClientForSigning;
    } else {
      const result = await publishWithBunker(unsignedEvent, bunkerUrl, options.relays);
      signedEvent = result.signedEvent;
      nip46Client = result.client;
    }
  } else {
    const result = await publishWithLocalKey(unsignedEvent, skHex!, options.relays);
    signedEvent = result.signedEvent;
  }

  console.log('📤 Publishing to relays...');
  const pool = new SimplePool();

  const relays = options.relays.length > 0 ? options.relays : DEFAULT_RELAYS;

  try {
    const results = await Promise.allSettled(
      pool.publish(relays, signedEvent)
    );

    const successful: string[] = [];
    const failed: string[] = [];

    results.forEach((result, index) => {
      const relay = relays[index];
      if (!relay) return;
      if (result.status === 'fulfilled') {
        successful.push(relay);
      } else {
        failed.push(relay);
      }
    });

    if (successful.length > 0) {
      console.log(`✅ Published to ${successful.length} relay(s):`);
      successful.forEach(r => console.log(`   - ${r}`));
    }

    if (failed.length > 0) {
      console.log(`⚠️  Failed on ${failed.length} relay(s):`);
      failed.forEach(r => console.log(`   - ${r}`));
    }
  } finally {
    pool.close(relays);
    // Disconnect NIP-46 client if used
    if (nip46Client) {
      nip46Client.disconnect();
    }
  }

  // Generate naddr
  const identifier = signedEvent.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
  const naddr = nip19.naddrEncode({
    pubkey: signedEvent.pubkey,
    kind: 30033,
    identifier,
    relays,
  });

  console.log('\n📋 Widget Details:');
  console.log(`   Event ID: ${signedEvent.id}`);
  console.log(`   Pubkey: ${signedEvent.pubkey}`);
  console.log(`   Identifier (d): ${identifier}`);
  console.log(`\n🔗 naddr (use this to install in Flotilla):`);
  console.log(`   ${naddr}`);
  console.log(`\n📦 npub:`);
  console.log(`   ${nip19.npubEncode(signedEvent.pubkey)}`);

  // Handle artifact uploads if requested
  const uploadResults: UploadResult[] = [];

  if (options.blossomServers && options.blossomServers.length > 0) {
    console.log('\n🌸 Uploading artifact to Blossom servers...');
    try {
      const artifactPath = options.artifactPath || getArtifactPath('.');
      const sk = skHex ? Uint8Array.from(Buffer.from(skHex, 'hex')) : undefined;
      const results = await uploadToBlossom({
        servers: options.blossomServers,
        filePath: artifactPath,
        secretKey: sk,
        nip46Client,
      });
      uploadResults.push(...results);
    } catch (error) {
      console.error('❌ Blossom upload failed:', error);
    }
  }

  if (options.githubRepo && options.githubTag) {
    console.log('\n🐙 Uploading artifact to GitHub Release...');
    const token = options.githubToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      console.error('❌ GitHub token required. Set GITHUB_TOKEN or use --github-token');
    } else {
      try {
        const [owner, repo] = options.githubRepo.split('/');
        if (!owner || !repo) {
          throw new Error('Invalid github-repo format. Use owner/repo');
        }
        const artifactPath = options.artifactPath || getArtifactPath('.');
        const result = await uploadToGithubRelease({
          owner,
          repo,
          tag: options.githubTag,
          filePath: artifactPath,
          token,
        });
        uploadResults.push(result);
      } catch (error) {
        console.error('❌ GitHub upload failed:', error);
      }
    }
  }

  if (uploadResults.length > 0) {
    console.log('\n📦 Uploaded Artifacts:');
    for (const result of uploadResults) {
      console.log(`   - ${result.url}`);
      console.log(`     SHA256: ${result.sha256}`);
    }
  }
}

const program = new Command();

interface CliOptions {
  event: string;
  relay: string[];
  secretKey?: string;
  bunker?: string;
  dryRun: boolean;
  artifact?: string;
  blossom?: string[];
  githubRepo?: string;
  githubTag?: string;
  githubToken?: string;
  uploadFirst: boolean;
}

program
  .name('publish-widget')
  .description('Sign and publish a Smart Widget (kind 30033) event to Nostr relays. Supports local signing, NIP-46 remote signing, and artifact uploads to Blossom/GitHub.')
  .requiredOption('--event <path>', 'Path to the unsigned event.json file', 'dist/widget/event.json')
  .option('--relay <url...>', 'Relay URLs to publish to (can specify multiple)', DEFAULT_RELAYS)
  .option('--secret-key <hex>', 'Nostr secret key in hex format (or use NOSTR_SK env var)')
  .option('--bunker <url>', 'NIP-46 bunker URL for remote signing (bunker://...)')
  .option('--dry-run', 'Show what would be published without actually publishing', false)
  .option('--upload-first', 'Upload artifact first and update event app URL before signing', false)
  .option('--artifact <path>', 'Path to the built artifact (e.g., dist/index.html)')
  .option('--blossom <url...>', 'Blossom server URLs to upload artifact to')
  .option('--github-repo <owner/repo>', 'GitHub repository for release upload (e.g., user/repo)')
  .option('--github-tag <tag>', 'GitHub release tag (e.g., v1.0.0)')
  .option('--github-token <token>', 'GitHub token (or use GITHUB_TOKEN env var)')
  .action(async (options: CliOptions) => {
    try {
      await publishWidget({
        eventPath: options.event,
        relays: options.relay,
        secretKey: options.secretKey,
        bunker: options.bunker,
        dryRun: options.dryRun,
        artifactPath: options.artifact,
        blossomServers: options.blossom,
        githubRepo: options.githubRepo,
        githubTag: options.githubTag,
        githubToken: options.githubToken,
        uploadFirst: options.uploadFirst,
      });
    } catch (error) {
      console.error('❌ Error publishing widget:', error);
      process.exit(1);
    }
  });

program.parse();
