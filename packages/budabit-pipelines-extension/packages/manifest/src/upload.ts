import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { basename } from 'path';
import { finalizeEvent } from 'nostr-tools';
import type { Nip46Client } from './nip46.js';

export interface UploadResult {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

export interface BlossomUploadOptions {
  servers: string[];
  filePath: string;
  secretKey?: Uint8Array;
  nip46Client?: Nip46Client;
}

export interface GithubReleaseOptions {
  owner: string;
  repo: string;
  tag: string;
  filePath: string;
  token: string;
  createRelease?: boolean;
}

const BLOSSOM_AUTH_KIND = 24242;

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function createBlossomUploadAuth(
  sha256: string,
  secretKey?: Uint8Array,
  nip46Client?: Nip46Client
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  const unsignedEvent = {
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', expiration.toString()],
    ],
    content: 'Upload extension artifact',
  };

  let signedEvent;

  if (nip46Client) {
    signedEvent = await nip46Client.signEvent({
      ...unsignedEvent,
      pubkey: nip46Client.userPublicKey || '',
    });
  } else if (secretKey) {
    signedEvent = finalizeEvent(unsignedEvent, secretKey);
  } else {
    throw new Error('No signing method available for Blossom auth');
  }

  // Encode as base64 for Authorization header
  const authJson = JSON.stringify(signedEvent);
  return `Nostr ${Buffer.from(authJson).toString('base64')}`;
}

export async function uploadToBlossom(options: BlossomUploadOptions): Promise<UploadResult[]> {
  const { servers, filePath, secretKey, nip46Client } = options;

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileData = readFileSync(filePath);
  const sha256 = computeSha256(fileData);
  const fileName = basename(filePath);
  const mimeType = fileName.endsWith('.html') ? 'text/html' : 'application/octet-stream';

  console.log(`📦 Uploading ${fileName} (${fileData.length} bytes, sha256: ${sha256.substring(0, 16)}...)`);

  const authHeader = await createBlossomUploadAuth(sha256, secretKey, nip46Client);

  const results: UploadResult[] = [];

  for (const server of servers) {
    const serverUrl = server.endsWith('/') ? server.slice(0, -1) : server;
    const uploadUrl = `${serverUrl}/upload`;

    console.log(`   📤 Uploading to ${serverUrl}...`);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': mimeType,
          'X-SHA-256': sha256,
        },
        body: fileData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`   ❌ Failed: ${response.status} - ${errorText}`);
        continue;
      }

      const result = await response.json() as { url?: string; sha256?: string; size?: number; type?: string };

      results.push({
        url: result.url || `${serverUrl}/${sha256}`,
        sha256: result.sha256 || sha256,
        size: result.size || fileData.length,
        type: result.type || mimeType,
      });

      console.log(`   ✅ Uploaded: ${result.url || `${serverUrl}/${sha256}`}`);
    } catch (error) {
      console.error(`   ❌ Error uploading to ${serverUrl}:`, error);
    }
  }

  return results;
}

export async function uploadToGithubRelease(options: GithubReleaseOptions): Promise<UploadResult> {
  const { owner, repo, tag, filePath, token, createRelease = true } = options;

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileData = readFileSync(filePath);
  const fileName = basename(filePath);
  const sha256 = computeSha256(fileData);
  const mimeType = fileName.endsWith('.html') ? 'text/html' : 'application/octet-stream';

  console.log(`📦 Uploading ${fileName} to GitHub Release ${owner}/${repo}@${tag}`);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Get or create release
  let releaseId: number;
  let uploadUrl: string;

  // Try to get existing release by tag
  const getReleaseResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
    { headers }
  );

  if (getReleaseResponse.ok) {
    const release = await getReleaseResponse.json() as { id: number; upload_url: string };
    releaseId = release.id;
    uploadUrl = release.upload_url;
    console.log(`   📋 Found existing release: ${releaseId}`);
  } else if (createRelease) {
    // Create new release
    console.log(`   📝 Creating new release for tag ${tag}...`);

    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tag_name: tag,
          name: `Release ${tag}`,
          body: `Extension artifacts for ${tag}`,
          draft: false,
          prerelease: false,
        }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create release: ${createResponse.status} - ${errorText}`);
    }

    const release = await createResponse.json() as { id: number; upload_url: string };
    releaseId = release.id;
    uploadUrl = release.upload_url;
    console.log(`   ✅ Created release: ${releaseId}`);
  } else {
    throw new Error(`Release ${tag} not found and createRelease is false`);
  }

  // Upload asset
  // uploadUrl format: https://uploads.github.com/repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}
  const assetUploadUrl = uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(fileName)}`);

  console.log(`   📤 Uploading asset...`);

  const uploadResponse = await fetch(assetUploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': mimeType,
      'Content-Length': fileData.length.toString(),
    },
    body: fileData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Failed to upload asset: ${uploadResponse.status} - ${errorText}`);
  }

  const asset = await uploadResponse.json() as { browser_download_url: string; size: number };

  console.log(`   ✅ Uploaded: ${asset.browser_download_url}`);

  return {
    url: asset.browser_download_url,
    sha256,
    size: asset.size,
    type: mimeType,
  };
}

export function getArtifactPath(distDir: string): string {
  // Look for the built iframe app
  const possiblePaths = [
    `${distDir}/index.html`,
    `${distDir}/iframe-app/index.html`,
    `${distDir}/../packages/iframe-app/dist/index.html`,
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(`No artifact found. Looked in: ${possiblePaths.join(', ')}`);
}
