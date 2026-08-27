begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create index dripjobs_proposal_report_rows_job_idx
  on public.dripjobs_proposal_report_rows(matched_job_id)
  where matched_job_id is not null;

commit;
