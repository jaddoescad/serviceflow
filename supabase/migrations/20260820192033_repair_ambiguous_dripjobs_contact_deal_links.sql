begin;

create temporary table dripjobs_ambiguous_link_repairs on commit drop as
with contact_counts as (
  select dripjobs_contact_id, count(*) as deal_count
  from public.dripjobs_sales_deals
  where dripjobs_contact_id is not null
  group by dripjobs_contact_id
)
select
  l.id as lead_id,
  l.metadata->'dripjobs_sales_list_authority'->>'deal_id' as authority_deal_id,
  l.metadata->'dripjobs_sales_list_authority' as old_authority,
  v.id as source_verification_event_id,
  v.old_values as restore_values,
  jsonb_build_object(
    'status', l.status,
    'pipeline_stage_raw', l.pipeline_stage_raw,
    'source', l.source,
    'normalized_channel', l.normalized_channel,
    'dripjobs_sales_deal_id', l.dripjobs_sales_deal_id
  ) as incorrectly_applied_values
from public.leads l
join contact_counts c
  on c.dripjobs_contact_id = l.metadata->'dripjobs_sales_list_authority'->>'contact_id'
 and c.deal_count > 1
join public.verification_events v
  on v.entity_id = l.id::text
 and v.action = 'dripjobs_sales_list_synced'
 and v.evidence->'authority'->>'combined_source_sha256' =
   '441c0bd2a06a4f4a803a5c62692e3130736811cdf5667fb199ad023a10de7150'
where l.metadata->'dripjobs_sales_list_authority'->>'combined_source_sha256' =
  '441c0bd2a06a4f4a803a5c62692e3130736811cdf5667fb199ad023a10de7150'
  and l.metadata->'dripjobs_sales_list_authority'->>'match_method' = 'event_contact_identity';

update public.dripjobs_sales_deals d
set
  lead_id = null,
  metadata = d.metadata || jsonb_build_object(
    'ambiguous_lead_link_removed_at', now(),
    'ambiguous_lead_link_reason', 'Legacy contact identity maps to more than one lifetime DripJobs deal.'
  ),
  updated_at = now()
from dripjobs_ambiguous_link_repairs r
where d.deal_id = r.authority_deal_id
  and d.lead_id = r.lead_id;

update public.leads l
set
  status = coalesce(r.restore_values->>'status', l.status),
  pipeline_stage_raw = r.restore_values->>'pipeline_stage_raw',
  source = r.restore_values->>'source',
  normalized_channel = coalesce(r.restore_values->>'normalized_channel', 'unknown'),
  dripjobs_sales_deal_id = nullif(r.restore_values->>'dripjobs_sales_deal_id', ''),
  metadata = (l.metadata - 'dripjobs_sales_list_authority') || jsonb_build_object(
    'dripjobs_sales_list_ambiguous_repair', jsonb_build_object(
      'repaired_at', now(),
      'reason', 'Legacy contact identity maps to more than one lifetime DripJobs deal.',
      'removed_deal_id', r.authority_deal_id,
      'source_verification_event_id', r.source_verification_event_id
    )
  ),
  updated_at = now()
from dripjobs_ambiguous_link_repairs r
where l.id = r.lead_id;

insert into public.verification_events (
  id,
  entity_type,
  entity_id,
  action,
  reason,
  old_values,
  new_values,
  evidence,
  occurred_at
)
select
  gen_random_uuid(),
  'lead',
  r.lead_id::text,
  'dripjobs_ambiguous_contact_deal_link_repaired',
  'Removed a Sales Deal link that had been inferred from a legacy Contact ID shared by more than one lifetime deal; restored the lead values recorded before the backfill.',
  r.incorrectly_applied_values,
  r.restore_values,
  jsonb_build_object(
    'removed_authority', r.old_authority,
    'source_verification_event_id', r.source_verification_event_id
  ),
  now()
from dripjobs_ambiguous_link_repairs r;

commit;
