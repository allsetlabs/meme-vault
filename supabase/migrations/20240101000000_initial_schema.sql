-- Jobs table for async clip processing queue
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clips table for storing processed meme clips
CREATE TABLE IF NOT EXISTS public.clips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source_url TEXT NOT NULL,
  start_seconds NUMERIC NOT NULL,
  stop_seconds NUMERIC NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  thumbnail_second NUMERIC NOT NULL DEFAULT 0,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  insta_reel_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching pending jobs efficiently
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON public.jobs(status, created_at);

-- Index for searching clips
CREATE INDEX IF NOT EXISTS idx_clips_created_at ON public.clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_tags ON public.clips USING GIN(tags);

-- Trigger to auto-update updated_at on jobs
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_jobs_updated_at ON public.jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
