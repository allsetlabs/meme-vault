#!/usr/bin/env npx tsx
/**
 * Add burned-in captions to a video.
 *
 * Usage:
 *   npx tsx add-caption-to-video.ts --input <video> --output <video> --caption "text"
 *
 * Examples:
 *   npx tsx add-caption-to-video.ts --input ./input.mp4 --output ./output.mp4 --caption "Hello!"
 *   npx tsx add-caption-to-video.ts --input ./input.mp4 --output ./output.mp4 --caption "Hello!" --font-size 28
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { parseArgs } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface AddCaptionOptions {
  inputPath: string;
  outputPath: string;
  caption: string;
  fontSize?: number;
  videoWidth?: number;
  fontColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface AddCaptionResult {
  outputPath: string;
  success: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Wrap text to multiple lines for video captions.
 */
function wrapText(text: string, videoWidth: number, fontSize: number): string[] {
  const charsPerLine = Math.floor((videoWidth - 40) / (fontSize * 0.55));
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine: string[] = [];
  let currentLength = 0;

  for (const word of words) {
    const wordLength = word.length;
    if (currentLength + wordLength + (currentLine.length ? 1 : 0) <= charsPerLine) {
      currentLine.push(word);
      currentLength += wordLength + (currentLine.length > 1 ? 1 : 0);
    } else {
      if (currentLine.length) lines.push(currentLine.join(' '));
      currentLine = [word];
      currentLength = wordLength;
    }
  }

  if (currentLine.length) lines.push(currentLine.join(' '));
  return lines;
}

/**
 * Escape text for ffmpeg drawtext filter.
 */
function escapeText(text: string): string {
  return text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

/**
 * Add burned-in captions to a video.
 */
export async function addCaptionToVideo(options: AddCaptionOptions): Promise<AddCaptionResult> {
  const {
    inputPath,
    outputPath,
    caption,
    fontSize = 22,
    videoWidth = 480,
    fontColor = 'white',
    borderColor = 'black',
    borderWidth = 2,
  } = options;

  const lines = wrapText(caption, videoWidth, fontSize);
  let filterChain: string;

  if (lines.length === 1) {
    const escaped = escapeText(caption);
    filterChain = `scale=${videoWidth}:-2,drawtext=text='${escaped}':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=${fontSize}:fontcolor=${fontColor}:borderw=${borderWidth}:bordercolor=${borderColor}:x=(w-text_w)/2:y=h-th-20`;
  } else {
    const lineHeight = fontSize + 6;
    const drawFilters = lines
      .slice()
      .reverse()
      .map((line, i) => {
        const escaped = escapeText(line);
        const yOffset = 20 + i * lineHeight;
        return `drawtext=text='${escaped}':fontfile=/System/Library/Fonts/Helvetica.ttc:fontsize=${fontSize}:fontcolor=${fontColor}:borderw=${borderWidth}:bordercolor=${borderColor}:x=(w-text_w)/2:y=h-th-${yOffset}`;
      });
    filterChain = `scale=${videoWidth}:-2,${drawFilters.join(',')}`;
  }

  try {
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "${filterChain}" -c:v libx264 -preset slow -crf 28 -c:a aac -b:a 96k "${outputPath}"`
    );
    return { outputPath, success: true };
  } catch (error) {
    console.error('Add caption to video failed:', error);
    return { outputPath, success: false };
  }
}

/**
 * Scale video without adding captions.
 */
export async function scaleVideo(
  inputPath: string,
  outputPath: string,
  width = 480
): Promise<AddCaptionResult> {
  try {
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "scale=${width}:-2" -c:v libx264 -preset slow -crf 28 -c:a aac -b:a 96k "${outputPath}"`
    );
    return { outputPath, success: true };
  } catch (error) {
    console.error('Scale video failed:', error);
    return { outputPath, success: false };
  }
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Add Captions to Video
=====================

Usage: npx tsx add-caption-to-video.ts [options]

Required:
  --input <path>       Input video file
  --output <path>      Output video file
  --caption <text>     Caption text to burn into video

Optional:
  --font-size <n>      Font size (default: 22)
  --video-width <n>    Output video width (default: 480)
  --font-color <c>     Font color (default: white)
  --border-color <c>   Border color (default: black)
  --border-width <n>   Border width (default: 2)
  --help               Show this help

Examples:
  npx tsx add-caption-to-video.ts --input ./in.mp4 --output ./out.mp4 --caption "Hello!"
  npx tsx add-caption-to-video.ts --input ./in.mp4 --output ./out.mp4 --caption "Big text" --font-size 32
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      caption: { type: 'string' },
      'font-size': { type: 'string' },
      'video-width': { type: 'string' },
      'font-color': { type: 'string' },
      'border-color': { type: 'string' },
      'border-width': { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (!values.input || !values.output || !values.caption) {
    console.error('Error: --input, --output, and --caption are required');
    printUsage();
    process.exit(1);
  }

  console.log('\n=== Add Caption to Video ===\n');
  console.log(`Input:   ${values.input}`);
  console.log(`Output:  ${values.output}`);
  console.log(`Caption: "${values.caption}"`);

  const result = await addCaptionToVideo({
    inputPath: values.input,
    outputPath: values.output,
    caption: values.caption,
    fontSize: values['font-size'] ? parseInt(values['font-size']) : undefined,
    videoWidth: values['video-width'] ? parseInt(values['video-width']) : undefined,
    fontColor: values['font-color'],
    borderColor: values['border-color'],
    borderWidth: values['border-width'] ? parseInt(values['border-width']) : undefined,
  });

  if (result.success) {
    console.log(`\nSuccess! Output: ${result.outputPath}`);
  } else {
    console.error('\nFailed to add caption to video');
    process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.includes('add-caption-to-video');
if (isMainModule) {
  main();
}
