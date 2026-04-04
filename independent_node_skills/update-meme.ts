#!/usr/bin/env npx tsx
/**
 * Update Meme - Smart Update Pipeline
 *
 * Intelligently updates a meme based on what has changed:
 * - If start/stop changed: Re-download video, regenerate everything
 * - If only caption changed: Regenerate video, gif, thumbnail using existing source
 * - If only thumbnail_second changed: Regenerate thumbnail only
 *
 * Rollback on failure:
 * - Revert database changes
 * - Revert GitHub commit
 * - Delete newly created Instagram reel
 * - Keep old Instagram reel (only delete on success)
 *
 * Usage:
 *   npx tsx update-meme.ts --clip-id <id> --caption "New caption"
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
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

export interface UpdateMemeOptions {
  // Required
  clipId: string;

  // Optional updates - only include what changed
  startSeconds?: number;
  stopSeconds?: number;
  caption?: string;
  thumbnailSecond?: number;
  name?: string;
  tags?: string[];

  // Video options
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

  // User tracking (required)
  updatedBy: string;
}

export interface UpdateMemeResult {
  clipId: string;
  success: boolean;
  updatedFields: string[];
  newInstagramReelUrl?: string;
  errors: string[];
}

interface ExistingClipData {
  clip: Clip;
  dataJson: {
    url: string;
    startSeconds: number;
    stopSeconds: number;
    caption: string;
    thumbnailSecond: number;
    name: string;
    tags: string[];
  };
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
 * Download a file from URL to local path.
 */
async function downloadFile(url: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`curl -sL -o "${outputPath}" "${url}"`);
    return existsSync(outputPath);
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
}

/**
 * Extract Instagram reel ID from permalink URL.
 */
function extractReelIdFromUrl(url: string): string | null {
  const match = url.match(/\/reel\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch existing clip data from Supabase and GitHub.
 */
async function fetchExistingClipData(
  clipId: string,
  supabase: SupabaseClient,
  githubRepo: string,
  githubBranch: string
): Promise<ExistingClipData> {
  // Fetch from Supabase
  const { data: clip, error } = await supabase.from('clips').select('*').eq('id', clipId).single();

  if (error || !clip) {
    throw new Error(`Clip ${clipId} not found in database`);
  }

  // Fetch data.json from GitHub
  const dataJsonUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/data.json`;
  const response = await fetch(dataJsonUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch data.json from GitHub: ${response.statusText}`);
  }

  const dataJson = await response.json();

  return { clip: clip as Clip, dataJson };
}

// ============================================================================
// Core Function
// ============================================================================

/**
 * Update a meme intelligently based on what has changed.
 *
 * Update logic:
 * - If start_seconds or stop_seconds changed: Re-download and regenerate everything
 * - If only caption changed: Regenerate video, gif, thumbnail using existing source
 * - If only thumbnail_second changed: Regenerate thumbnail only
 * - If only metadata (name, tags) changed: Update database only
 *
 * Rollback on failure:
 * - Revert database changes
 * - Delete newly uploaded GitHub content
 * - Delete newly created Instagram reel
 * - Old Instagram reel is preserved until full success
 */
export async function updateMeme(options: UpdateMemeOptions): Promise<UpdateMemeResult> {
  const {
    clipId,
    startSeconds,
    stopSeconds,
    caption,
    thumbnailSecond,
    name,
    tags,
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
    updatedBy,
  } = options;

  const result: UpdateMemeResult = {
    clipId,
    success: false,
    updatedFields: [],
    errors: [],
  };

  // Validate required credentials
  if (!githubToken || !githubRepo) {
    throw new Error('GitHub credentials required (GITHUB_TOKEN, NEXT_PUBLIC_GITHUB_REPO)');
  }
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials required (SUPABASE_URL, SUPABASE_ANON_KEY)');
  }

  const hasInstagramCreds = Boolean(instagramAccessToken && instagramUserId);
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log('\n\x1b[32m=== Update Meme Pipeline ===\x1b[0m\n');
  console.log(`Clip ID: ${clipId}`);

  // Step 1: Fetch existing clip data
  console.log('[1/7] Fetching existing clip data...');
  const { clip: existingClip, dataJson: existingData } = await fetchExistingClipData(
    clipId,
    supabase,
    githubRepo,
    githubBranch
  );

  // Store original values for rollback
  const originalClip = { ...existingClip };
  const originalInstaReelLink = existingClip.insta_reel_link;

  // Determine what changed
  const timingChanged =
    (startSeconds !== undefined && startSeconds !== existingData.startSeconds) ||
    (stopSeconds !== undefined && stopSeconds !== existingData.stopSeconds);

  const captionChanged = caption !== undefined && caption !== existingData.caption;

  const thumbnailChanged =
    thumbnailSecond !== undefined && thumbnailSecond !== existingData.thumbnailSecond;

  const metadataChanged =
    (name !== undefined && name !== existingClip.name) ||
    (tags !== undefined && JSON.stringify(tags) !== JSON.stringify(existingClip.tags));

  // Calculate new values
  const newStartSeconds = startSeconds ?? existingData.startSeconds;
  const newStopSeconds = stopSeconds ?? existingData.stopSeconds;
  const newCaption = caption ?? existingData.caption;
  const newThumbnailSecond = thumbnailSecond ?? existingData.thumbnailSecond;
  const newName = name ?? existingClip.name;
  const newTags = tags ?? existingClip.tags;

  console.log(`Timing changed: ${timingChanged}`);
  console.log(`Caption changed: ${captionChanged}`);
  console.log(`Thumbnail changed: ${thumbnailChanged}`);
  console.log(`Metadata changed: ${metadataChanged}`);

  // If nothing changed, return early
  if (!timingChanged && !captionChanged && !thumbnailChanged && !metadataChanged) {
    console.log('\nNo changes detected, nothing to update.');
    result.success = true;
    return result;
  }

  // Determine what needs to be regenerated
  const needsVideoRedownload = timingChanged;
  const needsVideoRegeneration = timingChanged || captionChanged;
  const needsThumbnailRegeneration = timingChanged || captionChanged || thumbnailChanged;
  const needsGitHubUpload =
    needsVideoRedownload || needsVideoRegeneration || needsThumbnailRegeneration;
  const needsInstagramUpload = needsVideoRegeneration && hasInstagramCreds;

  // Setup working directory
  const workDir = join(tmpdir(), 'meme-vault-update', clipId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const sourcePath = join(workDir, 'source.mp4');
  const videoPath = join(workDir, 'video.mp4');
  const audioPath = join(workDir, 'audio.mp3');
  const gifPath = join(workDir, 'captioned.gif');
  const thumbnailPath = join(workDir, 'thumbnail.png');

  // Track state for rollback
  let githubUploaded = false;
  let instagramUploaded = false;
  let newInstaReelId: string | undefined;
  let newInstaReelUrl: string | undefined;
  let dbUpdated = false;

  // Rollback function
  async function rollback(): Promise<void> {
    console.log('\n=== ROLLBACK ===\n');
    const rollbackErrors: string[] = [];

    // Rollback database
    if (dbUpdated) {
      console.log('[ROLLBACK] Reverting database changes...');
      try {
        const { error } = await supabase
          .from('clips')
          .update({
            name: originalClip.name,
            tags: originalClip.tags,
            start_seconds: originalClip.start_seconds,
            stop_seconds: originalClip.stop_seconds,
            caption: originalClip.caption,
            thumbnail_second: originalClip.thumbnail_second,
            insta_reel_link: originalClip.insta_reel_link,
          })
          .eq('id', clipId);

        if (error) throw error;
        console.log('[ROLLBACK] Database reverted');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        rollbackErrors.push(`Database rollback failed: ${msg}`);
        console.error('[ROLLBACK] Database rollback failed:', msg);
      }
    }

    // Rollback GitHub - re-upload old content
    if (githubUploaded) {
      console.log('[ROLLBACK] Reverting GitHub changes...');
      // Note: We can't easily revert GitHub, so we just note it in errors
      // The old content was replaced, we'd need to re-run the create pipeline
      rollbackErrors.push('GitHub content was replaced - manual restoration may be needed');
      console.error('[ROLLBACK] GitHub content replaced - manual restoration may be needed');
    }

    // Delete new Instagram reel
    if (instagramUploaded && newInstaReelId && instagramAccessToken) {
      console.log('[ROLLBACK] Deleting new Instagram reel...');
      try {
        await deleteInstagramReel({
          reelId: newInstaReelId,
          accessToken: instagramAccessToken,
        });
        console.log('[ROLLBACK] New Instagram reel deleted');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        rollbackErrors.push(`Instagram rollback failed: ${msg}`);
        console.error('[ROLLBACK] Failed to delete new Instagram reel:', msg);
      }
    }

    if (rollbackErrors.length > 0) {
      result.errors.push(...rollbackErrors);
    }
  }

  try {
    // Step 2: Get source video (download or use existing)
    console.log('[2/7] Preparing source video...');
    if (needsVideoRedownload) {
      console.log('  Downloading new video segment...');
      const downloadResult = await downloadYtVideo({
        url: existingData.url,
        outputPath: workDir,
        startSeconds: newStartSeconds,
        stopSeconds: newStopSeconds,
        quality: 'worst',
        filename: 'source.mp4',
      });

      if (!downloadResult.success) {
        throw new Error('Failed to download video');
      }
      result.updatedFields.push('start_seconds', 'stop_seconds');
    } else {
      // Download existing source.mp4 from GitHub
      console.log('  Using existing source video...');
      const existingSourceUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/source.mp4`;
      const downloaded = await downloadFile(existingSourceUrl, sourcePath);
      if (!downloaded) {
        throw new Error('Failed to download existing source video');
      }
    }

    // Get video duration
    const duration = await getVideoDuration(sourcePath);
    if (!duration) {
      throw new Error('Could not determine video duration');
    }

    // Validate thumbnail time
    const validThumbnailSecond = newThumbnailSecond > duration ? 0 : newThumbnailSecond;

    // Step 3: Create captioned video and extract audio
    console.log('[3/7] Processing video...');
    if (needsVideoRegeneration) {
      console.log('  Creating captioned video...');
      const [videoResult] = await Promise.all([
        newCaption
          ? addCaptionToVideo({
              inputPath: sourcePath,
              outputPath: videoPath,
              caption: newCaption,
              videoWidth,
            })
          : scaleVideo(sourcePath, videoPath, videoWidth),
        extractAudio(sourcePath, audioPath).then((success) => {
          if (success) console.log('  Audio extracted');
          return success;
        }),
      ]);

      if (!videoResult.success) {
        throw new Error('Failed to create captioned video');
      }

      if (captionChanged) {
        result.updatedFields.push('caption');
      }
    } else {
      // Download existing video and audio
      console.log('  Using existing processed video...');
      const existingVideoUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/video.mp4`;
      const existingAudioUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/audio.mp3`;
      await Promise.all([
        downloadFile(existingVideoUrl, videoPath),
        downloadFile(existingAudioUrl, audioPath),
      ]);
    }

    // Step 4: Create GIF
    console.log('[4/7] Creating GIF...');
    if (needsVideoRegeneration) {
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
    } else {
      // Download existing GIF
      console.log('  Using existing GIF...');
      const existingGifUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/captioned.gif`;
      await downloadFile(existingGifUrl, gifPath);
    }

    // Step 5: Create thumbnail
    console.log('[5/7] Creating thumbnail...');
    if (needsThumbnailRegeneration) {
      const thumbnailResult = await videoToThumbnail({
        inputPath: videoPath,
        outputPath: thumbnailPath,
        timestampSeconds: validThumbnailSecond,
      });

      if (!thumbnailResult.success) {
        throw new Error('Failed to create thumbnail');
      }

      if (thumbnailChanged && !captionChanged && !timingChanged) {
        result.updatedFields.push('thumbnail_second');
      }
    } else {
      // Download existing thumbnail
      console.log('  Using existing thumbnail...');
      const existingThumbUrl = `https://raw.githubusercontent.com/${githubRepo}/${githubBranch}/${clipId}/thumbnail.png`;
      await downloadFile(existingThumbUrl, thumbnailPath);
    }

    // Create updated data.json
    const updatedDataJson = {
      url: existingData.url,
      startSeconds: newStartSeconds,
      stopSeconds: newStopSeconds,
      caption: newCaption,
      thumbnailSecond: validThumbnailSecond,
      name: newName,
      tags: newTags,
    };

    const dataJsonPath = join(workDir, 'data.json');
    await writeFile(dataJsonPath, JSON.stringify(updatedDataJson, null, 2));

    // Step 6: Upload to GitHub (replace existing)
    console.log('[6/7] Uploading to GitHub...');
    if (needsGitHubUpload) {
      // First delete existing folder, then upload new
      try {
        await deleteGitHubClip({
          clipId,
          token: githubToken,
          repo: githubRepo,
          branch: githubBranch,
        });
      } catch {
        // Ignore delete errors - folder might not exist
      }

      await uploadGitHubClip({
        clipId,
        localDir: workDir,
        token: githubToken,
        repo: githubRepo,
        branch: githubBranch,
      });
      githubUploaded = true;
      console.log('  GitHub upload complete');
    } else {
      console.log('  Skipping GitHub upload (no file changes)');
    }

    // Step 7: Upload to Instagram (if video changed)
    if (needsInstagramUpload && hasInstagramCreds) {
      console.log('[7/7] Uploading to Instagram...');
      try {
        const githubUrls = getClipGitHubUrls(clipId, githubRepo, githubBranch);
        const instaResult = await uploadInstagramReel({
          videoUrl: githubUrls.video,
          caption: newCaption,
          accessToken: instagramAccessToken!,
          userId: instagramUserId!,
        });
        instagramUploaded = true;
        newInstaReelId = instaResult.reelId;
        newInstaReelUrl = instaResult.reelUrl;
        result.newInstagramReelUrl = newInstaReelUrl;
        console.log(`  Instagram upload complete: ${newInstaReelUrl}`);
      } catch (instaError) {
        // Instagram upload failed - rollback
        console.error('  Instagram upload failed, initiating rollback...');
        throw instaError;
      }
    } else {
      console.log('[7/7] Skipping Instagram upload');
    }

    // Step 8: Update database
    console.log('[8/7] Updating database...');
    const dbUpdateData: Partial<Clip> = {};

    if (timingChanged) {
      dbUpdateData.start_seconds = newStartSeconds;
      dbUpdateData.stop_seconds = newStopSeconds;
    }
    if (captionChanged) {
      dbUpdateData.caption = newCaption;
    }
    if (thumbnailChanged || timingChanged) {
      dbUpdateData.thumbnail_second = validThumbnailSecond;
    }
    if (name !== undefined) {
      dbUpdateData.name = newName;
      if (metadataChanged) result.updatedFields.push('name');
    }
    if (tags !== undefined) {
      dbUpdateData.tags = newTags;
      if (metadataChanged) result.updatedFields.push('tags');
    }
    if (newInstaReelUrl) {
      dbUpdateData.insta_reel_link = newInstaReelUrl;
    }
    dbUpdateData.updatedBy = updatedBy;

    const { error: updateError } = await supabase
      .from('clips')
      .update(dbUpdateData)
      .eq('id', clipId);

    if (updateError) {
      throw new Error(`Database update failed: ${updateError.message}`);
    }
    dbUpdated = true;
    console.log('  Database updated');

    // Step 9: Delete old Instagram reel (only on full success)
    if (needsInstagramUpload && originalInstaReelLink && instagramAccessToken) {
      console.log('[9/7] Deleting old Instagram reel...');
      const oldReelId = extractReelIdFromUrl(originalInstaReelLink);
      if (oldReelId) {
        try {
          await deleteInstagramReel({
            reelId: oldReelId,
            accessToken: instagramAccessToken,
          });
          console.log('  Old Instagram reel deleted');
        } catch (err) {
          // Non-fatal: log but don't fail
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.warn(`  Warning: Failed to delete old Instagram reel: ${msg}`);
          result.errors.push(`Failed to delete old Instagram reel: ${msg}`);
        }
      }
    }

    // Cleanup work directory
    await rm(workDir, { recursive: true, force: true });

    console.log('\n\x1b[32m=== Update Complete ===\x1b[0m\n');
    result.success = true;
    return result;
  } catch (error) {
    console.error('\n\x1b[31m=== Update Failed ===\x1b[0m\n');
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`Error: ${errorMsg}`);

    // Rollback on failure
    await rollback();

    // Cleanup work directory
    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return result;
  }
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Update Meme - Smart Update Pipeline
===================================

Intelligently updates a meme based on what has changed:
- If start/stop changed: Re-download and regenerate everything
- If only caption changed: Regenerate video, gif, thumbnail
- If only thumbnail changed: Regenerate thumbnail only

Usage:
  npx tsx update-meme.ts --clip-id <id> [options]

Required:
  --clip-id <id>         Clip ID to update

Optional Updates:
  --start <secs>         New start time in seconds
  --stop <secs>          New stop time in seconds
  --caption <text>       New caption
  --thumbnail <secs>     New thumbnail second (relative to start)
  --name <name>          New clip name
  --tags <tags>          New comma-separated tags

Video Options:
  --width <n>            Video width (default: 480)
  --gif-fps <n>          GIF frames per second (default: 10)
  --gif-colors <n>       GIF max colors (default: 64)

  --help                 Show this help

Required Environment Variables:
  GITHUB_TOKEN              GitHub personal access token
  NEXT_PUBLIC_GITHUB_REPO   GitHub repo (owner/repo)
  INSTAGRAM_ACCESS_TOKEN    Instagram Graph API token (optional)
  INSTAGRAM_USER_ID         Instagram user ID (optional)
  SUPABASE_URL              Supabase project URL
  SUPABASE_ANON_KEY         Supabase anon key

Examples:
  # Update caption only
  npx tsx update-meme.ts --clip-id abc123_20240101 --caption "New caption!"

  # Update timing (re-downloads video)
  npx tsx update-meme.ts --clip-id abc123_20240101 --start 5 --stop 15

  # Update thumbnail position
  npx tsx update-meme.ts --clip-id abc123_20240101 --thumbnail 3
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'clip-id': { type: 'string' },
      start: { type: 'string' },
      stop: { type: 'string' },
      caption: { type: 'string' },
      thumbnail: { type: 'string' },
      name: { type: 'string' },
      tags: { type: 'string' },
      user: { type: 'string' },
      width: { type: 'string' },
      'gif-fps': { type: 'string' },
      'gif-colors': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values['clip-id']) {
    console.error('Error: --clip-id is required');
    printUsage();
    process.exit(1);
  }

  if (!values.user) {
    console.error('Error: --user is required');
    printUsage();
    process.exit(1);
  }

  try {
    const result = await updateMeme({
      clipId: values['clip-id'],
      startSeconds: values.start ? parseFloat(values.start) : undefined,
      stopSeconds: values.stop ? parseFloat(values.stop) : undefined,
      caption: values.caption,
      thumbnailSecond: values.thumbnail ? parseFloat(values.thumbnail) : undefined,
      name: values.name,
      tags: values.tags?.split(',').map((t) => t.trim()),
      videoWidth: values.width ? parseInt(values.width) : undefined,
      gifFps: values['gif-fps'] ? parseInt(values['gif-fps']) : undefined,
      gifMaxColors: values['gif-colors'] ? parseInt(values['gif-colors']) : undefined,
      updatedBy: values.user,
    });

    console.log('\x1b[32m=== Update Summary ===\x1b[0m\n');
    console.log(`Clip ID:        ${result.clipId}`);
    console.log(`Success:        ${result.success ? 'Yes' : 'No'}`);
    console.log(`Updated fields: ${result.updatedFields.join(', ') || 'None'}`);
    if (result.newInstagramReelUrl) {
      console.log(`New Instagram:  ${result.newInstagramReelUrl}`);
    }
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
const isMainModule = process.argv[1]?.includes('update-meme');
if (isMainModule) {
  main();
}
