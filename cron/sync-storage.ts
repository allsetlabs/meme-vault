#!/usr/bin/env npx tsx
/**
 * Sync Storage - Cron Job Script
 *
 * Keeps database and GitHub storage in sync:
 * 1. Remove DB clips that don't exist in GitHub
 * 2. Remove GitHub directories that don't exist in DB
 * 3. Create/update data.json for each clip
 *
 * Usage:
 *   npx tsx cron/sync-storage.ts
 *   npx tsx cron/sync-storage.ts --dry-run  # Preview changes without applying
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';

import type { Clip } from '../src/types/clip';

// ============================================================================
// Types
// ============================================================================

interface SyncResult {
  dbClipsRemoved: string[];
  githubDirsRemoved: string[];
  dataJsonCreated: string[];
  dataJsonUpdated: string[];
  dataJsonUnchanged: string[];
  errors: string[];
}

interface ClipDataJson {
  url: string;
  startSeconds: number;
  stopSeconds: number;
  caption: string;
  thumbnailSecond: number;
  name: string;
  tags: string[];
}

// ============================================================================
// Constants
// ============================================================================

const GITHUB_API = 'https://api.github.com';

// ============================================================================
// GitHub Helpers
// ============================================================================

/**
 * Get all clip directory names from GitHub.
 */
async function getGitHubClipDirs(token: string, repo: string, branch: string): Promise<string[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  // Get the tree of the root directory
  const refResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, {
    headers,
  });

  if (!refResponse.ok) {
    throw new Error(`Failed to get branch ref: ${await refResponse.text()}`);
  }

  const refData = await refResponse.json();
  const commitSha = refData.object.sha;

  const commitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${commitSha}`, {
    headers,
  });

  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${await commitResponse.text()}`);
  }

  const commitData = await commitResponse.json();
  const treeSha = commitData.tree.sha;

  // Get tree (non-recursive, just top level)
  const treeResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/trees/${treeSha}`, {
    headers,
  });

  if (!treeResponse.ok) {
    throw new Error(`Failed to get tree: ${await treeResponse.text()}`);
  }

  const treeData = await treeResponse.json();

  // Filter for directories (trees) only
  const dirs = treeData.tree
    .filter((item: { type: string }) => item.type === 'tree')
    .map((item: { path: string }) => item.path);

  return dirs;
}

/**
 * Check if a specific clip directory exists in GitHub.
 */
async function clipExistsInGitHub(
  clipId: string,
  token: string,
  repo: string,
  branch: string
): Promise<boolean> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${clipId}?ref=${branch}`, {
    headers,
  });

  return response.ok;
}

/**
 * Get data.json content from GitHub for a clip.
 */
async function getDataJsonFromGitHub(
  clipId: string,
  token: string,
  repo: string,
  branch: string
): Promise<ClipDataJson | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${clipId}/data.json?ref=${branch}`,
    { headers }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

/**
 * Create or update data.json in GitHub for a clip.
 */
async function upsertDataJsonInGitHub(
  clipId: string,
  clipData: ClipDataJson,
  token: string,
  repo: string,
  branch: string,
  existingSha?: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  const content = Buffer.from(JSON.stringify(clipData, null, 2)).toString('base64');

  const body: Record<string, unknown> = {
    message: existingSha ? `Update data.json for ${clipId}` : `Create data.json for ${clipId}`,
    content,
    branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/${clipId}/data.json`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to upsert data.json: ${await response.text()}`);
  }
}

/**
 * Get the SHA of data.json file for update purposes.
 */
async function getDataJsonSha(
  clipId: string,
  token: string,
  repo: string,
  branch: string
): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/contents/${clipId}/data.json?ref=${branch}`,
    { headers }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.sha;
}

/**
 * Delete a clip directory from GitHub.
 */
async function deleteGitHubClipDir(
  clipId: string,
  token: string,
  repo: string,
  branch: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Get the current commit SHA
  const refResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, {
    headers,
  });

  if (!refResponse.ok) {
    throw new Error(`Failed to get branch ref: ${await refResponse.text()}`);
  }

  const refData = await refResponse.json();
  const latestCommitSha = refData.object.sha;

  // Get the tree SHA
  const commitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`, {
    headers,
  });

  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${await commitResponse.text()}`);
  }

  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;

  // Get full tree to find files in the clip folder
  const treeResponse = await fetch(
    `${GITHUB_API}/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`,
    { headers }
  );

  if (!treeResponse.ok) {
    throw new Error(`Failed to get tree: ${await treeResponse.text()}`);
  }

  const treeData = await treeResponse.json();
  const clipPrefix = `${clipId}/`;

  const filesToDelete = treeData.tree.filter(
    (item: { path: string; type: string }) =>
      item.path.startsWith(clipPrefix) && item.type === 'blob'
  );

  if (filesToDelete.length === 0) {
    return;
  }

  // Create delete tree items
  const deleteTreeItems = filesToDelete.map((item: { path: string }) => ({
    path: item.path,
    mode: '100644',
    type: 'blob',
    sha: null,
  }));

  // Create new tree
  const newTreeResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: deleteTreeItems,
    }),
  });

  if (!newTreeResponse.ok) {
    throw new Error(`Failed to create tree: ${await newTreeResponse.text()}`);
  }

  const newTreeData = await newTreeResponse.json();

  // Create commit
  const newCommitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: `Sync: Remove orphan clip ${clipId}`,
      tree: newTreeData.sha,
      parents: [latestCommitSha],
    }),
  });

  if (!newCommitResponse.ok) {
    throw new Error(`Failed to create commit: ${await newCommitResponse.text()}`);
  }

  const newCommitData = await newCommitResponse.json();

  // Update branch reference
  const updateRefResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      sha: newCommitData.sha,
    }),
  });

  if (!updateRefResponse.ok) {
    throw new Error(`Failed to update ref: ${await updateRefResponse.text()}`);
  }
}

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Get all clips from the database.
 */
async function getAllClips(supabase: SupabaseClient): Promise<Clip[]> {
  const { data, error } = await supabase.from('clips').select('*');

  if (error) {
    throw new Error(`Failed to fetch clips: ${error.message}`);
  }

  return data as Clip[];
}

/**
 * Delete a clip from the database.
 */
async function deleteClipFromDb(supabase: SupabaseClient, clipId: string): Promise<void> {
  const { error } = await supabase.from('clips').delete().eq('id', clipId);

  if (error) {
    throw new Error(`Failed to delete clip ${clipId}: ${error.message}`);
  }
}

// ============================================================================
// Sync Logic
// ============================================================================

/**
 * Convert DB clip to data.json format.
 */
function clipToDataJson(clip: Clip): ClipDataJson {
  return {
    url: clip.source_url,
    startSeconds: Number(clip.start_seconds),
    stopSeconds: Number(clip.stop_seconds),
    caption: clip.caption || '',
    thumbnailSecond: Number(clip.thumbnail_second),
    name: clip.name || '',
    tags: clip.tags || [],
  };
}

/**
 * Compare two data.json objects for equality.
 */
function dataJsonEquals(a: ClipDataJson, b: ClipDataJson): boolean {
  return (
    a.url === b.url &&
    a.startSeconds === b.startSeconds &&
    a.stopSeconds === b.stopSeconds &&
    a.caption === b.caption &&
    a.thumbnailSecond === b.thumbnailSecond &&
    a.name === b.name &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags)
  );
}

/**
 * Main sync function.
 */
async function syncStorage(dryRun: boolean = false): Promise<SyncResult> {
  const result: SyncResult = {
    dbClipsRemoved: [],
    githubDirsRemoved: [],
    dataJsonCreated: [],
    dataJsonUpdated: [],
    dataJsonUnchanged: [],
    errors: [],
  };

  // Load credentials from environment
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  const githubBranch = process.env.NEXT_PUBLIC_GITHUB_BRANCH || 'main';
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!githubToken || !githubRepo) {
    throw new Error('GitHub credentials required (GITHUB_TOKEN, NEXT_PUBLIC_GITHUB_REPO)');
  }
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials required (SUPABASE_URL, SUPABASE_ANON_KEY)');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== Sync Storage ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log(`Repo: ${githubRepo}`);
  console.log(`Branch: ${githubBranch}\n`);

  // Step 1: Get all clips from DB and all directories from GitHub
  console.log('[1/3] Fetching data...');
  const dbClips = await getAllClips(supabase);
  const githubDirs = await getGitHubClipDirs(githubToken, githubRepo, githubBranch);

  console.log(`  DB clips: ${dbClips.length}`);
  console.log(`  GitHub dirs: ${githubDirs.length}\n`);

  const dbClipIds = new Set(dbClips.map((c) => c.id));
  const githubDirSet = new Set(githubDirs);

  // Step 2: Remove DB clips that don't exist in GitHub
  console.log('[2/3] Checking for orphan DB clips...');
  for (const clip of dbClips) {
    if (!githubDirSet.has(clip.id)) {
      console.log(`  Orphan DB clip: ${clip.id}`);
      if (!dryRun) {
        try {
          await deleteClipFromDb(supabase, clip.id);
          result.dbClipsRemoved.push(clip.id);
          console.log(`    -> Removed from DB`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Failed to remove DB clip ${clip.id}: ${msg}`);
          console.error(`    -> Error: ${msg}`);
        }
      } else {
        result.dbClipsRemoved.push(clip.id);
        console.log(`    -> Would remove from DB`);
      }
    }
  }

  // Step 3: Remove GitHub directories that don't exist in DB
  console.log('\n[2/3] Checking for orphan GitHub directories...');
  for (const dir of githubDirs) {
    if (!dbClipIds.has(dir)) {
      console.log(`  Orphan GitHub dir: ${dir}`);
      if (!dryRun) {
        try {
          await deleteGitHubClipDir(dir, githubToken, githubRepo, githubBranch);
          result.githubDirsRemoved.push(dir);
          console.log(`    -> Removed from GitHub`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Failed to remove GitHub dir ${dir}: ${msg}`);
          console.error(`    -> Error: ${msg}`);
        }
      } else {
        result.githubDirsRemoved.push(dir);
        console.log(`    -> Would remove from GitHub`);
      }
    }
  }

  // Step 4: Sync data.json for all valid clips
  console.log('\n[3/3] Syncing data.json files...');

  // Only process clips that exist in both DB and GitHub
  const validClips = dbClips.filter((c) => githubDirSet.has(c.id));

  for (const clip of validClips) {
    const expectedData = clipToDataJson(clip);

    try {
      const existingData = await getDataJsonFromGitHub(
        clip.id,
        githubToken,
        githubRepo,
        githubBranch
      );

      if (!existingData) {
        // data.json doesn't exist - create it
        console.log(`  ${clip.id}: data.json missing`);
        if (!dryRun) {
          await upsertDataJsonInGitHub(
            clip.id,
            expectedData,
            githubToken,
            githubRepo,
            githubBranch
          );
          console.log(`    -> Created`);
        } else {
          console.log(`    -> Would create`);
        }
        result.dataJsonCreated.push(clip.id);
      } else if (!dataJsonEquals(existingData, expectedData)) {
        // data.json exists but is different - update it
        console.log(`  ${clip.id}: data.json outdated`);
        if (!dryRun) {
          const sha = await getDataJsonSha(clip.id, githubToken, githubRepo, githubBranch);
          await upsertDataJsonInGitHub(
            clip.id,
            expectedData,
            githubToken,
            githubRepo,
            githubBranch,
            sha || undefined
          );
          console.log(`    -> Updated`);
        } else {
          console.log(`    -> Would update`);
        }
        result.dataJsonUpdated.push(clip.id);
      } else {
        // data.json is up to date
        result.dataJsonUnchanged.push(clip.id);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to sync data.json for ${clip.id}: ${msg}`);
      console.error(`  ${clip.id}: Error - ${msg}`);
    }
  }

  return result;
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Sync Storage - Cron Job Script
===============================

Keeps database and GitHub storage in sync:
1. Remove DB clips that don't exist in GitHub
2. Remove GitHub directories that don't exist in DB
3. Create/update data.json for each clip

Usage: npx tsx cron/sync-storage.ts [options]

Options:
  --dry-run    Preview changes without applying them
  --help       Show this help

Required Environment Variables:
  GITHUB_TOKEN              GitHub personal access token
  NEXT_PUBLIC_GITHUB_REPO   GitHub repo (owner/repo)
  SUPABASE_URL              Supabase project URL
  SUPABASE_ANON_KEY         Supabase anon key

Optional Environment Variables:
  NEXT_PUBLIC_GITHUB_BRANCH GitHub branch (default: main)

Examples:
  # Preview what would change
  npx tsx cron/sync-storage.ts --dry-run

  # Actually sync
  npx tsx cron/sync-storage.ts
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  try {
    const result = await syncStorage(values['dry-run']);

    console.log('\n=== Sync Summary ===\n');
    console.log(`DB clips removed:      ${result.dbClipsRemoved.length}`);
    console.log(`GitHub dirs removed:   ${result.githubDirsRemoved.length}`);
    console.log(`data.json created:     ${result.dataJsonCreated.length}`);
    console.log(`data.json updated:     ${result.dataJsonUpdated.length}`);
    console.log(`data.json unchanged:   ${result.dataJsonUnchanged.length}`);
    console.log(`Errors:                ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((e) => console.log(`  - ${e}`));
    }

    if (values['dry-run']) {
      console.log('\n[DRY RUN] No changes were made.');
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('sync-storage');
if (isMainModule) {
  main();
}

export { syncStorage };
