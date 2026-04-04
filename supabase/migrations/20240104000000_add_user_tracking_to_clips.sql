-- Add user tracking columns to clips table
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
