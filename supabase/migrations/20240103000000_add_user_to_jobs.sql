-- Add user column to jobs table to track who queued the job
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS "user" TEXT;
