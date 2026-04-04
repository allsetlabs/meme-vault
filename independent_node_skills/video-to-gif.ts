#!/usr/bin/env npx tsx
/**
 * Convert a video to an animated GIF.
 *
 * Usage:
 *   npx tsx video-to-gif.ts --input <video> --output <gif>
 *
 * Examples:
 *   npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif
 *   npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif --width 320 --fps 15
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { parseArgs } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface VideoToGifOptions {
  inputPath: string;
  outputPath: string;
  width?: number;
  fps?: number;
  maxColors?: number;
  loop?: number;
  startSeconds?: number;
  durationSeconds?: number;
}

export interface VideoToGifResult {
  outputPath: string;
  success: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Convert a video to an animated GIF.
 * Uses a two-pass approach with palette generation for better quality.
 */
export async function videoToGif(options: VideoToGifOptions): Promise<VideoToGifResult> {
  const {
    inputPath,
    outputPath,
    width = 480,
    fps = 10,
    maxColors = 64,
    loop = 0,
    startSeconds,
    durationSeconds,
  } = options;

  // Build input options for time range
  const inputOpts: string[] = [];
  if (startSeconds !== undefined) {
    inputOpts.push(`-ss ${startSeconds}`);
  }
  if (durationSeconds !== undefined) {
    inputOpts.push(`-t ${durationSeconds}`);
  }
  const inputOptsStr = inputOpts.join(' ');

  // Build filter complex for high-quality GIF with palette
  const filterComplex = `scale=${width}:-1:flags=lanczos,fps=${fps},split[s0][s1];[s0]palettegen=max_colors=${maxColors}[p];[s1][p]paletteuse=dither=bayer`;

  try {
    await execAsync(
      `ffmpeg -y ${inputOptsStr} -i "${inputPath}" -vf "${filterComplex}" -loop ${loop} "${outputPath}"`
    );
    return { outputPath, success: true };
  } catch (error) {
    console.error('Convert video to GIF failed:', error);
    return { outputPath, success: false };
  }
}

/**
 * Convert video to GIF with simpler settings (faster but lower quality).
 */
export async function videoToGifFast(
  inputPath: string,
  outputPath: string,
  width = 320,
  fps = 10
): Promise<VideoToGifResult> {
  try {
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "scale=${width}:-1,fps=${fps}" -loop 0 "${outputPath}"`
    );
    return { outputPath, success: true };
  } catch (error) {
    console.error('Convert video to GIF (fast) failed:', error);
    return { outputPath, success: false };
  }
}

/**
 * Estimate GIF file size based on video properties.
 */
export function estimateGifSize(
  durationSeconds: number,
  width: number,
  fps: number,
  colors: number
): number {
  const height = Math.round(width * 0.5625); // Assume 16:9
  const bytesPerFrame = width * height * (colors / 256) * 0.1;
  const totalFrames = durationSeconds * fps;
  return Math.round(bytesPerFrame * totalFrames);
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Video to GIF
============

Convert a video to an animated GIF with high quality palette optimization.

Usage: npx tsx video-to-gif.ts [options]

Required:
  --input <path>      Input video file
  --output <path>     Output GIF file

Optional:
  --width <n>         Output width in pixels (default: 480)
  --fps <n>           Frames per second (default: 10)
  --colors <n>        Max colors in palette (default: 64)
  --loop <n>          Loop count, 0=infinite (default: 0)
  --start <seconds>   Start time in seconds
  --duration <secs>   Duration in seconds
  --fast              Use fast mode (lower quality)
  --help              Show this help

Examples:
  npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif
  npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif --width 320 --fps 15
  npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif --start 5 --duration 10
  npx tsx video-to-gif.ts --input ./video.mp4 --output ./output.gif --fast
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      width: { type: 'string' },
      fps: { type: 'string' },
      colors: { type: 'string' },
      loop: { type: 'string' },
      start: { type: 'string' },
      duration: { type: 'string' },
      fast: { type: 'boolean' },
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

  console.log('\n=== Video to GIF ===\n');
  console.log(`Input:  ${values.input}`);
  console.log(`Output: ${values.output}`);

  let result: VideoToGifResult;

  if (values.fast) {
    console.log('Mode:   Fast (lower quality)');
    result = await videoToGifFast(
      values.input,
      values.output,
      values.width ? parseInt(values.width) : 320,
      values.fps ? parseInt(values.fps) : 10
    );
  } else {
    const width = values.width ? parseInt(values.width) : 480;
    const fps = values.fps ? parseInt(values.fps) : 10;
    const colors = values.colors ? parseInt(values.colors) : 64;

    console.log(`Width:  ${width}px`);
    console.log(`FPS:    ${fps}`);
    console.log(`Colors: ${colors}`);

    result = await videoToGif({
      inputPath: values.input,
      outputPath: values.output,
      width,
      fps,
      maxColors: colors,
      loop: values.loop ? parseInt(values.loop) : 0,
      startSeconds: values.start ? parseFloat(values.start) : undefined,
      durationSeconds: values.duration ? parseFloat(values.duration) : undefined,
    });
  }

  if (result.success) {
    console.log(`\nSuccess! GIF created: ${result.outputPath}`);
  } else {
    console.error('\nFailed to create GIF');
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('video-to-gif');
if (isMainModule) {
  main();
}
