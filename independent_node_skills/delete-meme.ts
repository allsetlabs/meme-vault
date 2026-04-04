#!/usr/bin/env npx tsx
/**
 * Delete a meme from Meme Vault.
 * Removes the clip from Supabase, GitHub, and Instagram.
 *
 * Usage:
 *   npx tsx delete-meme.ts --clip-id <id> --env-path <env-file>
 *
 * Examples:
 *   npx tsx delete-meme.ts --clip-id abc123_20240101 --env-path ../.env
 *   npx tsx delete-meme.ts --clip-id abc123_20240101 --env-path ../.env --skip-instagram
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';
import { deleteGitHubClip, type DeleteGitHubClipOptions } from './upload-github';
import { deleteInstagramReel, type DeleteInstagramReelOptions } from './upload-instagram';

// ============================================================================
// Types
// ============================================================================

export interface DeleteMemeOptions {
  clipId: string;
  supabaseUrl: string;
  supabaseKey: string;
  githubToken: string;
  githubRepo: string;
  githubBranch: string;
  instagramAccessToken?: string;
  skipInstagram?: boolean;
}

export interface DeleteMemeResult {
  success: boolean;
  clipId: string;
  deletedFrom: {
    supabase: boolean;
    github: boolean;
    instagram: boolean;
  };
  errors: string[];
}

interface ClipRecord {
  id: string;
  insta_reel_link: string | null;
}

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

/**
 * Extract Instagram reel ID from permalink URL.
 * URL format: https://www.instagram.com/reel/{mediaId}/
 */
function extractReelIdFromUrl(url: string): string | null {
  const match = url.match(/\/reel\/([^/]+)/);
  return match ? match[1] : null;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Delete a meme from Meme Vault.
 *
 * Deletion order:
 * 1. Fetch clip from Supabase to get Instagram reel link
 * 2. Delete from Instagram (if reel exists)
 * 3. Delete from GitHub
 * 4. Delete from Supabase
 *
 * If any step fails, continue with remaining steps and report errors.
 */
export async function deleteMeme(options: DeleteMemeOptions): Promise<DeleteMemeResult> {
  const {
    clipId,
    supabaseUrl,
    supabaseKey,
    githubToken,
    githubRepo,
    githubBranch,
    instagramAccessToken,
    skipInstagram = false,
  } = options;

  const result: DeleteMemeResult = {
    success: false,
    clipId,
    deletedFrom: {
      supabase: false,
      github: false,
      instagram: false,
    },
    errors: [],
  };

  // Step 1: Fetch clip from Supabase to get Instagram reel link
  console.log(`\n=== Fetching clip ${clipId} from Supabase ===\n`);

  let clipRecord: ClipRecord | null = null;
  try {
    const fetchResponse = await fetch(
      `${supabaseUrl}/rest/v1/clips?id=eq.${clipId}&select=id,insta_reel_link`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch clip: ${await fetchResponse.text()}`);
    }

    const clips = await fetchResponse.json();
    if (clips.length === 0) {
      throw new Error(`Clip ${clipId} not found in database`);
    }

    clipRecord = clips[0] as ClipRecord;
    console.log(`Found clip: ${clipId}`);
    if (clipRecord.insta_reel_link) {
      console.log(`Instagram reel: ${clipRecord.insta_reel_link}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Supabase fetch: ${msg}`);
    console.error(`Error fetching clip: ${msg}`);
    // Continue anyway - we'll try to delete from GitHub and Instagram if we have the clip ID
  }

  // Step 2: Delete from Instagram (if reel exists and not skipped)
  if (!skipInstagram && clipRecord?.insta_reel_link && instagramAccessToken) {
    console.log(`\n=== Deleting from Instagram ===\n`);

    const reelId = extractReelIdFromUrl(clipRecord.insta_reel_link);
    if (reelId) {
      try {
        const instagramOptions: DeleteInstagramReelOptions = {
          reelId,
          accessToken: instagramAccessToken,
        };

        await deleteInstagramReel(instagramOptions);
        result.deletedFrom.instagram = true;
        console.log(`Deleted Instagram reel: ${reelId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Instagram: ${msg}`);
        console.error(`Error deleting from Instagram: ${msg}`);
      }
    } else {
      console.log(`Could not extract reel ID from URL: ${clipRecord.insta_reel_link}`);
    }
  } else if (skipInstagram) {
    console.log('\n=== Skipping Instagram deletion (--skip-instagram) ===\n');
  } else if (!clipRecord?.insta_reel_link) {
    console.log('\n=== No Instagram reel to delete ===\n');
  } else if (!instagramAccessToken) {
    console.log('\n=== Skipping Instagram (no access token) ===\n');
  }

  // Step 3: Delete from GitHub
  console.log(`\n=== Deleting from GitHub ===\n`);

  try {
    const githubOptions: DeleteGitHubClipOptions = {
      clipId,
      token: githubToken,
      repo: githubRepo,
      branch: githubBranch,
    };

    await deleteGitHubClip(githubOptions);
    result.deletedFrom.github = true;
    console.log(`Deleted GitHub folder: ${clipId}/`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`GitHub: ${msg}`);
    console.error(`Error deleting from GitHub: ${msg}`);
  }

  // Step 4: Delete from Supabase
  console.log(`\n=== Deleting from Supabase ===\n`);

  try {
    const deleteResponse = await fetch(`${supabaseUrl}/rest/v1/clips?id=eq.${clipId}`, {
      method: 'DELETE',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!deleteResponse.ok) {
      throw new Error(`Failed to delete from Supabase: ${await deleteResponse.text()}`);
    }

    result.deletedFrom.supabase = true;
    console.log(`Deleted from Supabase: ${clipId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Supabase delete: ${msg}`);
    console.error(`Error deleting from Supabase: ${msg}`);
  }

  // Determine overall success
  result.success = result.deletedFrom.supabase && result.deletedFrom.github;

  return result;
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Delete Meme
===========

Delete a meme from Meme Vault (Supabase, GitHub, and Instagram).

Usage: npx tsx delete-meme.ts [options]

Required:
  --clip-id <id>      Clip ID (git directory name, e.g., "abc123_20240101")
  --env-path <path>   Path to env file containing credentials

Optional:
  --skip-instagram    Skip Instagram deletion
  --help              Show this help

Environment Variables (from env file):
  SUPABASE_URL                 Supabase project URL (required)
  SUPABASE_ANON_KEY            Supabase anon key (required)
  GITHUB_TOKEN                 GitHub personal access token (required)
  NEXT_PUBLIC_GITHUB_REPO      Repository in format owner/repo (required)
  NEXT_PUBLIC_GITHUB_BRANCH    Branch (default: main)
  INSTAGRAM_ACCESS_TOKEN       Instagram access token (optional)

Examples:
  npx tsx delete-meme.ts --clip-id abc123_20240101 --env-path ../.env
  npx tsx delete-meme.ts --clip-id abc123_20240101 --env-path ../.env --skip-instagram
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'clip-id': { type: 'string' },
      'env-path': { type: 'string' },
      'skip-instagram': { type: 'boolean', default: false },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values['clip-id'] || !values['env-path']) {
    console.error('Error: --clip-id and --env-path are required');
    printUsage();
    process.exit(1);
  }

  // Load credentials from env file
  const envPath = resolve(values['env-path']);
  const env = parseEnvFile(envPath);

  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const GITHUB_REPO = env.NEXT_PUBLIC_GITHUB_REPO;
  const GITHUB_BRANCH = env.NEXT_PUBLIC_GITHUB_BRANCH || 'main';
  const INSTAGRAM_ACCESS_TOKEN = env.INSTAGRAM_ACCESS_TOKEN;

  console.log(`Using env: ${envPath}`);
  console.log(`Clip ID: ${values['clip-id']}`);
  console.log(`Repo: ${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}\n`);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY are required in env file');
    process.exit(1);
  }

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('Error: GITHUB_TOKEN and NEXT_PUBLIC_GITHUB_REPO are required in env file');
    process.exit(1);
  }

  try {
    const result = await deleteMeme({
      clipId: values['clip-id'],
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_ANON_KEY,
      githubToken: GITHUB_TOKEN,
      githubRepo: GITHUB_REPO,
      githubBranch: GITHUB_BRANCH,
      instagramAccessToken: INSTAGRAM_ACCESS_TOKEN,
      skipInstagram: values['skip-instagram'],
    });

    console.log('\n=== Delete Complete ===\n');
    console.log(`Clip ID:    ${result.clipId}`);
    console.log(`Success:    ${result.success ? 'Yes' : 'Partial'}`);
    console.log(`\nDeleted from:`);
    console.log(`  Supabase:  ${result.deletedFrom.supabase ? '✓' : '✗'}`);
    console.log(`  GitHub:    ${result.deletedFrom.github ? '✓' : '✗'}`);
    console.log(`  Instagram: ${result.deletedFrom.instagram ? '✓' : 'N/A'}`);

    if (result.errors.length > 0) {
      console.log(`\nErrors:`);
      result.errors.forEach((err) => console.log(`  - ${err}`));
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('delete-meme');
if (isMainModule) {
  main();
}
