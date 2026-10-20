-- Add asynchronous generation diagnostic job types.
-- Dated after 20260501002_add_deslop_style_method to keep migrations monotonic.
ALTER TYPE "generation_job_type" ADD VALUE IF NOT EXISTS 'diagnose_chapter';
ALTER TYPE "generation_job_type" ADD VALUE IF NOT EXISTS 'reader_simulation';
ALTER TYPE "generation_job_type" ADD VALUE IF NOT EXISTS 'style_drift_check';
ALTER TYPE "generation_job_type" ADD VALUE IF NOT EXISTS 'continuity_check';
