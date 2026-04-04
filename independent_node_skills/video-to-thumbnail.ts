#!/usr/bin/env npx tsx
/**
 * Extract a thumbnail image from a video at a specific timestamp.
 *
 * Usage:
 *   npx tsx video-to-thumbnail.ts --input <video> --output <image>
 *   npx tsx video-to-thumbnail.ts --input <video> --output <image> --time 5
 *
 * Examples:
 *   npx tsx video-to-thumbnail.ts --input ./video.mp4 --output ./thumb.png
 *   npx tsx video-to-thumbnail.ts --input ./video.mp4 --output ./thumb.png --time 3.5
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { parseArgs } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface VideoToThumbnailOptions {
  inputPath: string;
  outputPath: string;
  timestampSeconds?: number;
  quality?: number;
  width?: number;
}

export interface VideoToThumbnailResult {
  outputPath: string;
  success: boolean;
  timestampUsed: number;
}

// ============================================================================
// Core Functions
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
 * Extract a thumbnail image from a video at a specific timestamp.
 */
export async function videoToThumbnail(
  options: VideoToThumbnailOptions
): Promise<VideoToThumbnailResult> {
  const { inputPath, outputPath, timestampSeconds = 0, quality = 2, width } = options;

  // Validate timestamp against video duration
  const duration = await getVideoDuration(inputPath);
  let validTimestamp = timestampSeconds;

  if (duration !== null && timestampSeconds > duration) {
    console.warn(`Timestamp ${timestampSeconds}s exceeds video duration ${duration}s, using 0`);
    validTimestamp = 0;
  }

  // Build filter chain
  const filters: string[] = [];
  if (width) {
    filters.push(`scale=${width}:-1`);
  }
  const filterArg = filters.length > 0 ? `-vf "${filters.join(',')}"` : '';

  try {
    await execAsync(
      `ffmpeg -y -ss ${validTimestamp} -i "${inputPath}" -vframes 1 -q:v ${quality} ${filterArg} "${outputPath}"`
    );
    return {
      outputPath,
      success: true,
      timestampUsed: validTimestamp,
    };
  } catch (error) {
    console.error('Create thumbnail failed:', error);
    return {
      outputPath,
      success: false,
      timestampUsed: validTimestamp,
    };
  }
}

/**
 * Create multiple thumbnails at regular intervals.
 */
export async function videoToThumbnailsAtIntervals(
  inputPath: string,
  outputDir: string,
  intervalSeconds: number,
  prefix = 'thumb'
): Promise<{ thumbnails: string[]; success: boolean }> {
  const duration = await getVideoDuration(inputPath);
  if (!duration) {
    return { thumbnails: [], success: false };
  }

  const thumbnails: string[] = [];
  let currentTime = 0;
  let index = 0;

  while (currentTime < duration) {
    const outputPath = `${outputDir}/${prefix}_${index}.png`;
    const result = await videoToThumbnail({
      inputPath,
      outputPath,
      timestampSeconds: currentTime,
    });

    if (result.success) {
      thumbnails.push(outputPath);
    }

    currentTime += intervalSeconds;
    index++;
  }

  return {
    thumbnails,
    success: thumbnails.length > 0,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Video to Thumbnail
==================

Extract a thumbnail image from a video at a specific timestamp.

Usage: npx tsx video-to-thumbnail.ts [options]

Required:
  --input <path>     Input video file
  --output <path>    Output image file (png, jpg)

Optional:
  --time <seconds>   Timestamp to capture (default: 0)
  --quality <n>      JPEG quality 1-31, lower is better (default: 2)
  --width <n>        Output width in pixels (default: original)
  --help             Show this help

Examples:
  npx tsx video-to-thumbnail.ts --input ./video.mp4 --output ./thumb.png
  npx tsx video-to-thumbnail.ts --input ./video.mp4 --output ./thumb.png --time 5
  npx tsx video-to-thumbnail.ts --input ./video.mp4 --output ./thumb.jpg --time 10 --width 320
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      time: { type: 'string' },
      quality: { type: 'string' },
      width: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values.input || !values.output) {
    console.error('Error: --input and --output are required');
    printUsage();
    process.exit(1);
  }

  const timestamp = values.time ? parseFloat(values.time) : 0;

  console.log('\n=== Video to Thumbnail ===\n');
  console.log(`Input:     ${values.input}`);
  console.log(`Output:    ${values.output}`);
  console.log(`Timestamp: ${timestamp}s`);

  const result = await videoToThumbnail({
    inputPath: values.input,
    outputPath: values.output,
    timestampSeconds: timestamp,
    quality: values.quality ? parseInt(values.quality) : undefined,
    width: values.width ? parseInt(values.width) : undefined,
  });

  if (result.success) {
    console.log(`\nSuccess! Thumbnail created at ${result.timestampUsed}s`);
    console.log(`Output: ${result.outputPath}`);
  } else {
    console.error('\nFailed to create thumbnail');
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('video-to-thumbnail');
if (isMainModule) {
  main();
}
