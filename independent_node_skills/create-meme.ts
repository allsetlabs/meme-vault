#!/usr/bin/env npx tsx
/**
 * Create Meme - Complete Pipeline
 *
 * All steps are mandatory:
 * 1. Download video from YouTube URL
 * 2. Add caption to video
 * 3. Convert to GIF
 * 4. Create thumbnail
 * 5. Extract audio
 * 6. Upload to GitHub
 * 7. Upload to Instagram
 * 8. Save to database
 *
 * Usage:
 *   npx tsx create-meme.ts --url <youtube-url> --start 10 --stop 20 --caption "Hello!"
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { parseArgs } from 'util';
import { tmpdir } from 'os';

import { addCaptionToVideo, scaleVideo } from './add-caption-to-video';
import { videoToThumbnail } from './video-to-thumbnail';
import { videoToGif } from './video-to-gif';
import { downloadYtVideo } from './download-yt-video';
import { uploadGitHubClip, getClipGitHubUrls, deleteGitHubClip } from './upload-github';
import { uploadInstagramReel, deleteInstagramReel } from './upload-instagram';

import type { Clip } from '../src/types/clip';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface CreateMemeOptions {
  // Source - required
  url: string;
  startSeconds: number;
  stopSeconds: number;

  // Output
  outputPath?: string;
  clipId?: string;

  // Video options
  caption?: string;
  thumbnailSecond?: number;
  videoWidth?: number;
  gifFps?: number;
  gifMaxColors?: number;

  // Credentials (can also use env vars)
  githubToken?: string;
  githubRepo?: string;
  githubBranch?: string;
  instagramAccessToken?: string;
  instagramUserId?: string;
  supabaseUrl?: string;
  supabaseKey?: string;

  // Metadata for DB
  name?: string;
  tags?: string[];

  // User tracking (required)
  createdBy: string;
}

export interface CreateMemeResult {
  clipId: string;
  outputDir: string;
  files: {
    source: string;
    video: string;
    audio: string;
    gif: string;
    thumbnail: string;
  };
  duration: number;
  success: boolean;

  // Upload results
  githubUrl: string;
  githubUrls: {
    source: string;
    video: string;
    audio: string;
    gif: string;
    thumbnail: string;
  };
  instagramReelUrl: string;
  dbSaved: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get video duration using ffprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Extract audio as MP3.
 */
async function extractAudio(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`ffmpeg -y -i "${inputPath}" -vn -acodec libmp3lame -ab 128k "${outputPath}"`);
    return true;
  } catch (error) {
    console.error('Extract audio failed:', error);
    return false;
  }
}

/**
 * Extract YouTube video ID from URL.
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:v=|\/)([\w-]{11})(?:\?|&|$)/,
    /youtu\.be\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
    /shorts\/([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Generate a unique clip ID.
 */
function generateClipId(videoId: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
    .replace(/(\d{8})(\d{6})/, '$1_$2');
  return `${videoId}_${timestamp}`;
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Create all meme assets from a YouTube URL.
 *
 * Complete pipeline (all steps mandatory):
 * 1. Download video from YouTube
 * 2. Create captioned video.mp4
 * 3. Extract audio.mp3
 * 4. Create captioned.gif
 * 5. Create thumbnail.png
 * 6. Upload to GitHub
 * 7. Upload to Instagram
 * 8. Save to database
 */
export async function createMeme(options: CreateMemeOptions): Promise<CreateMemeResult> {
  const {
    url,
    startSeconds,
    stopSeconds,
    outputPath,
    clipId: providedClipId,
    caption,
    thumbnailSecond = 0,
    videoWidth = 480,
    gifFps = 10,
    gifMaxColors = 64,
    githubToken = process.env.GITHUB_TOKEN,
    githubRepo = process.env.NEXT_PUBLIC_GITHUB_REPO,
    githubBranch = process.env.NEXT_PUBLIC_GITHUB_BRANCH || 'main',
    instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN,
    instagramUserId = process.env.INSTAGRAM_USER_ID,
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseKey = process.env.SUPABASE_ANON_KEY,
    name,
    tags = [],
    createdBy,
  } = options;

  // Validate required credentials
  if (!githubToken || !githubRepo) {
    throw new Error('GitHub credentials required (GITHUB_TOKEN, NEXT_PUBLIC_GITHUB_REPO)');
  }
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials required (SUPABASE_URL, SUPABASE_ANON_KEY)');
  }

  // Instagram is optional
  const hasInstagramCreds = Boolean(instagramAccessToken && instagramUserId);

  // Generate clip ID
  let clipId = providedClipId;
  if (!clipId) {
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error('Could not extract video ID from URL');
    }
    clipId = generateClipId(videoId);
  }

  // Determine output directory
  const outputDir = outputPath || join(tmpdir(), 'meme-vault', clipId);
  console.log('Output directory:', outputDir);
  await mkdir(outputDir, { recursive: true });

  // Define output paths
  const sourcePath = join(outputDir, 'source.mp4');
  const videoPath = join(outputDir, 'video.mp4');
  const audioPath = join(outputDir, 'audio.mp3');
  const gifPath = join(outputDir, 'captioned.gif');
  const thumbnailPath = join(outputDir, 'thumbnail.png');

  console.log('\n\x1b[32m=== Create Meme Pipeline ===\x1b[0m\n');
  console.log(`Clip ID: ${clipId}`);
  console.log(`URL: ${url}`);
  if (caption) console.log(`Caption: "${caption}"`);
  console.log('');

  // Step 1: Download video
  console.log('[1/8] Downloading video...');
  const downloadResult = await downloadYtVideo({
    url,
    outputPath: outputDir,
    startSeconds,
    stopSeconds,
    quality: 'worst',
    filename: 'source.mp4',
  });

  if (!downloadResult.success) {
    throw new Error('Failed to download video');
  }
  console.log('[1/8] Download complete');

  // Get duration
  const duration = await getVideoDuration(sourcePath);
  if (!duration) {
    throw new Error('Could not determine video duration');
  }

  // Validate thumbnail time
  const validThumbnailSecond = thumbnailSecond > duration ? 0 : thumbnailSecond;
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Thumbnail at: ${validThumbnailSecond}s`);
  console.log('');

  // Step 2 & 3: Create captioned video and extract audio in parallel
  console.log('[2/8] Creating captioned video...');
  const [videoResult] = await Promise.all([
    caption
      ? addCaptionToVideo({
          inputPath: sourcePath,
          outputPath: videoPath,
          caption,
          videoWidth,
        })
      : scaleVideo(sourcePath, videoPath, videoWidth),
    extractAudio(sourcePath, audioPath).then((success) => {
      if (success) console.log('[3/8] Audio extracted');
      return success;
    }),
  ]);

  if (!videoResult.success) {
    throw new Error('Failed to create captioned video');
  }
  console.log('[2/8] Captioned video created');

  // Step 4: Create GIF from captioned video
  console.log('[4/8] Converting to GIF...');
  const gifResult = await videoToGif({
    inputPath: videoPath,
    outputPath: gifPath,
    width: videoWidth,
    fps: gifFps,
    maxColors: gifMaxColors,
  });

  if (!gifResult.success) {
    throw new Error('Failed to create GIF');
  }
  console.log('[4/8] GIF created');

  // Step 5: Create thumbnail from captioned video
  console.log('[5/8] Creating thumbnail...');
  const thumbnailResult = await videoToThumbnail({
    inputPath: videoPath,
    outputPath: thumbnailPath,
    timestampSeconds: validThumbnailSecond,
  });

  if (!thumbnailResult.success) {
    throw new Error('Failed to create thumbnail');
  }
  console.log('[5/8] Thumbnail created');

  // Create data.json with user-provided data before GitHub upload
  const clipUserData = {
    url,
    startSeconds,
    stopSeconds,
    caption: caption || '',
    thumbnailSecond: validThumbnailSecond,
    name: name || '',
    tags: tags.length > 0 ? tags : [],
  };

  const dataJsonPath = join(outputDir, 'data.json');
  await writeFile(dataJsonPath, JSON.stringify(clipUserData, null, 2));
  console.log('[5.5/8] Created data.json');

  // Track what was uploaded for rollback purposes
  let githubUploaded = false;
  let instagramUploaded = false;
  let instaReelId: string | undefined;

  // Helper function to rollback uploads on failure
  async function rollbackUploads(
    rollbackGitHub: boolean,
    rollbackInstagram: boolean
  ): Promise<void> {
    const rollbackErrors: string[] = [];

    if (rollbackInstagram && instagramUploaded && instaReelId) {
      console.log('[ROLLBACK] Deleting Instagram Reel...');
      try {
        await deleteInstagramReel({
          reelId: instaReelId,
          accessToken: instagramAccessToken!, // Already validated at function start
        });
        console.log('[ROLLBACK] Instagram Reel deleted');
      } catch (rollbackError) {
        const msg = rollbackError instanceof Error ? rollbackError.message : 'Unknown error';
        rollbackErrors.push(`Instagram rollback failed: ${msg}`);
        console.error('[ROLLBACK] Failed to delete Instagram Reel:', msg);
      }
    }

    if (rollbackGitHub && githubUploaded) {
      console.log('[ROLLBACK] Deleting GitHub clip folder...');
      try {
        await deleteGitHubClip({
          clipId: clipId!, // Already assigned earlier in function
          token: githubToken!, // Already validated at function start
          repo: githubRepo!, // Already validated at function start
          branch: githubBranch,
        });
        console.log('[ROLLBACK] GitHub clip folder deleted');
      } catch (rollbackError) {
        const msg = rollbackError instanceof Error ? rollbackError.message : 'Unknown error';
        rollbackErrors.push(`GitHub rollback failed: ${msg}`);
        console.error('[ROLLBACK] Failed to delete GitHub clip:', msg);
      }
    }

    if (rollbackErrors.length > 0) {
      console.error('[ROLLBACK] Some rollback operations failed:', rollbackErrors.join('; '));
    }
  }

  // Step 6: Upload to GitHub
  console.log('[6/8] Uploading to GitHub...');
  const githubResult = await uploadGitHubClip({
    clipId,
    localDir: outputDir,
    token: githubToken,
    repo: githubRepo,
    branch: githubBranch,
  });
  githubUploaded = true;
  const githubUrls = getClipGitHubUrls(clipId, githubRepo, githubBranch);
  console.log(`[6/8] GitHub upload complete: ${githubResult.clipUrl}`);

  // Step 7: Upload to Instagram (optional - rollback GitHub on failure)
  let instaResult: { reelId: string; reelUrl: string } | undefined;
  if (hasInstagramCreds) {
    console.log('[7/8] Uploading to Instagram...');
    try {
      instaResult = await uploadInstagramReel({
        videoUrl: githubUrls.video,
        caption: caption || '',
        accessToken: instagramAccessToken!,
        userId: instagramUserId!,
      });
      instagramUploaded = true;
      instaReelId = instaResult.reelId;
      console.log(`[7/8] Instagram upload complete: ${instaResult.reelUrl}`);
    } catch (instaError) {
      console.error('[7/8] Instagram upload failed, rolling back GitHub...');
      await rollbackUploads(true, false);
      throw instaError;
    }
  } else {
    console.log('[7/8] Skipping Instagram upload (no credentials)');
  }

  // Step 8: Save to database (rollback both on failure)
  console.log('[8/8] Saving to database...');
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const clipData: Omit<Clip, 'created_at'> = {
    id: clipId,
    name: name || '',
    tags,
    source_url: url,
    start_seconds: startSeconds,
    stop_seconds: stopSeconds,
    caption: caption || '',
    thumbnail_second: validThumbnailSecond,
    approved: false,
    insta_reel_link: instaResult?.reelUrl || '',
    createdBy,
    updatedBy: null,
  };

  const { error: insertError } = await supabase.from('clips').insert(clipData);

  if (insertError) {
    console.error('[8/8] Database save failed, rolling back uploads...');
    await rollbackUploads(true, true);
    throw new Error(`Failed to save clip to database: ${insertError.message}`);
  }
  console.log('[8/8] Clip saved to database');

  console.log('\n\x1b[32m=== Pipeline Complete ===\x1b[0m\n');

  return {
    clipId,
    outputDir,
    files: {
      source: sourcePath,
      video: videoPath,
      audio: audioPath,
      gif: gifPath,
      thumbnail: thumbnailPath,
    },
    duration,
    success: true,
    githubUrl: githubResult.clipUrl,
    githubUrls,
    instagramReelUrl: instaResult?.reelUrl || '',
    dbSaved: true,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Create Meme - Complete Pipeline
===============================

Create meme from YouTube URL with full pipeline:
1. Download video
2. Add caption
3. Convert to GIF
4. Create thumbnail
5. Extract audio
6. Upload to GitHub
7. Upload to Instagram
8. Save to database

Outputs:
- source.mp4      Downloaded video
- video.mp4       Captioned video (480p)
- audio.mp3       Audio track (128kbps)
- captioned.gif   Animated GIF
- thumbnail.png   Preview image

Usage:
  npx tsx create-meme.ts --url <youtube-url> --start <seconds> --stop <seconds>

Required:
  --url <url>          YouTube URL
  --start <secs>       Start time in seconds
  --stop <secs>        Stop time in seconds

Optional:
  --output <path>      Output directory (default: temp)
  --clip-id <id>       Custom clip ID (default: auto-generated)
  --caption <text>     Caption to burn into video
  --thumbnail <secs>   Timestamp for thumbnail (default: 0)
  --width <n>          Video width (default: 480)
  --gif-fps <n>        GIF frames per second (default: 10)
  --gif-colors <n>     GIF max colors (default: 64)
  --name <name>        Clip name for database
  --tags <tags>        Comma-separated tags
  --help               Show this help

Required Environment Variables:
  GITHUB_TOKEN              GitHub personal access token
  NEXT_PUBLIC_GITHUB_REPO   GitHub repo (owner/repo)
  INSTAGRAM_ACCESS_TOKEN    Instagram Graph API token
  INSTAGRAM_USER_ID         Instagram user ID
  SUPABASE_URL              Supabase project URL
  SUPABASE_ANON_KEY         Supabase anon key

Optional Environment Variables:
  NEXT_PUBLIC_GITHUB_BRANCH GitHub branch (default: main)

Examples:
  # Basic usage
  npx tsx create-meme.ts --url "https://youtube.com/watch?v=abc123" --start 10 --stop 25

  # With caption and metadata
  npx tsx create-meme.ts --url "https://youtube.com/watch?v=abc123" \\
    --start 10 --stop 25 --caption "Ennada!" \\
    --name "Funny Clip" --tags "comedy,tamil"
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      // Source
      url: { type: 'string' },
      start: { type: 'string' },
      stop: { type: 'string' },
      // Output
      output: { type: 'string' },
      'clip-id': { type: 'string' },
      // Video
      caption: { type: 'string' },
      thumbnail: { type: 'string' },
      width: { type: 'string' },
      'gif-fps': { type: 'string' },
      'gif-colors': { type: 'string' },
      // Metadata
      name: { type: 'string' },
      tags: { type: 'string' },
      user: { type: 'string' },
      // Help
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values.url) {
    console.error('Error: --url is required');
    printUsage();
    process.exit(1);
  }

  if (!values.start || !values.stop) {
    console.error('Error: --start and --stop are required');
    printUsage();
    process.exit(1);
  }

  if (!values.user) {
    console.error('Error: --user is required');
    printUsage();
    process.exit(1);
  }

  try {
    const result = await createMeme({
      url: values.url,
      startSeconds: parseFloat(values.start),
      stopSeconds: parseFloat(values.stop),
      outputPath: values.output,
      clipId: values['clip-id'],
      caption: values.caption,
      thumbnailSecond: values.thumbnail ? parseFloat(values.thumbnail) : 0,
      videoWidth: values.width ? parseInt(values.width) : 480,
      gifFps: values['gif-fps'] ? parseInt(values['gif-fps']) : 10,
      gifMaxColors: values['gif-colors'] ? parseInt(values['gif-colors']) : 64,
      name: values.name,
      tags: values.tags?.split(',').map((t) => t.trim()),
      createdBy: values.user,
    });

    console.log('\x1b[32m=== Output Summary ===\x1b[0m\n');
    console.log(`Clip ID:   ${result.clipId}`);
    console.log(`Directory: ${result.outputDir}`);
    console.log(`Duration:  ${result.duration.toFixed(1)}s`);
    console.log('\nFiles:');
    console.log(`  source.mp4:    ${result.files.source}`);
    console.log(`  video.mp4:     ${result.files.video}`);
    console.log(`  audio.mp3:     ${result.files.audio}`);
    console.log(`  captioned.gif: ${result.files.gif}`);
    console.log(`  thumbnail.png: ${result.files.thumbnail}`);
    console.log(`\nGitHub:    ${result.githubUrl}`);
    console.log(`Instagram: ${result.instagramReelUrl || 'Skipped (no credentials)'}`);
    console.log(`Database:  Saved`);
    console.log(`\nOpen folder: open "${result.outputDir}"`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('create-meme');
if (isMainModule) {
  main();
}
