#!/usr/bin/env npx tsx
/**
 * Download YouTube videos or segments.
 *
 * Usage:
 *   npx tsx download-yt-video.ts --url <youtube-url>
 *   npx tsx download-yt-video.ts --url <youtube-url> --start 30 --stop 60
 *
 * Examples:
 *   npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx" --output ~/Downloads
 *   npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx" --start 1.30 --stop 2.00
 */

import { exec } from 'child_process';
import { mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { parseArgs, promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface DownloadYtVideoOptions {
  url: string;
  outputPath: string;
  startSeconds?: number;
  stopSeconds?: number;
  quality?: 'best' | 'worst';
  filename?: string;
}

export interface DownloadYtVideoResult {
  outputPath: string;
  filename: string;
  success: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse time string to seconds.
 * Supports: plain seconds, MM:SS, HH:MM:SS, mm.ss, hh.mm.ss
 */
export function parseTime(timeStr: string): number {
  const trimmed = timeStr.trim();

  // Dot format (mm.ss or hh.mm.ss)
  if (trimmed.includes('.') && !trimmed.includes(':')) {
    const parts = trimmed.split('.');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
  }

  // Plain number
  const num = parseFloat(trimmed);
  if (!isNaN(num) && !trimmed.includes(':')) {
    return num;
  }

  // Colon format (MM:SS or HH:MM:SS)
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  } else if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  }

  throw new Error(`Invalid time format: ${timeStr}`);
}

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
 * Download a YouTube video or segment.
 */
export async function downloadYtVideo(
  options: DownloadYtVideoOptions
): Promise<DownloadYtVideoResult> {
  const {
    url,
    outputPath,
    startSeconds,
    stopSeconds,
    quality = 'best',
    filename = 'video.mp4',
  } = options;

  await mkdir(outputPath, { recursive: true });
  const outputFile = join(outputPath, filename);

  const formatSelector =
    quality === 'best'
      ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      : 'worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst';

  // android_vr bypasses YouTube SABR streaming (HTTP 403 issue with web client)
  const clientArgs = `--extractor-args "youtube:player_client=android_vr"`;

  // Full video download
  if (startSeconds === undefined || startSeconds === 0) {
    const cmd = `yt-dlp ${clientArgs} -f "${formatSelector}" --merge-output-format mp4 -o "${outputFile}" --no-playlist "${url}"`;
    try {
      await execAsync(cmd, { timeout: 600000 });
      return { outputPath, filename, success: true };
    } catch (error) {
      console.error('Download failed:', error);
      return { outputPath, filename, success: false };
    }
  }

  // Segment download
  const endStr = stopSeconds ? stopSeconds.toString() : '';
  const sectionArg = endStr ? `*${startSeconds}-${stopSeconds}` : `*${startSeconds}-`;

  try {
    const cmd = `yt-dlp ${clientArgs} --download-sections "${sectionArg}" --force-keyframes-at-cuts -f "${formatSelector}" --merge-output-format mp4 -o "${outputFile}" --no-playlist "${url}"`;
    await execAsync(cmd, { timeout: 600000 });
    return { outputPath, filename, success: true };
  } catch {
    // Fallback: download full and trim with ffmpeg
    console.log('Segment download failed, trying full download + trim...');
    const tmpFile = join(outputPath, 'full_tmp.mp4');

    try {
      await execAsync(
        `yt-dlp ${clientArgs} -f "${formatSelector}" --merge-output-format mp4 -o "${tmpFile}" --no-playlist "${url}"`,
        { timeout: 600000 }
      );

      let durationArg = '';
      if (stopSeconds) {
        durationArg = `-t ${stopSeconds - startSeconds}`;
      } else {
        const fullDuration = await getVideoDuration(tmpFile);
        if (fullDuration) {
          durationArg = `-t ${fullDuration - startSeconds}`;
        }
      }

      await execAsync(
        `ffmpeg -y -ss ${startSeconds} -i "${tmpFile}" ${durationArg} -c copy "${outputFile}"`
      );

      await unlink(tmpFile);
      return { outputPath, filename, success: true };
    } catch (error) {
      console.error('Fallback download failed:', error);
      try {
        await unlink(tmpFile);
      } catch {
        // Ignore error
        console.error('Error deleting temporary file:', error);
      }
      return { outputPath, filename, success: false };
    }
  }
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Download YouTube Video
======================

Download full videos or segments from YouTube.

Usage: npx tsx download-yt-video.ts [options]

Required:
  --url <url>        YouTube video URL

Optional:
  --output <path>    Output directory (default: current dir)
  --start <time>     Start time for segment
  --stop <time>      Stop time for segment
  --quality <q>      'best' or 'worst' (default: best)
  --filename <name>  Output filename (default: video.mp4)
  --help             Show this help

Time Formats:
  30        Plain seconds
  1:30      MM:SS (1 minute 30 seconds)
  1:30:00   HH:MM:SS
  1.30      mm.ss (1 minute 30 seconds)

Examples:
  # Download full video
  npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx"

  # Download segment (30s to 60s)
  npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx" --start 30 --stop 60

  # Download to specific folder with custom name
  npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx" --output ~/Downloads --filename clip.mp4

  # Download lowest quality (smaller file)
  npx tsx download-yt-video.ts --url "https://youtube.com/watch?v=xxx" --quality worst
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      output: { type: 'string' },
      start: { type: 'string' },
      stop: { type: 'string' },
      quality: { type: 'string' },
      filename: { type: 'string' },
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

  const startSeconds = values.start ? parseTime(values.start) : undefined;
  const stopSeconds = values.stop ? parseTime(values.stop) : undefined;
  const outputPath = values.output || process.cwd();

  console.log('\n=== YouTube Downloader ===\n');
  console.log(`URL:    ${values.url}`);
  if (startSeconds !== undefined) console.log(`Start:  ${startSeconds}s`);
  if (stopSeconds !== undefined) console.log(`Stop:   ${stopSeconds}s`);
  console.log(`Output: ${outputPath}`);
  console.log('\nDownloading...');

  const result = await downloadYtVideo({
    url: values.url,
    outputPath,
    startSeconds,
    stopSeconds,
    quality: (values.quality as 'best' | 'worst') || 'best',
    filename: values.filename,
  });

  if (result.success) {
    console.log('\n=== Download Complete ===\n');
    console.log(`File: ${join(result.outputPath, result.filename)}`);
    console.log(`\nOpen: open "${result.outputPath}"`);
  } else {
    console.error('\nDownload failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('download-yt-video');
if (isMainModule) {
  main();
}
