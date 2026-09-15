-- Apply only after the worker's DELETE route uses set_photo_trash.
-- All ordinary-client removals must remain recoverable.
revoke delete on public.job_media from authenticated;
