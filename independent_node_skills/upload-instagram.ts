#!/usr/bin/env npx tsx
/**
 * Upload meme vault clip to Instagram as a Reel.
 * Uses Instagram Graph API to publish video as a Reel.
 *
 * Usage:
 *   npx tsx upload-instagram.ts --url <video-url> --caption <text> --env-path <env-file>
 *
 * Examples:
 *   npx tsx upload-instagram.ts --url "https://..." --caption "Check this out!" --env-path ../.env
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';

// ============================================================================
// Types
// ============================================================================

export interface UploadInstagramOptions {
  videoUrl: string;
  caption: string;
  accessToken: string;
  userId: string;
  maxWaitAttempts?: number;
  waitIntervalMs?: number;
}

export interface UploadInstagramResult {
  success: boolean;
  reelId: string;
  reelUrl: string;
}

export interface DeleteInstagramReelOptions {
  reelId: string;
  accessToken: string;
}

export interface DeleteInstagramReelResult {
  success: boolean;
  reelId: string;
}

interface ContainerStatusResponse {
  status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
  id?: string;
}

// ============================================================================
// Constants
// ============================================================================

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse an env file and return key-value pairs.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key] = valueParts.join('=');
      }
    }
  }
  return env;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the container status until processing is complete.
 */
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  maxAttempts: number = 30,
  intervalMs: number = 5000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const statusResponse = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code,status&access_token=${accessToken}`
    );

    if (!statusResponse.ok) {
      throw new Error(`Failed to check container status: ${await statusResponse.text()}`);
    }

    const statusData: ContainerStatusResponse = await statusResponse.json();

    switch (statusData.status_code) {
      case 'FINISHED':
        console.log('Video processing complete');
        return;

      case 'ERROR':
      case 'EXPIRED':
        throw new Error(
          `Instagram processing failed: ${statusData.status_code} - ${statusData.status || 'Unknown error'}`
        );

      case 'IN_PROGRESS':
        console.log(`Processing... (attempt ${attempt}/${maxAttempts})`);
        await sleep(intervalMs);
        break;

      default:
        console.log(`Status: ${statusData.status_code}, waiting...`);
        await sleep(intervalMs);
    }
  }

  throw new Error('Instagram video processing timed out');
}

/**
 * Get the permalink URL for a published Reel.
 */
async function getReelPermalink(mediaId: string, accessToken: string): Promise<string> {
  const response = await fetch(
    `${GRAPH_API}/${mediaId}?fields=permalink&access_token=${accessToken}`
  );

  if (!response.ok) {
    console.warn('Could not fetch permalink, using fallback URL');
    return `https://www.instagram.com/reel/${mediaId}/`;
  }

  const data = await response.json();
  return data.permalink || `https://www.instagram.com/reel/${mediaId}/`;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Upload a video as an Instagram Reel using the Graph API.
 *
 * Requirements:
 * - Instagram Business or Creator account connected to a Facebook Page
 * - Access token with permissions: instagram_basic, instagram_content_publish
 * - Video must be publicly accessible via URL (e.g., GitHub raw URL)
 * - Video specs: MP4, H264, max 90 seconds, 9:16 aspect ratio recommended
 */
export async function uploadInstagramReel(
  options: UploadInstagramOptions
): Promise<UploadInstagramResult> {
  const {
    videoUrl,
    caption,
    accessToken,
    userId,
    maxWaitAttempts = 30,
    waitIntervalMs = 5000,
  } = options;

  // Step 1: Create media container for Reel
  console.log('Creating Instagram Reel container...');
  const containerResponse = await fetch(`${GRAPH_API}/${userId}/media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption,
      access_token: accessToken,
    }),
  });

  if (!containerResponse.ok) {
    const error = await containerResponse.text();
    throw new Error(`Failed to create Instagram container: ${error}`);
  }

  const containerData = await containerResponse.json();
  const containerId = containerData.id;
  console.log(`Container created: ${containerId}`);

  // Step 2: Wait for video processing to complete
  console.log('Waiting for Instagram video processing...');
  await waitForContainerReady(containerId, accessToken, maxWaitAttempts, waitIntervalMs);

  // Step 3: Publish the container
  console.log('Publishing Instagram Reel...');
  const publishResponse = await fetch(`${GRAPH_API}/${userId}/media_publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });

  if (!publishResponse.ok) {
    const error = await publishResponse.text();
    throw new Error(`Failed to publish Instagram Reel: ${error}`);
  }

  const publishData = await publishResponse.json();
  const reelId = publishData.id;

  // Get the permalink for the published Reel
  const reelUrl = await getReelPermalink(reelId, accessToken);

  console.log(`Reel published: ${reelUrl}`);

  return {
    success: true,
    reelId,
    reelUrl,
  };
}

/**
 * Delete an Instagram Reel using the Graph API.
 *
 * Note: Requires instagram_content_publish permission.
 * The media must belong to the authenticated user.
 */
export async function deleteInstagramReel(
  options: DeleteInstagramReelOptions
): Promise<DeleteInstagramReelResult> {
  const { reelId, accessToken } = options;

  console.log(`Deleting Instagram Reel: ${reelId}...`);

  const response = await fetch(`${GRAPH_API}/${reelId}?access_token=${accessToken}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete Instagram Reel: ${error}`);
  }

  console.log(`Reel ${reelId} deleted successfully`);

  return {
    success: true,
    reelId,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Upload Instagram Reel
=====================

Upload a video as an Instagram Reel using the Graph API.

Usage: npx tsx upload-instagram.ts [options]

Required:
  --url <url>         Public URL to the video file (must be accessible by Instagram)
  --caption <text>    Caption for the Reel
  --env-path <path>   Path to env file containing credentials

Optional:
  --max-wait <n>      Max attempts to wait for processing (default: 30)
  --interval <ms>     Wait interval between status checks (default: 5000)
  --help              Show this help

Environment Variables (from env file):
  INSTAGRAM_ACCESS_TOKEN   Instagram Graph API access token (required)
  INSTAGRAM_USER_ID        Instagram Business/Creator account ID (required)

Requirements:
  - Instagram Business or Creator account connected to a Facebook Page
  - Access token with permissions: instagram_basic, instagram_content_publish
  - Video must be publicly accessible via URL (e.g., GitHub raw URL)
  - Video specs: MP4, H264, max 90 seconds, 9:16 aspect ratio recommended

Examples:
  npx tsx upload-instagram.ts --url "https://..." --caption "Check this out!" --env-path ../.env
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      caption: { type: 'string' },
      'env-path': { type: 'string' },
      'max-wait': { type: 'string' },
      interval: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values.url || !values.caption || !values['env-path']) {
    console.error('Error: --url, --caption, and --env-path are required');
    printUsage();
    process.exit(1);
  }

  // Load credentials from env file
  const envPath = resolve(values['env-path']);
  const env = parseEnvFile(envPath);

  const INSTAGRAM_ACCESS_TOKEN = env.INSTAGRAM_ACCESS_TOKEN;
  const INSTAGRAM_USER_ID = env.INSTAGRAM_USER_ID;

  console.log(`Using env: ${envPath}`);
  console.log(`User ID: ${INSTAGRAM_USER_ID}\n`);

  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_USER_ID) {
    console.error('Error: INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID are required in env file');
    process.exit(1);
  }

  try {
    const result = await uploadInstagramReel({
      videoUrl: values.url,
      caption: values.caption,
      accessToken: INSTAGRAM_ACCESS_TOKEN,
      userId: INSTAGRAM_USER_ID,
      maxWaitAttempts: values['max-wait'] ? parseInt(values['max-wait']) : undefined,
      waitIntervalMs: values.interval ? parseInt(values.interval) : undefined,
    });

    console.log('\n=== Upload Complete ===\n');
    console.log(`Reel ID:  ${result.reelId}`);
    console.log(`Reel URL: ${result.reelUrl}`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('upload-instagram');
if (isMainModule) {
  main();
}
