-- Add type column to jobs table to distinguish between create and update jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'create' CHECK (type IN ('create', 'update'));

-- Add comment for documentation
COMMENT ON COLUMN public.jobs.type IS 'Job type: create for new memes, update for editing existing memes';
