-- Ottawa Painters business data (DripJobs reports, Meta/marketing, evidence
-- documents) lives in the Ottawa Painters project since 2026-09-13. The copies
-- here stopped changing in early September and nothing in ServiceFlow reads
-- them. Park them outside the API before ServiceFlow becomes multi-company.
-- Rollback: ALTER ... SET SCHEMA public (private for the one private view).
create schema if not exists ottawa_painters_archive;
revoke all on schema ottawa_painters_archive from public, anon, authenticated;

-- Archived rows must not block edits or deletes of live ServiceFlow records.
alter table public.acquisition_attributions
  drop constraint acquisition_attributions_job_id_fkey,
  drop constraint acquisition_attributions_lead_id_fkey;
alter table public.dripjobs_lead_report_rows
  drop constraint dripjobs_lead_report_rows_matched_lead_id_fkey;
alter table public.dripjobs_proposal_report_rows
  drop constraint dripjobs_proposal_report_rows_matched_lead_id_fkey,
  drop constraint dripjobs_proposal_report_rows_matched_quote_id_fkey,
  drop constraint dripjobs_proposal_report_rows_matched_job_id_fkey;
alter table public.dripjobs_sales_deals
  drop constraint dripjobs_sales_deals_lead_id_fkey;
alter table public.meta_audience_profiles
  drop constraint meta_audience_profiles_contact_id_fkey;
alter table public.verification_events
  drop constraint verification_events_performed_by_fkey;

alter view private.dripjobs_closing_ratio_row_metrics_calculated set schema ottawa_painters_archive;
alter view public.dripjobs_closing_ratio_latest set schema ottawa_painters_archive;
alter view public.dripjobs_closing_ratio_row_metrics set schema ottawa_painters_archive;
alter view public.dripjobs_lead_report_latest set schema ottawa_painters_archive;
alter view public.dripjobs_proposal_report_latest set schema ottawa_painters_archive;
alter view public.dripjobs_sales_report_latest set schema ottawa_painters_archive;
alter view public.dripjobs_sales_report_metrics set schema ottawa_painters_archive;
alter view public.dripjobs_set_rate_latest set schema ottawa_painters_archive;
alter view public.marketing_daily_summary set schema ottawa_painters_archive;
alter view public.marketing_lead_facts set schema ottawa_painters_archive;
alter view public.marketing_proposal_delivery_events set schema ottawa_painters_archive;
alter view public.marketing_proposal_facts set schema ottawa_painters_archive;
alter view public.marketing_summary set schema ottawa_painters_archive;
alter view public.meta_audience_candidate_summary set schema ottawa_painters_archive;
alter view public.meta_audience_dashboard set schema ottawa_painters_archive;
alter view public.meta_audience_summary set schema ottawa_painters_archive;

alter table public.acquisition_attributions set schema ottawa_painters_archive;
alter table public.documents set schema ottawa_painters_archive;
alter table public.dripjobs_closing_ratio_appointment_metrics_cache set schema ottawa_painters_archive;
alter table public.dripjobs_closing_ratio_appointment_snapshots set schema ottawa_painters_archive;
alter table public.dripjobs_closing_ratio_snapshot_rows set schema ottawa_painters_archive;
alter table public.dripjobs_closing_ratio_snapshots set schema ottawa_painters_archive;
alter table public.dripjobs_lead_report_rows set schema ottawa_painters_archive;
alter table public.dripjobs_proposal_report_rows set schema ottawa_painters_archive;
alter table public.dripjobs_sales_deals set schema ottawa_painters_archive;
alter table public.dripjobs_sales_report_snapshots set schema ottawa_painters_archive;
alter table public.dripjobs_set_rate_snapshots set schema ottawa_painters_archive;
alter table public.evidence_links set schema ottawa_painters_archive;
alter table public.marketing_performance set schema ottawa_painters_archive;
alter table public.meta_audience_definitions set schema ottawa_painters_archive;
alter table public.meta_audience_events set schema ottawa_painters_archive;
alter table public.meta_audience_memberships set schema ottawa_painters_archive;
alter table public.meta_audience_profiles set schema ottawa_painters_archive;
alter table public.verification_events set schema ottawa_painters_archive;

alter function public.process_meta_audience_event(text, text, text, timestamptz, text, uuid, text, text, boolean, jsonb)
  set schema ottawa_painters_archive;
alter function public.refresh_dripjobs_closing_ratio_appointment_metrics()
  set schema ottawa_painters_archive;

revoke all on all tables in schema ottawa_painters_archive from public, anon, authenticated;
revoke all on all sequences in schema ottawa_painters_archive from public, anon, authenticated;
revoke all on all functions in schema ottawa_painters_archive from public, anon, authenticated;
