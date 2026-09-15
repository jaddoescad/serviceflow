-- EXPLAIN showed a full scan/sort of 7,713 media rows for the first 61 records.
create index if not exists job_media_feed_order_idx on public.job_media(captured_at desc nulls last,created_at desc,id desc);
