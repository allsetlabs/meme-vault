import { createClient } from '@supabase/supabase-js';
import { rm } from 'fs/promises';

// Import meme functions
import { createMeme } from '../independent_node_skills/create-meme';
import { updateMeme } from '../independent_node_skills/update-meme';

// Import types
import type { Job, CreateJobPayload, UpdateJobPayload } from '../src/types/clip';

// Environment variables loaded via npm script (dotenv -e .env.development or .env)
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

/**
 * Cleanup temporary directory.
 */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

async function fetchPendingJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }

  return data as Job[];
}

async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'completed' | 'failed',
  result?: { clip_id: string },
  error?: string
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (result) update.result = result;
  if (error) update.error = error;

  const { error: updateError } = await supabase.from('jobs').update(update).eq('id', jobId);

  if (updateError) {
    console.error(`Failed to update job ${jobId}:`, updateError);
  }
}

/**
 * Process a create job - creates a new meme from YouTube URL.
 */
async function processCreateJob(job: Job): Promise<void> {
  const payload = job.payload as CreateJobPayload;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing CREATE job: ${job.id}`);
  console.log(`URL: ${payload.source_url}`);
  console.log(`Time: ${payload.start_seconds}s - ${payload.stop_seconds}s`);
  console.log('='.repeat(60));

  // Mark as processing
  await updateJobStatus(job.id, 'processing');

  let outputDir: string | undefined;

  try {
    // Use consolidated createMeme - runs full pipeline (all steps mandatory)
    const result = await createMeme({
      url: payload.source_url,
      startSeconds: payload.start_seconds,
      stopSeconds: payload.stop_seconds,
      caption: payload.caption || undefined,
      thumbnailSecond: payload.thumbnail_second,
      name: payload.name || '',
      tags: payload.tags || [],
      createdBy: job.user,
    });

    outputDir = result.outputDir;

    // Mark job as completed
    await updateJobStatus(job.id, 'completed', { clip_id: result.clipId });
    console.log(`\nJob ${job.id} completed successfully!`);
    console.log(`Clip ID: ${result.clipId}`);
    console.log(`GitHub: ${result.githubUrl}`);
    console.log(`Instagram: ${result.instagramReelUrl}`);

    // Cleanup
    await cleanupDir(outputDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Job ${job.id} failed:`, message);
    await updateJobStatus(job.id, 'failed', undefined, message);

    // Cleanup on error
    if (outputDir) {
      await cleanupDir(outputDir);
    }
  }
}

/**
 * Process an update job - updates an existing meme.
 */
async function processUpdateJob(job: Job): Promise<void> {
  const payload = job.payload as UpdateJobPayload;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing UPDATE job: ${job.id}`);
  console.log(`Clip ID: ${payload.clip_id}`);
  if (payload.start_seconds !== undefined) console.log(`New start: ${payload.start_seconds}s`);
  if (payload.stop_seconds !== undefined) console.log(`New stop: ${payload.stop_seconds}s`);
  if (payload.caption !== undefined) console.log(`New caption: "${payload.caption}"`);
  if (payload.thumbnail_second !== undefined)
    console.log(`New thumbnail: ${payload.thumbnail_second}s`);
  console.log('='.repeat(60));

  // Mark as processing
  await updateJobStatus(job.id, 'processing');

  try {
    // Use smart updateMeme - only updates what changed
    const result = await updateMeme({
      clipId: payload.clip_id,
      startSeconds: payload.start_seconds,
      stopSeconds: payload.stop_seconds,
      caption: payload.caption,
      thumbnailSecond: payload.thumbnail_second,
      name: payload.name,
      tags: payload.tags,
      updatedBy: job.user,
    });

    if (!result.success) {
      throw new Error(result.errors.join(', ') || 'Update failed');
    }

    // Mark job as completed
    await updateJobStatus(job.id, 'completed', { clip_id: payload.clip_id });
    console.log(`\nJob ${job.id} completed successfully!`);
    console.log(`Clip ID: ${payload.clip_id}`);
    console.log(`Updated fields: ${result.updatedFields.join(', ') || 'None'}`);
    if (result.newInstagramReelUrl) {
      console.log(`New Instagram: ${result.newInstagramReelUrl}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Job ${job.id} failed:`, message);
    await updateJobStatus(job.id, 'failed', undefined, message);
  }
}

/**
 * Process a job based on its type.
 */
async function processJob(job: Job): Promise<void> {
  // Default to 'create' for backwards compatibility with existing jobs
  const jobType = job.type || 'create';

  if (jobType === 'update') {
    await processUpdateJob(job);
  } else if (jobType === 'create') {
    await processCreateJob(job);
  }
}

async function main(): Promise<void> {
  console.log('Meme Vault Worker');
  console.log('='.repeat(60));
  console.log('Fetching pending jobs...\n');

  const jobs = await fetchPendingJobs();

  if (jobs.length === 0) {
    console.log('No pending jobs found.');
    return;
  }

  console.log(`Found ${jobs.length} pending job(s)\n`);

  for (const job of jobs) {
    await processJob(job);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Worker finished.');
}

main().catch((error) => {
  console.error('Worker error:', error);
  process.exit(1);
});
