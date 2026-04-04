#!/usr/bin/env npx tsx
/**
 * Upload meme vault clip files to GitHub.
 * Pushes clip assets to a GitHub repository.
 *
 * Usage:
 *   npx tsx upload-github.ts --clip-id <id> --dir <path> --env-path <env-file>
 *
 * Examples:
 *   npx tsx upload-github.ts --clip-id abc123_20240101 --dir ./output --env-path ../.env
 *   npx tsx upload-github.ts --clip-id abc123 --dir ./output --env-path ../.env.development
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { parseArgs } from 'util';

// ============================================================================
// Types
// ============================================================================

export interface UploadGitHubOptions {
  clipId: string;
  localDir: string;
  token: string;
  repo: string;
  branch: string;
  files?: string[];
}

export interface UploadGitHubResult {
  success: boolean;
  clipId: string;
  repo: string;
  branch: string;
  filesUploaded: string[];
  commitSha: string;
  clipUrl: string;
}

export interface DeleteGitHubClipOptions {
  clipId: string;
  token: string;
  repo: string;
  branch: string;
}

export interface DeleteGitHubClipResult {
  success: boolean;
  clipId: string;
  commitSha: string;
}

// ============================================================================
// Constants
// ============================================================================

const GITHUB_API = 'https://api.github.com';
const DEFAULT_FILES = [
  'source.mp4',
  'video.mp4',
  'audio.mp3',
  'captioned.gif',
  'thumbnail.png',
  'data.json',
];

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

// ============================================================================
// Core Function
// ============================================================================

/**
 * Upload meme vault clip files to GitHub.
 */
export async function uploadGitHubClip(options: UploadGitHubOptions): Promise<UploadGitHubResult> {
  const { clipId, localDir, token, repo, branch, files = DEFAULT_FILES } = options;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Get the current commit SHA of the branch
  const refResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, {
    headers,
  });

  if (!refResponse.ok) {
    throw new Error(`Failed to get branch ref: ${await refResponse.text()}`);
  }

  const refData = await refResponse.json();
  const latestCommitSha = refData.object.sha;

  // Get the tree SHA of the latest commit
  const commitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`, {
    headers,
  });

  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${await commitResponse.text()}`);
  }

  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;

  // Create blobs for each file
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  const uploadedFiles: string[] = [];

  for (const fileName of files) {
    const filePath = join(localDir, fileName);
    try {
      const content = await readFile(filePath);
      const base64Content = content.toString('base64');

      // Create blob
      const blobResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: base64Content,
          encoding: 'base64',
        }),
      });

      if (!blobResponse.ok) {
        console.warn(`Failed to create blob for ${fileName}: ${await blobResponse.text()}`);
        continue;
      }

      const blobData = await blobResponse.json();

      treeItems.push({
        path: `${clipId}/${fileName}`,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });

      uploadedFiles.push(fileName);
    } catch {
      console.warn(`Skipping ${fileName}: file not found`);
    }
  }

  if (treeItems.length === 0) {
    throw new Error('No files were uploaded');
  }

  // Create tree
  const treeResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems,
    }),
  });

  if (!treeResponse.ok) {
    throw new Error(`Failed to create tree: ${await treeResponse.text()}`);
  }

  const treeData = await treeResponse.json();

  // Create commit
  const newCommitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: `Add clip: ${clipId}`,
      tree: treeData.sha,
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
      force: true,
    }),
  });

  if (!updateRefResponse.ok) {
    throw new Error(`Failed to update ref: ${await updateRefResponse.text()}`);
  }

  const clipUrl = `https://github.com/${repo}/tree/${branch}/${clipId}`;

  return {
    success: true,
    clipId,
    repo,
    branch,
    filesUploaded: uploadedFiles,
    commitSha: newCommitData.sha,
    clipUrl,
  };
}

/**
 * Delete a clip folder from GitHub.
 * Creates a new commit that removes all files in the clip folder.
 */
export async function deleteGitHubClip(
  options: DeleteGitHubClipOptions
): Promise<DeleteGitHubClipResult> {
  const { clipId, token, repo, branch } = options;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Get the current commit SHA of the branch
  const refResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`, {
    headers,
  });

  if (!refResponse.ok) {
    throw new Error(`Failed to get branch ref: ${await refResponse.text()}`);
  }

  const refData = await refResponse.json();
  const latestCommitSha = refData.object.sha;

  // Get the tree SHA of the latest commit
  const commitResponse = await fetch(`${GITHUB_API}/repos/${repo}/git/commits/${latestCommitSha}`, {
    headers,
  });

  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${await commitResponse.text()}`);
  }

  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;

  // Get the current tree to find files in the clip folder
  const treeResponse = await fetch(
    `${GITHUB_API}/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`,
    { headers }
  );

  if (!treeResponse.ok) {
    throw new Error(`Failed to get tree: ${await treeResponse.text()}`);
  }

  const treeData = await treeResponse.json();
  const clipPrefix = `${clipId}/`;

  // Find all files in the clip folder
  const filesToDelete = treeData.tree.filter(
    (item: { path: string; type: string }) =>
      item.path.startsWith(clipPrefix) && item.type === 'blob'
  );

  if (filesToDelete.length === 0) {
    console.warn(`No files found for clip ${clipId}`);
    return { success: true, clipId, commitSha: latestCommitSha };
  }

  // Create tree items that delete the files (by omitting them from new tree)
  // We need to create a tree that explicitly removes these paths
  const deleteTreeItems = filesToDelete.map((item: { path: string }) => ({
    path: item.path,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: null, // null sha means delete the file
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
      message: `Rollback: Remove clip ${clipId}`,
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
      force: true,
    }),
  });

  if (!updateRefResponse.ok) {
    throw new Error(`Failed to update ref: ${await updateRefResponse.text()}`);
  }

  return {
    success: true,
    clipId,
    commitSha: newCommitData.sha,
  };
}

/**
 * Get raw GitHub URLs for clip assets.
 */
export function getClipGitHubUrls(clipId: string, repo: string, branch: string) {
  const baseUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${clipId}`;
  return {
    source: `${baseUrl}/source.mp4`,
    video: `${baseUrl}/video.mp4`,
    audio: `${baseUrl}/audio.mp3`,
    gif: `${baseUrl}/captioned.gif`,
    thumbnail: `${baseUrl}/thumbnail.png`,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Upload GitHub Clip
==================

Upload meme vault clip files to a GitHub repository.

Usage: npx tsx upload-github.ts [options]

Required:
  --clip-id <id>      Clip ID (folder name in repo)
  --dir <path>        Local directory containing clip files
  --env-path <path>   Path to env file containing credentials

Optional:
  --files <list>      Comma-separated list of files to upload
                      (default: source.mp4,video.mp4,audio.mp3,captioned.gif,thumbnail.png)
  --help              Show this help

Environment Variables (from env file):
  GITHUB_TOKEN                GitHub personal access token (required)
  NEXT_PUBLIC_GITHUB_REPO     Repository in format owner/repo (required)
  NEXT_PUBLIC_GITHUB_BRANCH   Branch to push to (default: main)

Examples:
  npx tsx upload-github.ts --clip-id abc123_20240101 --dir ./output --env-path ../.env
  npx tsx upload-github.ts --clip-id abc123 --dir ./output --env-path ../.env.development
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'clip-id': { type: 'string' },
      dir: { type: 'string' },
      'env-path': { type: 'string' },
      files: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values['clip-id'] || !values.dir || !values['env-path']) {
    console.error('Error: --clip-id, --dir, and --env-path are required');
    printUsage();
    process.exit(1);
  }

  // Load env path
  const envPath = resolve(values['env-path']);

  // Load credentials from env file
  const env = parseEnvFile(envPath);

  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const GITHUB_REPO = env.NEXT_PUBLIC_GITHUB_REPO;
  const GITHUB_BRANCH = env.NEXT_PUBLIC_GITHUB_BRANCH || 'main';

  console.log(`Using env: ${envPath}`);
  console.log(`Repo: ${GITHUB_REPO}, Branch: ${GITHUB_BRANCH}\n`);

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('Error: GITHUB_TOKEN and NEXT_PUBLIC_GITHUB_REPO are required in env file');
    process.exit(1);
  }

  try {
    const result = await uploadGitHubClip({
      clipId: values['clip-id'],
      localDir: values.dir,
      token: GITHUB_TOKEN,
      repo: GITHUB_REPO,
      branch: GITHUB_BRANCH,
      files: values.files ? values.files.split(',').map((f) => f.trim()) : undefined,
    });

    console.log('\n=== Upload Complete ===\n');
    console.log(`Clip ID: ${result.clipId}`);
    console.log(`Repo:    ${result.repo}`);
    console.log(`Branch:  ${result.branch}`);
    console.log(`Commit:  ${result.commitSha}`);
    console.log(`\nFiles uploaded:`);
    result.filesUploaded.forEach((f) => console.log(`  - ${f}`));
    console.log(`\nView: ${result.clipUrl}`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('upload-github');
if (isMainModule) {
  main();
}
