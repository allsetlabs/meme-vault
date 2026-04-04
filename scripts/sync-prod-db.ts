import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');

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

async function syncDatabase() {
  // Load prod config
  const prodEnv = parseEnvFile(resolve(projectDir, '.env'));
  const prodUrl = prodEnv.SUPABASE_URL;
  const prodKey = prodEnv.SUPABASE_ANON_KEY;

  // Load local config
  const localEnv = parseEnvFile(resolve(projectDir, '.env.development'));
  const localUrl = localEnv.SUPABASE_URL;
  const localKey = localEnv.SUPABASE_ANON_KEY;

  console.log(`Production: ${prodUrl}`);
  console.log(`Local: ${localUrl}`);

  console.log('Connecting to production Supabase...');
  const prodClient = createClient(prodUrl, prodKey);

  console.log('Connecting to local Supabase...');
  const localClient = createClient(localUrl, localKey);

  // Fetch all clips from production
  console.log('Fetching clips from production...');
  const { data: prodClips, error: clipsError } = await prodClient.from('clips').select('*');

  if (clipsError) {
    console.error('Error fetching clips:', clipsError.message);
    return;
  }

  // Fetch all jobs from production
  console.log('Fetching jobs from production...');
  const { data: prodJobs, error: jobsError } = await prodClient.from('jobs').select('*');

  if (jobsError) {
    console.error('Error fetching jobs:', jobsError.message);
    return;
  }

  // Clear local tables
  console.log('Clearing local tables...');
  await localClient.from('clips').delete().neq('id', '');
  await localClient.from('jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Insert clips into local
  if (prodClips && prodClips.length > 0) {
    console.log(`Inserting ${prodClips.length} clips into local...`);
    const { error: insertClipsError } = await localClient.from('clips').insert(prodClips);

    if (insertClipsError) {
      console.error('Error inserting clips:', insertClipsError.message);
    } else {
      console.log(`Inserted ${prodClips.length} clips`);
    }
  } else {
    console.log('No clips to sync');
  }

  // Insert jobs into local
  if (prodJobs && prodJobs.length > 0) {
    console.log(`Inserting ${prodJobs.length} jobs into local...`);
    const { error: insertJobsError } = await localClient.from('jobs').insert(prodJobs);

    if (insertJobsError) {
      console.error('Error inserting jobs:', insertJobsError.message);
    } else {
      console.log(`Inserted ${prodJobs.length} jobs`);
    }
  } else {
    console.log('No jobs to sync');
  }

  console.log('Database sync complete!');
}

syncDatabase().catch(console.error);
